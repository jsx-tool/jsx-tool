import { injectable, inject } from 'tsyringe';
import { ConfigService } from './services/config.service';
import { Logger } from './services/logger.service';
import { WebSocketService } from './services/websocket.service';
import { FileSystemApiService } from './services/file-system-api.service';
import type { Server } from 'http';

@injectable()
export class ViteApplication {
  constructor (
    @inject(ConfigService) private readonly config: ConfigService,
    @inject(Logger) private readonly logger: Logger,
    @inject(WebSocketService) private readonly webSocketService: WebSocketService,
    @inject(FileSystemApiService) private readonly fileSystemApiService: FileSystemApiService
  ) {}

  public started = false;
  public serverStarted = false;

  async startWithServer (server: Server): Promise<void> {
    this.serverStarted = true;
    const { valid, errors } = this.config.validate();
    if (!valid) throw new Error(`Invalid config:\n• ${errors.join('\n• ')}`);

    this.fileSystemApiService.startFileWatchers();
    await Promise.all([this.webSocketService.startWithHttpServer(server)]);
    this.logger.success('JSX Tool dev-server started ✅');

    this.logKeyStatus();
  }

  async stop (): Promise<void> {
    this.fileSystemApiService.cleanup();
    await Promise.all([this.webSocketService.stop()]);
    this.logger.info('JSX Tool dev-server stopped');
  }

  private logKeyStatus (): void {
    const keyStatus = this.webSocketService.getCurrentKeyStatus();
    const fetcherStatus = this.webSocketService.getFetcherStatus();

    if (keyStatus.hasKey) {
      this.logger.info(`Active key: ${keyStatus.uuid} (expires: ${keyStatus.expirationTime})`);
    } else {
      this.logger.info('No active key');
    }

    if (fetcherStatus.isActive) {
      this.logger.info(`Key fetcher active for UUID: ${fetcherStatus.currentUuid}`);
    }
  }

  getContainerConfig () {
    return this.config;
  }

  setDidStart () {
    this.started = true;
  }
}
