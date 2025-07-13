import { injectable, singleton } from 'tsyringe';
import { execSync } from 'child_process';
import latestVersion from 'latest-version';
import { readFileSync } from 'fs';
import { join } from 'path';

const PKG_NAME = '@filemap/cli';

export interface VersionInfo {
  current: string
  available: string[]
  latest: string
}

@singleton()
@injectable()
export class VersionManagerService {
  async getAvailableVersions (): Promise<string[]> {
    try {
      const latest = await latestVersion(PKG_NAME);
      return [latest];
    } catch (error) {
      console.error('[filemap] Could not fetch available versions:', error);
      return [];
    }
  }

  getCurrentVersion (): string {
    try {
      const pkgPath = join(__dirname, '../../package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      return pkg.version;
    } catch {
      return 'unknown';
    }
  }

  async getVersionInfo (): Promise<VersionInfo> {
    const current = this.getCurrentVersion();
    const available = await this.getAvailableVersions();
    const latest = available[0] || current;

    return {
      current,
      available,
      latest
    };
  }

  async switchToVersion (version: string): Promise<boolean> {
    try {
      console.log(`[filemap] Switching to version ${version}...`);
      execSync(`npm install -g ${PKG_NAME}@${version}`, { stdio: 'inherit' });
      console.log(`[filemap] Successfully switched to version ${version}`);
      return true;
    } catch (error) {
      console.error(`[filemap] Failed to switch to version ${version}:`, error);
      console.log('[filemap] You can manually switch by running:');
      console.log(`  npm install -g ${PKG_NAME}@${version}`);
      return false;
    }
  }

  async getLatestVersion (): Promise<string> {
    try {
      return await latestVersion(PKG_NAME);
    } catch (error) {
      console.error('[filemap] Could not fetch latest version:', error);
      return this.getCurrentVersion();
    }
  }
}
