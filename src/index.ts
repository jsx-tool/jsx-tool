import 'reflect-metadata';
import { container } from 'tsyringe';
import { Command } from 'commander';
import { Application } from './app';
import { ConfigService } from './services/config.service';
import { Logger } from './services/logger.service';
import { WorkingDirectoryValidationService } from './services/working-directory-validation.service';
import pc from 'picocolors';

async function main () {
  const program = new Command();

  program
    .name('filemap')
    .description('Development proxy server')
    .version('0.0.1')
    .option('-f, --from <path>', 'working directory', process.cwd())
    .option('--server-port <port>', 'target server port', '3001')
    .option('--server-host <host>', 'target server host', 'localhost')
    .option('--server-protocol <protocol>', 'target server protocol (http|https)', 'http')
    .option('--proxy-port <port>', 'proxy server port', '3000')
    .option('--proxy-host <host>', 'proxy server host', 'localhost')
    .option('--proxy-protocol <protocol>', 'proxy server protocol (http|https)', 'http')
    .option('--ws-port <port>', 'WebSocket server port', '3002')
    .option('--ws-host <host>', 'WebSocket server host', 'localhost')
    .option('--ws-protocol <protocol>', 'WebSocket protocol (ws|wss)', 'ws')
    .option('-d, --debug', 'enable debug logging', false);

  program
    .action(async (options) => {
      const config = container.resolve(ConfigService);
      const logger = container.resolve(Logger);
      const workingDirectoryValidationService = container.resolve(WorkingDirectoryValidationService);

      logger.setDebug(options.debug);

      const validation = workingDirectoryValidationService.validateWorkingDirectory(options.from);

      if (!validation.isValid) {
        logger.error('Invalid working directory:');
        validation.errors.forEach(error => { logger.error(`  • ${error}`); });
        process.exit(1);
      }

      config.setWorkingDirectory(options.from);

      await config.loadFromFile(options.from);

      config.setFromCliOptions({
        serverPort: parseInt(options.serverPort),
        serverHost: options.serverHost,
        serverProtocol: options.serverProtocol as 'http' | 'https',
        proxyPort: parseInt(options.proxyPort),
        proxyHost: options.proxyHost,
        proxyProtocol: options.proxyProtocol as 'http' | 'https',
        wsPort: parseInt(options.wsPort),
        wsHost: options.wsHost,
        wsProtocol: options.wsProtocol as 'ws' | 'wss',
        debug: options.debug
      });

      const app = container.resolve(Application);
      await app.start();
    });

  await program.parseAsync(process.argv);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(pc.red('Fatal error:'), error);
    process.exit(1);
  });
}

export { main };
