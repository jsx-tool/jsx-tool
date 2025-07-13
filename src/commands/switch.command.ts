import type { Command } from 'commander';
import { container } from 'tsyringe';
import inquirer from 'inquirer';
import { VersionManagerService } from '../services/version-manager.service';

export class SwitchCommand {
  public static register (program: Command): void {
    program
      .command('switch [version]')
      .description('Switch to a specific version of filemap CLI')
      .action(async (version?: string) => {
        await SwitchCommand.execute(version);
      });
  }

  private static async execute (version?: string): Promise<void> {
    const versionManager = container.resolve(VersionManagerService);

    if (!version) {
      await SwitchCommand.interactiveSwitch(versionManager);
    } else {
      await SwitchCommand.switchToVersion(versionManager, version);
    }
  }

  private static async interactiveSwitch (versionManager: VersionManagerService): Promise<void> {
    console.log('[filemap] Fetching available versions...');

    const currentVersion = versionManager.getCurrentVersion();
    const latestVersion = await versionManager.getLatestVersion();

    if (!latestVersion) {
      console.error('[filemap] Could not fetch available versions.');
      return;
    }

    const { selectedVersion } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedVersion',
        message: `Select a version to switch to (current: ${currentVersion}):`,
        choices: [
          {
            name: latestVersion === currentVersion ? `${latestVersion} (current)` : latestVersion,
            value: latestVersion
          }
        ]
      }
    ]);

    if (selectedVersion === currentVersion) {
      console.log('[filemap] You are already on the selected version.');
      return;
    }

    await SwitchCommand.switchToVersion(versionManager, selectedVersion);
  }

  private static async switchToVersion (versionManager: VersionManagerService, version: string): Promise<void> {
    const success = await versionManager.switchToVersion(version);
    if (!success) {
      process.exit(1);
    }
  }
}
