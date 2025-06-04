import { injectable, inject, singleton } from 'tsyringe';
import { WebSocketServer, WebSocket } from 'ws';
import { ConfigService } from './config.service';
import { Logger } from './logger.service';
import { KeyFetcher } from './key-fetcher.service';
import { KeyManager } from './key-manager.service';
import { SignatureVerifierService } from './signature-verifier.service';
import type {
  ExistsResult,
  LsResult,
  ReadFileResult,
  TreeResult,
  WriteFileResult
} from './file-system-api.service';
import {
  FileSystemApiService
} from './file-system-api.service';
import { DesktopClientRegistryService } from './desktop-client-registry.service';
import { DesktopEmitterService } from './desktop-emitter.service';

export interface RequestParamMap {
  read_file: { filePath: string }
  write_file: { filePath: string, content: string, encoding?: BufferEncoding }
  exists: { filePath: string }
  ls: {
    filePath: string
    options?: {
      recursive?: boolean
      filesOnly?: boolean
      directoriesOnly?: boolean
    }
  }
  tree: {
    filePath: string
  }
  open_element: {
    file_path: string
    line_number: number
    column_number: number
  }
}

export interface EventPayloadMap {
  read_file: { filePath: string, response: ReadFileResult }
  write_file: { filePath: string, response: WriteFileResult }
  exists: { filePath: string, response: ExistsResult }
  ls: { filePath: string, response: LsResult }
  tree: { filePath: string, response: TreeResult }
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
  'open_element'
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

    this.keyManager.setListener((keyData) => {
      this.broadcastKeyReady(keyData.uuid);
    });

    this.desktopClientRegistryService.addUnixClientsChangedListener(() => {
      this.broadcastUnixConnectionCount();
    });

    if (!this.wss) return;

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      this.logger.info('WebSocket client connected');

      ws.send(this.getUnixClientState());

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
            message.params.filePath,
            message.params.options
          );
          socket.send(
            this.serializeResponseMessage(message, {
              filePath: message.params.filePath,
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
        case 'open_element': {
          this.desktopEmitterService.forwardMessage(message);
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

  public broadcastKeyReady (uuid: string) {
    this.broadcast(JSON.stringify({
      event_name: 'key_ready',
      unix_connection_count: this.desktopClientRegistryService.count(),
      unix_utilized_apis: this.desktopClientRegistryService.utilizedApis(),
      uuid
    }));
  }

  public broadcastUnixConnectionCount () {
    this.broadcast(this.getUnixClientState());
  }

  private getUnixClientState () {
    return JSON.stringify({
      event_name: 'updated_unix_client_state',
      unix_connection_count: this.desktopClientRegistryService.count(),
      unix_utilized_apis: this.desktopClientRegistryService.utilizedApis()
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
