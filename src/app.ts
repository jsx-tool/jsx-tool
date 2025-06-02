import 'reflect-metadata';
import { injectable, inject } from 'tsyringe';
import { ConfigService } from './services/config.service';
import { Logger } from './services/logger.service';
import { ProxyService } from './services/proxy.service';
import { WebSocketService } from './services/websocket.service';
import { KeyFetcher } from './services/key-fetcher.service';
import { KeyManager } from './services/key-manager.service';

@injectable()
export class Application {
  constructor (
    @inject(ConfigService) private readonly config: ConfigService,
    @inject(Logger) private readonly logger: Logger,
    @inject(ProxyService) private readonly proxy: ProxyService,
    @inject(WebSocketService) private readonly ws: WebSocketService,
    @inject(KeyFetcher) private readonly keyFetcher: KeyFetcher,
    @inject(KeyManager) private readonly keyManager: KeyManager
  ) {}

  async start (): Promise<void> {
    const { valid, errors } = this.config.validate();
    if (!valid) throw new Error(`Invalid config:\n• ${errors.join('\n• ')}`);

    await Promise.all([this.proxy.start(), this.ws.start()]);
    this.logger.success('Filemap dev-server started ✅');

    this.logKeyStatus();
  }

  async stop (): Promise<void> {
    await Promise.all([this.proxy.stop(), this.ws.stop()]);
    this.logger.info('Filemap dev-server stopped');
  }

  private logKeyStatus (): void {
    const keyStatus = this.ws.getCurrentKeyStatus();
    const fetcherStatus = this.ws.getFetcherStatus();

    if (keyStatus.hasKey) {
      this.logger.info(`Active key: ${keyStatus.uuid} (expires: ${keyStatus.expirationTime})`);
    } else {
      this.logger.info('No active key');
    }

    if (fetcherStatus.isActive) {
      this.logger.info(`Key fetcher active for UUID: ${fetcherStatus.currentUuid}`);
    }
  }

  getStatus (): {
    config: any
    keyStatus: any
    fetcherStatus: any
    clientCount: number
  } {
    return {
      config: this.config.getConfig(),
      keyStatus: this.ws.getCurrentKeyStatus(),
      fetcherStatus: this.ws.getFetcherStatus(),
      clientCount: this.ws.getClientCount()
    };
  }
}
