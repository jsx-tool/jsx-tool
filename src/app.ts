import 'reflect-metadata';
import { injectable, inject } from 'tsyringe';
import { ConfigService } from './services/config.service';
import { Logger } from './services/logger.service';
import { ProxyService } from './services/proxy.service';
import { WebSocketService } from './services/websocket.service';
import { FileSystemApiService } from './services/file-system-api.service';

@injectable()
export class Application {
  private isRunningProxy: boolean = false;
  constructor (
    @inject(ConfigService) private readonly config: ConfigService,
    @inject(Logger) private readonly logger: Logger,
    @inject(ProxyService) private readonly proxy: ProxyService,
    @inject(WebSocketService) private readonly webSocketService: WebSocketService,
    @inject(FileSystemApiService) private readonly fileSystemApiService: FileSystemApiService
  ) {}

  async start (isRunningProxy: boolean): Promise<void> {
    this.isRunningProxy = isRunningProxy;
    const { valid, errors } = this.config.validate();
    if (!valid) throw new Error(`Invalid config:\n• ${errors.join('\n• ')}`);

    this.fileSystemApiService.startFileWatchers();
    await Promise.all(this.isRunningProxy ? [this.proxy.start(), this.webSocketService.start()] : [this.webSocketService.start()]);
    this.logger.success('JSX Tool dev-server started ✅');

    this.logKeyStatus();
  }

  async stop (): Promise<void> {
    this.fileSystemApiService.cleanup();
    await Promise.all(this.isRunningProxy ? [this.proxy.stop(), this.webSocketService.stop()] : [this.webSocketService.stop()]);
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
}
