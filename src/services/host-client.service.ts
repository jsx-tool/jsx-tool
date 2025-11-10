import { injectable, inject, singleton } from 'tsyringe';
import WebSocket from 'ws';
import { createSign } from 'crypto';
import { Logger } from './logger.service';
import { LocalKeyService } from './local-key.service';
import { ConfigService } from './config.service';
import type {
  HostForwardRequest,
  HostResponseMessage,
  ForwardableEvents,
  WebSocketResponseEvent,
  WebSocketInboundRequest,
  EventPayloadMap,
  RequestParamMap
} from './websocket.service';
import { FileSystemApiService } from './file-system-api.service';

const hostForwardHandlers = {
  get_git_status: (_: RequestParamMap['get_git_status'], api: FileSystemApiService): EventPayloadMap['get_git_status'] => {
    return api.gitStatus();
  },
  copy_to_clipboard: (params: RequestParamMap['copy_to_clipboard'], api: FileSystemApiService): EventPayloadMap['copy_to_clipboard'] => {
    return api.copyToClipboard(params.paths);
  },
  import_items: (params: RequestParamMap['import_items'], api: FileSystemApiService): EventPayloadMap['import_items'] => {
    return api.importItems(params.sourcePaths, params.targetDirectory);
  }
} satisfies {
  [K in ForwardableEvents]: (params: RequestParamMap[K], api: FileSystemApiService) => EventPayloadMap[K]
};

interface HostInitMessage {
  event_name: 'host_init'
  signature: string
  timestamp: number
}

@singleton()
@injectable()
export class HostClientService {
  private ws?: WebSocket;
  private reconnectTimer?: NodeJS.Timeout;
  private readonly reconnectDelay = 5000;
  private isShuttingDown = false;

  constructor (
    @inject(Logger) private readonly logger: Logger,
    @inject(LocalKeyService) private readonly localKeyService: LocalKeyService,
    @inject(ConfigService) private readonly config: ConfigService,
    @inject(FileSystemApiService) private readonly fileSystemApi: FileSystemApiService
  ) { }

  async start (): Promise<void> {
    if (this.ws) {
      this.logger.warn('Host client already started');
      return;
    }

    this.isShuttingDown = false;
    await this.connect();
  }

  private async connect (): Promise<void> {
    if (this.isShuttingDown) return;

    try {
      const { wsPort, wsHost, wsProtocol } = this.config.getConfig();
      const wsUrl = `${wsProtocol}://${wsHost}:${wsPort}/jsx-tool-socket`;

      this.logger.info(`Host client connecting to ${wsUrl}...`);

      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        this.logger.success('Host client connected');
        this.sendHostInit();
      });

      this.ws.on('message', (data: Buffer) => {
        this.handleMessage(data.toString());
      });

      this.ws.on('close', () => {
        this.logger.warn('Host client disconnected');
        this.ws = undefined;
        this.scheduleReconnect();
      });

