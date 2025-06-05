import { injectable, inject, singleton } from 'tsyringe';
import { WebSocketServer, WebSocket } from 'ws';
import { ConfigService } from './config.service';
import { Logger } from './logger.service';
import { KeyFetcher } from './key-fetcher.service';
import { KeyManager } from './key-manager.service';
import { SignatureVerifierService } from './signature-verifier.service';
import type {
  ExistsResult,
  LsArgs,
  LsResult,
  ProjectInfo,
  ReadFileArgs,
  ReadFileResult,
  TreeResult,
  WriteFileArgs,
  WriteFileResult
} from './file-system-api.service';
import {
  FileSystemApiService
} from './file-system-api.service';
import type { AvailableApis } from './desktop-client-registry.service';
import { DesktopClientRegistryService } from './desktop-client-registry.service';
import { DesktopEmitterService } from './desktop-emitter.service';

export interface RequestParamMap {
  read_file: ReadFileArgs
  write_file: WriteFileArgs
  exists: {
    filePath: string
  }
  ls: LsArgs
  tree: {
    filePath: string
  }
  read_file_many: {
    files: ReadFileArgs[]
  }
  write_file_many: {
    files: WriteFileArgs[]
  }
  exists_many: {
    paths: string[]
  }
  ls_many: {
    dirs: LsArgs[]
  }
  tree_many: {
    dirPaths: string[]
  }
  open_element: {
    file_path: string
    line_number: number
    column_number: number
  }
  // event api
  get_project_info: unknown
  get_unix_client_info: unknown
}

export interface EventPayloadMap {
  read_file: {
    filePath: string
    response: ReadFileResult
  }
  write_file: {
    filePath: string
    response: WriteFileResult
  }
  exists: {
    filePath: string
    response: ExistsResult
  }
  ls: {
    filePath: string
    response: LsResult
  }
  tree: {
    filePath: string
    response: TreeResult
  }
  read_file_many: {
    files: ReadFileArgs[]
    responses: ReadFileResult[]
  }
  write_file_many: {
    files: WriteFileArgs[]
    responses: WriteFileResult[]
  }
  exists_many: {
    paths: string[]
    responses: ExistsResult[]
  }
  ls_many: {
    dirs: LsArgs[]
    responses: LsResult[]
  }
  tree_many: {
    dirPaths: string[]
    responses: TreeResult[]
  }
  get_project_info: {
    projectInfo: ProjectInfo
  }
  get_unix_client_info: {
    unixConnectionCount: number
    utilizedApis: AvailableApis[]
  }
}

export interface WebSocketInboundEvent<K extends keyof RequestParamMap> {
  event_name: K
  params: RequestParamMap[K]
  signature: string
  message_id: string
}

type WebSocketInboundRequest<K extends keyof RequestParamMap> =
  WebSocketInboundEvent<K>;

type WebSocketPostInitMessage =
  {
    [K in keyof RequestParamMap]: WebSocketInboundRequest<K>;
  }[keyof RequestParamMap];

interface WebSocketInitMessage {
  event_name: 'key_registered'
  uuid: string
  [key: string]: any
}

type WebSocketMessage = WebSocketPostInitMessage | WebSocketInitMessage;

interface WebSocketResponseEvent<K extends keyof EventPayloadMap> {
  event_response: K
  message_id: string
  payload: EventPayloadMap[K]
}

const signedEvents = new Set<keyof RequestParamMap>([
  'read_file',
  'write_file',
  'exists',
  'ls',
  'tree',
  'read_file_many',
  'write_file_many',
  'exists_many',
  'ls_many',
  'tree_many',
  'open_element',
  'get_project_info',
  'get_unix_client_info'
]);

@singleton()
@injectable()
export class WebSocketService {
  private wss?: WebSocketServer;
  private readonly clients = new Set<WebSocket>();

