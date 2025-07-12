import { injectable, singleton } from 'tsyringe';
import { resolve, join } from 'path';
import { existsSync, readFileSync } from 'fs';
import type { FilemapConfig } from '../types/config';
import { DEFAULT_CONFIG } from '../types/config';
import pc from 'picocolors';

@singleton()
@injectable()
export class ConfigService {
  private config: FilemapConfig = { ...DEFAULT_CONFIG };

  constructor () {
    this.loadFromEnvironment();
  }

  private loadFromEnvironment (): void {
    if (process.env.FILEMAP_SERVER_PORT) this.config.serverPort = parseInt(process.env.FILEMAP_SERVER_PORT);
    if (process.env.FILEMAP_SERVER_HOST) this.config.serverHost = process.env.FILEMAP_SERVER_HOST;
    if (process.env.FILEMAP_PROXY_PORT) this.config.proxyPort = parseInt(process.env.FILEMAP_PROXY_PORT);
    if (process.env.FILEMAP_PROXY_HOST) this.config.proxyHost = process.env.FILEMAP_PROXY_HOST;
    if (process.env.FILEMAP_WS_PORT) this.config.wsPort = parseInt(process.env.FILEMAP_WS_PORT);
    if (process.env.FILEMAP_WS_HOST) this.config.wsHost = process.env.FILEMAP_WS_HOST;
  }

  async loadFromFile (directory?: string): Promise<void> {
    const dir = directory || this.config.workingDirectory;
    const configPath = join(resolve(dir), 'filemap.json');
    console.log('[filemap] Attempting to load config from:', configPath);

    if (existsSync(configPath)) {
      try {
        const fileContent = readFileSync(configPath, 'utf8');
        const fileConfig = JSON.parse(fileContent);

        this.config = { ...this.config, ...fileConfig };
        console.log('[filemap] Loaded config:', this.config);

        if (this.config.debug) {
          console.log(pc.gray(`Loaded config from ${configPath}`));
        }
      } catch (error) {
        console.error(pc.red(`Error loading config from ${configPath}:`), error);
      }
    }
  }

  setFromCliOptions (options: Partial<FilemapConfig>): void {
    const filteredOptions: Partial<FilemapConfig> = {};
    
    Object.entries(options).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        (filteredOptions as any)[key] = value;
      }
    });

    this.config = { ...this.config, ...filteredOptions };
    
    if (this.config.debug) {
      console.log('[filemap] Final config after CLI options:', this.config);
    }
  }

  setWorkingDirectory (path: string): void {
    if (!path) {
      throw new Error('Working directory path cannot be undefined or empty');
    }
    this.config.workingDirectory = resolve(path);
  }

  getConfig (): Readonly<FilemapConfig> {
    return { ...this.config };
  }

  validate (): { valid: boolean, errors: string[] } {
    const errors: string[] = [];

    if (this.config.serverPort < 1 || this.config.serverPort > 65535) {
      errors.push('Server port must be between 1 and 65535');
    }
    if (this.config.proxyPort < 1 || this.config.proxyPort > 65535) {
      errors.push('Proxy port must be between 1 and 65535');
    }
    if (this.config.wsPort < 1 || this.config.wsPort > 65535) {
      errors.push('WebSocket port must be between 1 and 65535');
    }

    if (!['http', 'https'].includes(this.config.serverProtocol)) {
      errors.push('Server protocol must be http or https');
    }
    if (!['http', 'https'].includes(this.config.proxyProtocol)) {
      errors.push('Proxy protocol must be http or https');
    }
    if (!['ws', 'wss'].includes(this.config.wsProtocol)) {
      errors.push('WebSocket protocol must be ws or wss');
    }

    return { valid: errors.length === 0, errors };
  }
}
