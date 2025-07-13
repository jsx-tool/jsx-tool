import { injectable, singleton, inject, container } from 'tsyringe';
import { Application } from '../app';
import { ConfigService } from './config.service';
import { Logger } from './logger.service';
import { WorkingDirectoryValidationService } from './working-directory-validation.service';

export interface ServerOptions {
  from?: string
  serverPort?: string
  serverHost?: string
  serverProtocol?: 'http' | 'https'
  proxyPort?: string
  proxyHost?: string
  proxyProtocol?: 'http' | 'https'
  wsPort?: string
  wsHost?: string
  wsProtocol?: 'ws' | 'wss'
  debug?: boolean
}

@singleton()
@injectable()
export class ServerManagerService {
  constructor (
    @inject(ConfigService) private readonly configService: ConfigService,
    @inject(Logger) private readonly logger: Logger,
    @inject(WorkingDirectoryValidationService) private readonly workingDirectoryValidationService: WorkingDirectoryValidationService
  ) {}

  async startServer (options: ServerOptions): Promise<void> {
    this.logger.setDebug(options.debug || false);

    const workingDir = options.from || process.cwd();
    this.configService.setWorkingDirectory(workingDir);

    const validation = this.workingDirectoryValidationService.validateWorkingDirectory(workingDir);

    if (!validation.isValid) {
      this.logger.error('Invalid working directory:');
      validation.errors.forEach(error => { this.logger.error(`  • ${error}`); });
      throw new Error('Invalid working directory');
    }

    await this.configService.loadFromFile(workingDir);

    const cliOptions: any = {};

    if (options.serverPort !== undefined) {
      cliOptions.serverPort = parseInt(options.serverPort);
    }
    if (options.serverHost !== undefined) {
      cliOptions.serverHost = options.serverHost;
    }
    if (options.serverProtocol !== undefined) {
      cliOptions.serverProtocol = options.serverProtocol;
    }
    if (options.proxyPort !== undefined) {
      cliOptions.proxyPort = parseInt(options.proxyPort);
    }
    if (options.proxyHost !== undefined) {
      cliOptions.proxyHost = options.proxyHost;
    }
    if (options.proxyProtocol !== undefined) {
      cliOptions.proxyProtocol = options.proxyProtocol;
    }
    if (options.wsPort !== undefined) {
      cliOptions.wsPort = parseInt(options.wsPort);
    }
    if (options.wsHost !== undefined) {
      cliOptions.wsHost = options.wsHost;
    }
    if (options.wsProtocol !== undefined) {
      cliOptions.wsProtocol = options.wsProtocol;
    }
    if (options.debug !== undefined) {
      cliOptions.debug = options.debug;
    }

    this.configService.setFromCliOptions(cliOptions);

    const configValidation = this.configService.validate();
    if (!configValidation.valid) {
      this.logger.error('Invalid configuration:');
      configValidation.errors.forEach(error => { this.logger.error(`  • ${error}`); });
      throw new Error('Invalid configuration');
    }

    const app = container.resolve(Application);
    await app.start();
  }
}
