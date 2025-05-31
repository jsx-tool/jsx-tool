import 'reflect-metadata';
import { injectable, inject } from 'tsyringe';
import { ConfigService } from './services/config.service';
import { Logger } from './services/logger.service';
import { ProxyService } from './services/proxy.service';
import { WebSocketService } from './services/websocket.service';

@injectable()
export class Application {
  constructor (
    @inject(ConfigService) private readonly config: ConfigService,
    @inject(Logger) private readonly logger: Logger,
    @inject(ProxyService) private readonly proxy: ProxyService,
    @inject(WebSocketService)private readonly ws: WebSocketService
  ) {}

  async start (): Promise<void> {
    const { valid, errors } = this.config.validate();
    if (!valid) throw new Error(`Invalid config:\n• ${errors.join('\n• ')}`);

    await Promise.all([this.proxy.start(), this.ws.start()]);
    this.logger.success('Filemap dev-server started ✅');
  }

  async stop (): Promise<void> {
    await Promise.all([this.proxy.stop(), this.ws.stop()]);
    this.logger.info('Filemap dev-server stopped');
  }
}
