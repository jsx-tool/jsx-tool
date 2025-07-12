import { Command } from 'commander';
import { container } from 'tsyringe';
import { ServerManagerService, ServerOptions } from '../services/server-manager.service';

export class StartCommand {
  public static register(program: Command): void {
    program
      .command('start')
      .description('Start the development proxy server')
      .option('-f, --from <path>', 'working directory')
      .option('--server-port <port>', 'target server port')
      .option('--server-host <host>', 'target server host')
      .option('--server-protocol <protocol>', 'target server protocol (http|https)')
      .option('--proxy-port <port>', 'proxy server port')
      .option('--proxy-host <host>', 'proxy server host')
      .option('--proxy-protocol <protocol>', 'proxy server protocol (http|https)')
      .option('--ws-port <port>', 'WebSocket server port')
      .option('--ws-host <host>', 'WebSocket server host')
      .option('--ws-protocol <protocol>', 'WebSocket protocol (ws|wss)')
      .option('-d, --debug', 'enable debug logging')
      .action(async (options) => {
        await StartCommand.execute(options);
      });
  }

  private static async execute(options: any): Promise<void> {
    const serverManager = container.resolve(ServerManagerService);
    
    try {
      await serverManager.startServer(options as ServerOptions);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[filemap] Failed to start server:', message);
      process.exit(1);
    }
  }
}