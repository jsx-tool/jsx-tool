import { injectable, inject } from 'tsyringe';
import { WebSocketServer, WebSocket } from 'ws';
import { ConfigService } from './config.service';
import { Logger } from './logger.service';
import { KeyFetcher } from './key-fetcher.service';
import { KeyManager } from './key-manager.service';

interface WebSocketMessage {
  event_name: string
  uuid?: string
  [key: string]: any
}

@injectable()
export class WebSocketService {
  private wss?: WebSocketServer;
  private readonly clients = new Set<WebSocket>();

  constructor (
    @inject(ConfigService) private readonly config: ConfigService,
    @inject(Logger) private readonly logger: Logger,
    @inject(KeyFetcher) private readonly keyFetcher: KeyFetcher,
    @inject(KeyManager) private readonly keyManager: KeyManager
  ) { }

  async start (): Promise<void> {
    const { wsPort, wsHost, wsProtocol } = this.config.getConfig();

    await new Promise<void>((resolve, reject) => {
      this.wss = new WebSocketServer({ port: wsPort, host: wsHost }, resolve);
      this.wss.once('error', reject);
    });

    if (!this.wss) {
      return;
    }

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      this.logger.info('WebSocket client connected');

      ws.send(`[filemap] connected over ${wsProtocol}://${wsHost}:${wsPort}`);

      ws.on('message', (data) => {
        this.logger.debug(`WebSocket received: ${data.toString()}`);
        this.handleMessage(data.toString());
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

    this.logger.success(`WebSocket server listening on ${wsProtocol}://${wsHost}:${wsPort}`);
  }

  private handleMessage (data: string): void {
    try {
      const message: WebSocketMessage = JSON.parse(data);

      this.logger.debug(`Parsed message: ${JSON.stringify(message)}`);

      switch (message.event_name) {
        case 'key_registered':
          this.handleKeyRegistered(message);
          break;

        default:
          this.logger.warn(`Unknown event received: ${message.event_name}`);
      }
    } catch (error) {
      this.logger.error(`Failed to parse WebSocket message: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private handleKeyRegistered (message: WebSocketMessage): void {
    if (!message.uuid) {
      this.logger.error('Key registered event missing UUID');
      return;
    }

    this.logger.info(`Key registered event received for UUID: ${message.uuid}`);
    this.keyFetcher.startFetching(message.uuid);
  }

  broadcast (message: string): void {
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  async stop (): Promise<void> {
    if (!this.wss) return;

    this.keyFetcher.cleanup();
    this.keyManager.cleanup();

    await Promise.all(
      [...this.clients].map(
        async client => {
          await new Promise<void>(resolve => {
            if (client.readyState === WebSocket.CLOSED) { resolve(); return; }
            client.once('close', resolve);
            client.close();
          });
        }
      )
    );
    this.clients.clear();

    await new Promise<void>(resolve => { this.wss!.close(() => { resolve(); }); });

    this.logger.info('WebSocket server stopped');
  }

  getClientCount (): number {
    return this.clients.size;
  }

  getCurrentKeyStatus (): { hasKey: boolean, uuid?: string, expirationTime?: string } {
    const currentKey = this.keyManager.getCurrentKey();
    const hasValidKey = this.keyManager.hasValidKey();

    return {
      hasKey: hasValidKey,
      uuid: currentKey?.uuid,
      expirationTime: currentKey?.expirationTime
    };
  }

  getFetcherStatus (): { isActive: boolean, currentUuid?: string } {
    const currentUuid = this.keyFetcher.getCurrentUuid();

    return {
      isActive: currentUuid !== null,
      currentUuid: currentUuid || undefined
    };
  }
}
