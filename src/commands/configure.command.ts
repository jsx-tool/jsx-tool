import { Command } from 'commander';
import { container } from 'tsyringe';
import { ConfigManagerService } from '../services/config-manager.service';

export class ConfigureCommand {
  public static register(program: Command): void {
    program
      .command('configure')
      .description('Configure filemap.json for your React project')
      .option('-a, --all', 'Configure all settings (not just ports)')
      .option('-d, --directory <path>', 'Directory to create filemap.json in', process.cwd())
      .option('--no-interactive', 'Create with default settings (non-interactive)')
      .action(async (options) => {
        await ConfigureCommand.execute(options);
      });
  }

  private static async execute(options: { all?: boolean; directory?: string; interactive?: boolean }): Promise<void> {
    const configManager = container.resolve(ConfigManagerService);
    const result = await configManager.createConfigFile(options.directory, { 
      interactive: options.interactive !== false,
      allOptions: options.all 
    });
    
    if (result.error) {
      console.error(result.message);
      console.error(`Error: ${result.error}`);
      process.exit(1);
    } else {
      console.log(result.message);
    }
  }
} 