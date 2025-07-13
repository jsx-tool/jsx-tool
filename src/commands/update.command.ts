import type { Command } from 'commander';
import { container } from 'tsyringe';
import { VersionManagerService } from '../services/version-manager.service';

export class UpdateCommand {
  public static register (program: Command): void {
    program
      .command('update')
      .description('Check for updates and update to the latest version')
      .action(async () => {
        await UpdateCommand.execute();
      });
  }

  public static async checkForUpdates (silent = false): Promise<void> {
    const versionManager = container.resolve(VersionManagerService);
    const currentVersion = versionManager.getCurrentVersion();

    try {
      const latestVersion = await versionManager.getLatestVersion();

      if (latestVersion !== currentVersion) {
        console.log(`\nA new version of @filemap/cli is available: ${latestVersion} (current: ${currentVersion})`);
        console.log('Run: npm install -g @filemap/cli\n');
      } else if (!silent) {
        console.log(`[filemap] You are using the latest version (${currentVersion}).`);
      }
    } catch (err) {
      const errorMessage = (typeof err === 'object' && err && 'message' in err) ? (err as any).message : String(err);

      if (errorMessage.includes('PackageNotFoundError') || errorMessage.includes('could not be found')) {
        if (!silent) {
          console.log('[filemap] Skipping update check - package not published yet (development mode)');
        }
      } else {
        if (!silent) {
          console.error('[filemap] Could not check for updates:', errorMessage);
        }
      }
    }
  }

  private static async execute (): Promise<void> {
    await UpdateCommand.checkForUpdates(false);
  }
}