      this.ws.on('error', (error: Error) => {
        this.logger.error(`Host client error: ${error.message}`);
        this.ws = undefined;
        this.scheduleReconnect();
      });
    } catch (error) {
      this.logger.error(`Failed to connect host client: ${(error as Error).message}`);
      this.scheduleReconnect();
    }
  }

  private sendHostInit (): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.logger.error('Cannot send host init: WebSocket not open');
      return;
    }

    const privateKey = this.localKeyService.getPrivateKey();
    if (!privateKey) {
      this.logger.error('Cannot send host init: No private key available');
      this.ws.close();
      return;
    }

    try {
      const timestamp = Date.now();
      const payload = JSON.stringify({
        event_name: 'host_init',
        timestamp
      });

      const sign = createSign('SHA256');
      sign.update(payload);
      sign.end();
      const signature = sign.sign(privateKey, 'base64');

      const message: HostInitMessage = {
        event_name: 'host_init',
        signature,
        timestamp
      };

      this.ws.send(JSON.stringify(message));
      this.logger.debug('Sent host init message');
    } catch (error) {
      this.logger.error(`Failed to send host init: ${(error as Error).message}`);
      this.ws.close();
    }
  }

  private handleMessage (data: string): void {
    try {
      const message = JSON.parse(data);
      this.logger.debug(`Host client received: ${message.event_name}`);

      switch (message.event_name) {
        case 'host_init_ack':
          this.logger.success('Host client authenticated');
          break;
        case 'host_init_rejected':
          this.logger.error(`Host client authentication rejected: ${message.reason || 'unknown reason'}`);
          this.ws?.close();
          break;
        case 'host_forward':
          this.handleHostForward(message as HostForwardRequest<ForwardableEvents>);
          break;
        default:
          break;
      }
    } catch (error) {
      this.logger.error(`Failed to parse host client message: ${(error as Error).message}`);
    }
  }

  private translatePathToHost (devServerPath: string, devServerWorkingDir: string, hostWorkingDir: string): string {
    const normalizeSlashes = (p: string) => p.replace(/\\/g, '/');

    let devPath = normalizeSlashes(devServerPath);
    let devWorkingDir = normalizeSlashes(devServerWorkingDir);
    let hostWorkDir = normalizeSlashes(hostWorkingDir);

    if (devWorkingDir.endsWith('/')) {
      devWorkingDir = devWorkingDir.slice(0, -1);
    }
    if (hostWorkDir.endsWith('/')) {
      hostWorkDir = hostWorkDir.slice(0, -1);
    }

    if (devPath.includes('/../') || devPath.includes('/./')) {
      const parts = devPath.split('/');
      const resolved: string[] = [];

      for (const part of parts) {
        if (part === '..') {
          resolved.pop();
        } else if (part !== '.' && part !== '') {
          resolved.push(part);
        } else if (part === '' && resolved.length === 0) {
          resolved.push('');
        }
      }

      devPath = resolved.join('/');
      if (!devPath.startsWith('/') && devServerPath.startsWith('/')) {
        devPath = '/' + devPath;
      }
    }

    if (!devPath.startsWith(devWorkingDir)) {
      return devPath;
    }

    const relativePath = devPath.slice(devWorkingDir.length);
    const cleanRelativePath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;

    if (!cleanRelativePath) {
      return hostWorkDir;
    }

    return hostWorkDir + '/' + cleanRelativePath;
  }

  private translatePathToDevServer (hostPath: string, devServerWorkingDir: string, hostWorkingDir: string): string {
    const normalizeSlashes = (p: string) => p.replace(/\\/g, '/');

    let hostPathNorm = normalizeSlashes(hostPath);
    let devWorkingDir = normalizeSlashes(devServerWorkingDir);
    let hostWorkDir = normalizeSlashes(hostWorkingDir);

    if (devWorkingDir.endsWith('/')) {
      devWorkingDir = devWorkingDir.slice(0, -1);
    }
    if (hostWorkDir.endsWith('/')) {
      hostWorkDir = hostWorkDir.slice(0, -1);
    }

    if (hostPathNorm.includes('/../') || hostPathNorm.includes('/./')) {
      const parts = hostPathNorm.split('/');
      const resolved: string[] = [];

      for (const part of parts) {
        if (part === '..') {
          resolved.pop();
        } else if (part !== '.' && part !== '') {
          resolved.push(part);
        } else if (part === '' && resolved.length === 0) {
          resolved.push('');
        }
      }

      hostPathNorm = resolved.join('/');
      if (!hostPathNorm.startsWith('/') && hostPath.startsWith('/')) {
        hostPathNorm = '/' + hostPathNorm;
      }
    }

    if (!hostPathNorm.startsWith(hostWorkDir)) {
      return hostPathNorm;
    }

    const relativePath = hostPathNorm.slice(hostWorkDir.length);
    const cleanRelativePath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;

    if (!cleanRelativePath) {
      return devWorkingDir;
    }

    return devWorkingDir + '/' + cleanRelativePath;
  }

  private translateRequestParams<K extends ForwardableEvents>(
    params: RequestParamMap[K],
    devServerWorkingDir: string,
    hostWorkingDir: string,
    eventName: K
  ): RequestParamMap[K] {
    if (eventName === 'get_git_status') {
      return params;
    }

    if (eventName === 'copy_to_clipboard') {
      const clipboardParams = params as RequestParamMap['copy_to_clipboard'];
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      return {
        paths: clipboardParams.paths.map(path =>
          this.translatePathToHost(path, devServerWorkingDir, hostWorkingDir)
        )
      } as RequestParamMap[K];
    }

    if (eventName === 'import_items') {
      const importParams = params as RequestParamMap['import_items'];
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      return {
        sourcePaths: importParams.sourcePaths.map(path =>
          this.translatePathToHost(path, devServerWorkingDir, hostWorkingDir)
        ),
        targetDirectory: this.translatePathToHost(
          importParams.targetDirectory,
          devServerWorkingDir,
          hostWorkingDir
        )
      } as RequestParamMap[K];
    }

    eventName satisfies never;
    return params;
  }

  private translateResponsePayload<K extends ForwardableEvents>(
    payload: EventPayloadMap[K],
    devServerWorkingDir: string,
    hostWorkingDir: string,
    eventName: K
  ): EventPayloadMap[K] {
    if (eventName === 'get_git_status') {
      const gitPayload = payload as EventPayloadMap['get_git_status'];

      if (!gitPayload.isGitRepo || !gitPayload.statusInfo) {
        return payload;
      }

      const translatedFiles = gitPayload.statusInfo.files.map(file => ({
        ...file,
        absolutePath: this.translatePathToDevServer(
          file.absolutePath,
          devServerWorkingDir,
          hostWorkingDir
        )
      }));

      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      return {
        ...gitPayload,
        statusInfo: {
          ...gitPayload.statusInfo,
          files: translatedFiles
        }
      } as EventPayloadMap[K];
    }

    if (eventName === 'copy_to_clipboard') {
      return payload;
    }

    if (eventName === 'import_items') {
      const importPayload = payload as EventPayloadMap['import_items'];

      if (!importPayload.importedPaths) {
        return payload;
      }

      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      return {
        ...importPayload,
        importedPaths: importPayload.importedPaths.map(path =>
          this.translatePathToDevServer(path, devServerWorkingDir, hostWorkingDir)
        )
      } as EventPayloadMap[K];
    }

    eventName satisfies never;
    return payload;
  }

  private async handleHostForward<K extends ForwardableEvents>(
    message: HostForwardRequest<K>
  ): Promise<void> {
    this.logger.debug(
      `Handling forwarded request: ${message.wrapped_request.event_name} ` +
      `(dev workspace: ${message.workspace_dir}, host workspace: ${this.config.getConfig().workingDirectory})`
    );

    const hostWorkingDir = this.config.getConfig().workingDirectory;
    const devServerWorkingDir = message.workspace_dir;

    const eventName = message.wrapped_request.event_name;

    if (eventName === 'get_git_status') {
      this.handleGetGitStatus(message as HostForwardRequest<'get_git_status'>, devServerWorkingDir, hostWorkingDir);
      return;
    }

    if (eventName === 'copy_to_clipboard') {
      this.handleCopyToClipboard(message as HostForwardRequest<'copy_to_clipboard'>, devServerWorkingDir, hostWorkingDir);
      return;
    }

    if (eventName === 'import_items') {
      this.handleImportItems(message as HostForwardRequest<'import_items'>, devServerWorkingDir, hostWorkingDir);
      return;
    }

    const exhaustive: never = eventName;
    throw new Error(`Unhandled event type: ${String(exhaustive)}`);
  }

  private handleGetGitStatus (
    message: HostForwardRequest<'get_git_status'>,
    devServerWorkingDir: string,
    hostWorkingDir: string
  ): void {
    const translatedParams = this.translateRequestParams(
      message.wrapped_request.params,
      devServerWorkingDir,
      hostWorkingDir,
      'get_git_status'
    );

    const result = hostForwardHandlers.get_git_status(translatedParams, this.fileSystemApi);

    const translatedPayload = this.translateResponsePayload(
      result,
      devServerWorkingDir,
      hostWorkingDir,
      'get_git_status'
    );

    this.sendHostResponse(message.request_uuid, message.wrapped_request, translatedPayload);
  }

  private handleCopyToClipboard (
    message: HostForwardRequest<'copy_to_clipboard'>,
    devServerWorkingDir: string,
    hostWorkingDir: string
  ): void {
    const translatedParams = this.translateRequestParams(
      message.wrapped_request.params,
      devServerWorkingDir,
      hostWorkingDir,
      'copy_to_clipboard'
    );

    const result = hostForwardHandlers.copy_to_clipboard(translatedParams, this.fileSystemApi);

    const translatedPayload = this.translateResponsePayload(
      result,
      devServerWorkingDir,
      hostWorkingDir,
      'copy_to_clipboard'
    );

    this.sendHostResponse(message.request_uuid, message.wrapped_request, translatedPayload);
  }

  private handleImportItems (
    message: HostForwardRequest<'import_items'>,
    devServerWorkingDir: string,
    hostWorkingDir: string
  ): void {
    const translatedParams = this.translateRequestParams(
      message.wrapped_request.params,
      devServerWorkingDir,
      hostWorkingDir,
      'import_items'
    );

    const result = hostForwardHandlers.import_items(translatedParams, this.fileSystemApi);

    const translatedPayload = this.translateResponsePayload(
      result,
      devServerWorkingDir,
      hostWorkingDir,
      'import_items'
    );

    this.sendHostResponse(message.request_uuid, message.wrapped_request, translatedPayload);
  }

  private sendHostResponse<K extends ForwardableEvents>(
    requestUuid: string,
    originalRequest: WebSocketInboundRequest<K>,
    payload: EventPayloadMap[K]
  ): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.logger.error('Cannot send host response: WebSocket not open');
      return;
    }

    const wrappedResponse = this.serializeResponseMessage(originalRequest, payload);

    const response: HostResponseMessage<K> = {
      event_name: 'host_response',
      request_uuid: requestUuid,
      wrapped_response: JSON.parse(wrappedResponse)
    };

    this.ws.send(JSON.stringify(response));
    this.logger.debug(`Sent host response for ${originalRequest.event_name} (uuid: ${requestUuid})`);
  }

  private serializeResponseMessage<K extends keyof EventPayloadMap>(
    req: WebSocketInboundRequest<K>,
    payload: EventPayloadMap[K]
  ): string {
    const msg: WebSocketResponseEvent<K> = {
      message_id: req.message_id,
      event_response: req.event_name,
      payload
    };
    return JSON.stringify(msg);
  }

  private scheduleReconnect (): void {
    if (this.isShuttingDown) return;
    if (this.reconnectTimer) return;

    this.logger.info(`Host client will reconnect in ${this.reconnectDelay / 1000}s`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, this.reconnectDelay);
  }

  async stop (): Promise<void> {
    this.isShuttingDown = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    if (this.ws) {
      await new Promise<void>((resolve) => {
        if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
          resolve();
          return;
        }
        this.ws.once('close', resolve);
        this.ws.close();
      });
      this.ws = undefined;
    }

    this.logger.info('Host client stopped');
  }

  isConnected (): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