  constructor (
    @inject(ConfigService) private readonly config: ConfigService,
    @inject(Logger) private readonly logger: Logger,
    @inject(KeyFetcher) private readonly keyFetcher: KeyFetcher,
    @inject(KeyManager) private readonly keyManager: KeyManager,
    @inject(DesktopClientRegistryService) private readonly desktopClientRegistryService: DesktopClientRegistryService,
    @inject(SignatureVerifierService) private readonly signatureVerifier: SignatureVerifierService,
    @inject(FileSystemApiService) private readonly fileSystemApi: FileSystemApiService,
    @inject(DesktopEmitterService) private readonly desktopEmitterService: DesktopEmitterService
  ) { }

  async start (): Promise<void> {
    const { wsPort, wsHost, wsProtocol } = this.config.getConfig();

    await new Promise<void>((resolve, reject) => {
      this.wss = new WebSocketServer({ port: wsPort, host: wsHost }, resolve);
      this.wss.once('error', reject);
    });

    this.keyManager.setListener((_keyData) => {
      this.broadcastKeyReady();
    });

    this.desktopClientRegistryService.addUnixClientsChangedListener(() => {
      this.broadcastUnixConnectionsChanged();
    });

    this.fileSystemApi.setListener(() => {
      this.broadcastProjectInfoChanged();
    });

    if (!this.wss) return;

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      this.logger.info('WebSocket client connected');

      ws.on('message', (data) => {
        this.logger.debug(`WebSocket received: ${data.toString()}`);
        this.handleMessage(data.toString(), ws);
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        this.logger.info('WebSocket client disconnected');
      });

      ws.on('error', (error) => {
        this.logger.error(`WebSocket error: ${error.message}`);
        this.clients.delete(ws);
      });
    });

    this.logger.success(
      `WebSocket server listening on ${wsProtocol}://${wsHost}:${wsPort}`
    );
  }

  async stop (): Promise<void> {
    if (!this.wss) return;

    this.keyFetcher.cleanup();
    this.keyManager.cleanup();

    await Promise.all(
      [...this.clients].map(
        async (client) => {
          await new Promise<void>((resolve) => {
            if (client.readyState === WebSocket.CLOSED) { resolve(); return; }
            client.once('close', resolve);
            client.close();
          });
        }
      )
    );

    this.clients.clear();
    await new Promise<void>((resolve) => { this.wss!.close(() => { resolve(); }); });
    this.logger.info('WebSocket server stopped');
  }

  private handleMessage (data: string, socket: WebSocket): void {
    try {
      const message: WebSocketMessage = JSON.parse(data);

      if (message.event_name === 'key_registered') {
        this.handleKeyRegistered(message);
        return;
      }

      if (!signedEvents.has(message.event_name as any)) {
        this.logger.warn(`Unknown event received: ${message.event_name}`);
        return;
      }

      const { signature, ...messageWithoutSignature } = message;

      const signedPayload = {
        event_name: messageWithoutSignature.event_name,
        params: messageWithoutSignature.params,
        message_id: messageWithoutSignature.message_id
      };

      if (!this.signatureVerifier.verify(signedPayload, signature)) {
        this.logger.warn('Discarding message with invalid signature');
        return;
      }

      switch (message.event_name) {
        case 'read_file': {
          const res = this.fileSystemApi.readFile(message.params.filePath);
          socket.send(
            this.serializeResponseMessage(message, {
              filePath: message.params.filePath,
              response: res
            })
          );
          break;
        }
        case 'write_file': {
          const res = this.fileSystemApi.writeToFile(
            message.params.filePath,
            message.params.content,
            message.params.encoding
          );
          socket.send(
            this.serializeResponseMessage(message, {
              filePath: message.params.filePath,
              response: res
            })
          );
          break;
        }
        case 'exists': {
          const res = this.fileSystemApi.exists(message.params.filePath);
          socket.send(
            this.serializeResponseMessage(message, {
              filePath: message.params.filePath,
              response: res
            })
          );
          break;
        }
        case 'ls': {
          const res = this.fileSystemApi.ls(
            message.params.dirPath,
            message.params.options
          );
          socket.send(
            this.serializeResponseMessage(message, {
              filePath: message.params.dirPath,
              response: res
            })
          );
          break;
        }
        case 'tree': {
          const res = this.fileSystemApi.tree(
            message.params.filePath
          );
          socket.send(
            this.serializeResponseMessage(message, {
              filePath: message.params.filePath,
              response: res
            })
          );
          break;
        }
        case 'read_file_many': {
          const res = this.fileSystemApi.readFileMany(message.params.files);
          socket.send(
            this.serializeResponseMessage(message, {
              files: message.params.files,
              responses: res
            })
          );
          break;
        }

        case 'write_file_many': {
          const res = this.fileSystemApi.writeToFileMany(message.params.files);
          socket.send(
            this.serializeResponseMessage(message, {
              files: message.params.files,
              responses: res
            })
          );
          break;
        }

        case 'exists_many': {
          const res = this.fileSystemApi.existsMany(message.params.paths);
          socket.send(
            this.serializeResponseMessage(message, {
              paths: message.params.paths,
              responses: res
            })
          );
          break;
        }

        case 'ls_many': {
          const res = this.fileSystemApi.lsMany(message.params.dirs);
          socket.send(
            this.serializeResponseMessage(message, {
              dirs: message.params.dirs,
              responses: res
            })
          );
          break;
        }

        case 'tree_many': {
          const res = this.fileSystemApi.treeMany(message.params.dirPaths);
          socket.send(
            this.serializeResponseMessage(message, {
              dirPaths: message.params.dirPaths,
              responses: res
            })
          );
          break;
        }
        case 'open_element': {
          this.desktopEmitterService.forwardMessage(message);
          break;
        }
        case 'get_project_info': {
          const projectInfo = this.fileSystemApi.projectInfo();
          socket.send(
            this.serializeResponseMessage(message, {
              projectInfo
            })
          );
          break;
        }
        case 'get_unix_client_info': {
          socket.send(
            this.serializeResponseMessage(message, {
              unixConnectionCount: this.desktopClientRegistryService.count(),
              utilizedApis: this.desktopClientRegistryService.utilizedApis()
            })
          );
          break;
        }
      }
    } catch (err) {
      this.logger.error(
        `Failed to parse WebSocket message: ${err instanceof Error ? err.message : 'unknown error'
        }`
      );
    }
  }

  private serializeResponseMessage<
    K extends keyof EventPayloadMap,
  >(
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

  private handleKeyRegistered (message: WebSocketInitMessage): void {
    if (!message.uuid) {
      this.logger.error('Key registered event missing UUID');
      return;
    }
    this.logger.info(`Key registered (uuid: ${message.uuid})`);
    this.keyFetcher.startFetching(message.uuid);
  }

  broadcast (message: string): void {
    this.clients.forEach((c) => {
      if (c.readyState === WebSocket.OPEN) c.send(message);
    });
  }

  public broadcastKeyReady () {
    this.broadcast(JSON.stringify({
      event_name: 'key_ready'
    }));
  }

  public broadcastUnixConnectionsChanged () {
    this.broadcast(this.getUnixClientInfoEvent());
  }

  private getUnixClientInfoEvent () {
    return JSON.stringify({
      event_name: 'updated_unix_client_info'
    });
  }

  public broadcastProjectInfoChanged () {
    this.broadcast(this.getProjectInfo());
  }

  private getProjectInfo () {
    return JSON.stringify({
      event_name: 'updated_project_info'
    });
  }

  getClientCount (): number {
    return this.clients.size;
  }

  getCurrentKeyStatus (): {
    hasKey: boolean
    uuid?: string
    expirationTime?: string
  } {
    const cur = this.keyManager.getCurrentKey();
    return {
      hasKey: this.keyManager.hasValidKey(),
      uuid: cur?.uuid,
      expirationTime: cur?.expirationTime
    };
  }

  getFetcherStatus (): { isActive: boolean, currentUuid?: string } {
    const u = this.keyFetcher.getCurrentUuid();
    return { isActive: u !== null, currentUuid: u || undefined };
  }
}
