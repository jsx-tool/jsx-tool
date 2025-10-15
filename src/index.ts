import 'reflect-metadata';
import { container } from 'tsyringe';
import { Command } from 'commander';
import { Application } from './app';
import { ConfigService } from './services/config.service';
import { Logger } from './services/logger.service';
import { WorkingDirectoryValidationService } from './services/working-directory-validation.service';
import pc from 'picocolors';
import packageJson from '../package.json';
import { resolve, join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { input, confirm } from '@inquirer/prompts';

async function main () {
  const program = new Command();

  program
    .name('jsx-tool')
    .description('Development proxy server')
    .version(packageJson.version);

  program
    .command('start', { isDefault: true })
    .description('Start the development proxy server')
    .option('-f, --from <path>', 'working directory', process.cwd())
    .option('--node-modules-dir <path>', 'node_modules directory (defaults to working directory or auto-detect)')
    .option('--additional-directories <paths>', 'comma-separated list of additional directories (relative paths from project root) to watch', '')
    .option('--server-port <port>', 'target server port', '4000')
    .option('--server-host <host>', 'target server host', 'localhost')
    .option('--server-protocol <protocol>', 'target server protocol (http|https)', 'http')
    .option('--proxy-port <port>', 'proxy server port', '3000')
    .option('--proxy-host <host>', 'proxy server host', 'localhost')
    .option('--proxy-protocol <protocol>', 'proxy server protocol (http|https)', 'http')
    .option('--ws-port <port>', 'WebSocket server port', '12021')
    .option('--ws-host <host>', 'WebSocket server host', 'localhost')
    .option('--ws-protocol <protocol>', 'WebSocket protocol (ws|wss)', 'ws')
    .option('--no-proxy', 'disable proxy server', false)
    .option('--insecure', 'runs dev server without signature check', false)
    .option('--logging', 'enabled logging', false)
    .option('-d, --debug', 'enable debug logging', false)
    .action(async (options) => {
      const config = container.resolve(ConfigService);
      const logger = container.resolve(Logger);
      const workingDirectoryValidationService = container.resolve(WorkingDirectoryValidationService);
      const additionalDirectories = options.additionalDirectories
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
        ? options.additionalDirectories.split(',').map((dir: string) => dir.trim()).filter((dir: string) => dir.length > 0)
        : [];

      logger.setDebug(options.debug);

      let nodeModulesDir = options.nodeModulesDir;
      if (!nodeModulesDir) {
        const detectedDir = workingDirectoryValidationService.findNodeModulesWithPackage(
          options.from,
          'react'
        );
        if (detectedDir) {
          nodeModulesDir = detectedDir;
          if (options.debug) {
            logger.debug(`Auto-detected node_modules directory: ${nodeModulesDir}`);
          }
        }
      }

      const validation = workingDirectoryValidationService.validateWorkingDirectory(
        options.from,
        nodeModulesDir
      );

      if (!validation.isValid) {
        logger.error('Invalid working directory:');
        validation.errors.forEach(error => { logger.error(`  • ${error}`); });

        if (validation.errors.some(e => e.includes('not installed'))) {
          logger.info('\nHint: If this is a monorepo, try specifying --node-modules-dir <path>');
          logger.info('      pointing to the root directory containing node_modules');
        }

        process.exit(1);
      }

      config.setWorkingDirectory(options.from);
      config.setNodeModulesDirectory(nodeModulesDir || options.from);
      const additionalDirectoriesValidation = workingDirectoryValidationService.validateAdditionalDirectories(options.from, additionalDirectories);
      if (!additionalDirectoriesValidation.isValid) {
        logger.error('Invalid additional directories:');
        additionalDirectoriesValidation.errors.forEach(error => { logger.error(`  • ${error}`); });
        process.exit(1);
      }
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
        debug: options.debug,
        nodeModulesDir,
        additionalDirectories,
        insecure: options.insecure
      });

      if (config.getConfig().enableLogging && !config.getConfig().debug) {
        logger.setSilence(true);
      } else {
        logger.setSilence(false);
      }

      const app = container.resolve(Application);
      const noProxy = options.noProxy ?? config?.getConfig().noProxy ?? false;
      await app.start(!noProxy);
    });

  program
    .command('init')
    .description('Initialize jsx-tool configuration')
    .option('-f, --from <path>', 'working directory', process.cwd())
    .action(async (options) => {
      const workingDir = resolve(options.from);
      const configDirPath = join(workingDir, '.jsxtool');
      const configPath = join(configDirPath, 'config.json');
      const rulesPath = join(configDirPath, 'rules.md');

      console.log(pc.cyan('\n🚀 JSX Tool Configuration Setup\n'));
      console.log(pc.gray(`Working directory: ${workingDir}\n`));

      if (existsSync(configDirPath)) {
        console.log(pc.yellow('⚠️  Configuration directory already exists at:'));
        console.log(pc.gray(`   ${configDirPath}`));
        console.log(pc.red('\nAborting initialization to avoid overwriting existing configuration.'));
        process.exit(1);
      }

      try {
        const serverPort = await input({
          message: 'What port does your application server run on?',
          default: '3000',
          validate: (value) => {
            const port = parseInt(value);
            if (isNaN(port) || port < 1 || port > 65535) {
              return 'Please enter a valid port number (1-65535)';
            }
            return true;
          }
        });

        const needsProxy = await confirm({
          message: 'Do you need to run the proxy server? (recommended for non-Vite projects)',
          default: true
        });

        let proxyPort = '4000';
        if (needsProxy) {
          proxyPort = await input({
            message: 'What port should the proxy server run on?',
            default: '4000',
            validate: (value) => {
              const port = parseInt(value);
              if (isNaN(port) || port < 1 || port > 65535) {
                return 'Please enter a valid port number (1-65535)';
              }
              if (port === parseInt(serverPort)) {
                return 'Proxy port must be different from server port';
              }
              return true;
            }
          });
        }

        const wsPort = await input({
          message: 'What port should the WebSocket dev server run on?',
          default: '12021',
          validate: (value) => {
            const port = parseInt(value);
            if (isNaN(port) || port < 1 || port > 65535) {
              return 'Please enter a valid port number (1-65535)';
            }
            if (port === parseInt(serverPort) || port === parseInt(proxyPort)) {
              return 'WebSocket port must be different from other ports';
            }
            return true;
          }
        });

        mkdirSync(configDirPath, { recursive: true });
        console.log(pc.green(`\n✓ Created directory: ${configDirPath}`));

        writeFileSync(rulesPath, '', 'utf8');
        console.log(pc.green(`✓ Created file: ${rulesPath}`));

        const config = {
          serverPort: parseInt(serverPort),
          serverHost: 'localhost',
          serverProtocol: 'http',
          noProxy: !needsProxy,
          proxyPort: parseInt(proxyPort),
          proxyHost: 'localhost',
          proxyProtocol: 'http',
          wsPort: parseInt(wsPort),
          wsHost: 'localhost',
          wsProtocol: 'ws',
          injectAt: '</head>'
        };

        writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
        console.log(pc.green(`✓ Created file: ${configPath}`));

        console.log(pc.cyan('\n✨ Configuration created successfully!\n'));
        console.log(pc.gray('Your configuration:'));
        console.log(pc.gray(`  Server port:     ${config.serverPort}`));
        console.log(pc.gray(`  Proxy enabled:   ${!config.noProxy}`));
        if (!config.noProxy) {
          console.log(pc.gray(`  Proxy port:      ${config.proxyPort}`));
        }
        console.log(pc.gray(`  WebSocket port:  ${config.wsPort}\n`));

        console.log(pc.cyan('Next steps:'));
        console.log(pc.gray('  • Edit rules.md to add custom prompt rules'));
        console.log(pc.gray('  • Run "jsx-tool start" to start the dev server\n'));

        process.exit(0);
      } catch (error) {
        if (error instanceof Error && error.name === 'ExitPromptError') {
          console.log(pc.yellow('\n\nSetup cancelled by user.'));
          process.exit(0);
        }
        throw error;
      }
    });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  await program.parseAsync(process.argv);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(pc.red('Fatal error:'), error);
    process.exit(1);
  });
}

export { main };
