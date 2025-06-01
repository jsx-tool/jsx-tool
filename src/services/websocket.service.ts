import { injectable, inject } from 'tsyringe';
import { WebSocketServer, WebSocket } from 'ws';
import { ConfigService } from './config.service';
import { Logger } from './logger.service';

@injectable()
export class WebSocketService {
  private wss?: WebSocketServer;
  private readonly clients = new Set<WebSocket>();

  constructor (
    @inject(ConfigService) private readonly config: ConfigService,
    @inject(Logger) private readonly logger: Logger
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
        try {
          const message = JSON.parse(data.toString());
          console.log("M", message)
        } catch(e) {

        }
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

  broadcast (message: string): void {
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  async stop (): Promise<void> {
    if (!this.wss) return;

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
}
