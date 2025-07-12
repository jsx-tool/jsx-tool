import 'reflect-metadata';
import { Command } from 'commander';
import pc from 'picocolors';
import { StartCommand } from './commands/start.command';
import { UpdateCommand } from './commands/update.command';
import { ConfigureCommand } from './commands/configure.command';
import { SwitchCommand } from './commands/switch.command';

async function main () {
  const program = new Command();

  program
    .name('filemap')
    .description('Development proxy server')
    .version('1.0.0')
    .helpOption('-h, --help', 'display help for command');

  StartCommand.register(program);
  UpdateCommand.register(program);
  ConfigureCommand.register(program);
  SwitchCommand.register(program);

  program.action(() => {
    program.help();
  });

  const isUpdateCmd = process.argv.includes('update');
  if (!isUpdateCmd) {
    await UpdateCommand.checkForUpdates(true);
  }

  await program.parseAsync(process.argv);
}

main().catch((error) => {
  console.error(pc.red('Fatal error:'), error);
  process.exit(1);
});

export { main };
