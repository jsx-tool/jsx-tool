import { injectable, singleton } from 'tsyringe';
import { resolve, join } from 'path';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import type { JSXToolConfig } from '../types/config';
import { DEFAULT_CONFIG } from '../types/config';
import pc from 'picocolors';

@singleton()
@injectable()
export class ConfigService {
  private config: JSXToolConfig = { ...DEFAULT_CONFIG };
  private promptRulesPath?: string;
  private terminalSecretPath!: string;
  public shouldModifyNextObjectCounter: boolean = false;
  public isViteInstallation: boolean = false;
  public fullReload: () => void = () => { };

  constructor () {
    this.loadFromEnvironment();
  }

  private loadFromEnvironment (): void {
    if (process.env.JSX_TOOL_NO_PROXY) this.config.noProxy = process.env.JSX_TOOL_NO_PROXY === 'TRUE';
    if (process.env.JSX_TOOL_SERVER_PORT) this.config.serverPort = parseInt(process.env.JSX_TOOL_SERVER_PORT);
    if (process.env.JSX_TOOL_SERVER_HOST) this.config.serverHost = process.env.JSX_TOOL_SERVER_HOST;
    if (process.env.JSX_TOOL_PROXY_PORT) this.config.proxyPort = parseInt(process.env.JSX_TOOL_PROXY_PORT);
    if (process.env.JSX_TOOL_PROXY_HOST) this.config.proxyHost = process.env.JSX_TOOL_PROXY_HOST;
    if (process.env.JSX_TOOL_WS_PORT) this.config.wsPort = parseInt(process.env.JSX_TOOL_WS_PORT);
    if (process.env.JSX_TOOL_WS_HOST) this.config.wsHost = process.env.JSX_TOOL_WS_HOST;
    if (process.env.JSX_TOOL_NODE_MODULES_DIR) this.config.nodeModulesDir = process.env.JSX_TOOL_NODE_MODULES_DIR;
    if (process.env.JSX_TOOL_INSECURE) this.config.insecure = process.env.JSX_TOOL_INSECURE === 'TRUE';
    if (process.env.JSX_TOOL_ENABLE_LOGGING) this.config.insecure = process.env.JSX_TOOL_ENABLE_LOGGING === 'TRUE';
    if (process.env.JSX_TOOL_ADDITIONAL_DIRECTORIES) {
      this.config.additionalDirectories = process.env.JSX_TOOL_ADDITIONAL_DIRECTORIES
        .split(',')
        .map(dir => dir.trim())
        .filter(dir => dir.length > 0);
    }
  }

  async loadFromFile (directory?: string): Promise<void> {
    const dir = directory || this.config.workingDirectory;
    const configDirPath = join(resolve(dir), '.jsxtool');
    const configPath = join(configDirPath, 'config.json');
    const promptRules = join(configDirPath, 'rules.md');
    this.promptRulesPath = promptRules;
    this.terminalSecretPath = join(configDirPath, 'terminal-secret');

    if (existsSync(configPath)) {
      try {
        const fileContent = readFileSync(configPath, 'utf8');
        const fileConfig = JSON.parse(fileContent);
        this.config = { ...this.config, ...fileConfig };

        if (this.config.debug) {
          console.log(pc.gray(`Loaded config from ${configPath}`));
        }
      } catch (error) {
        console.error(pc.red(`Error loading config from ${configPath}:`), error);
      }
    }
  }

  getPromptRules () {
    if (this.promptRulesPath && existsSync(this.promptRulesPath)) {
      try {
        const fileContent = readFileSync(this.promptRulesPath, 'utf8');
        return fileContent;
      } catch (error) {
        return null;
      }
    }
    return null;
  }

  getTerminalSecretPath () {
    return this.terminalSecretPath;
  }

  setShouldModifyNextObjectCounter (shouldModifyNextObjectCounter: boolean) {
    this.shouldModifyNextObjectCounter = shouldModifyNextObjectCounter;
  }

  setFromCliOptions (options: Partial<JSXToolConfig>): void {
    this.config = { ...this.config, ...options };
  }

  setFromViteOptions (options: Partial<JSXToolConfig>): void {
    this.config = { ...this.config, ...options };
  }

  setWorkingDirectory (path: string): void {
    this.config.workingDirectory = resolve(path);
  }

  setNodeModulesDirectory (path: string): void {
    this.config.nodeModulesDir = resolve(path);
  }

  getConfig (): Readonly<JSXToolConfig> {
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

    if (this.config.nodeModulesDir) {
      const nodeModulesPath = join(this.config.nodeModulesDir, 'node_modules');
      if (!existsSync(nodeModulesPath)) {
        errors.push(`node_modules directory not found at: ${nodeModulesPath}`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  ensureGitIgnore (): void {
    const workingDir = this.config.workingDirectory;
    if (!workingDir) return;

    const jsxToolDir = join(workingDir, '.jsxtool');
    if (!existsSync(jsxToolDir)) {
      mkdirSync(jsxToolDir, { recursive: true });
    }

    const gitignorePath = join(jsxToolDir, '.gitignore');
    const requiredEntries = ['host-keys', 'terminal-secret'];

    let content = '';
    if (existsSync(gitignorePath)) {
      content = readFileSync(gitignorePath, 'utf8');
    } else {
      content = '# Ignore all host authentication keys\n';
    }

    const lines = content.split('\n').map(line => line.trim());
    let modified = false;

    requiredEntries.forEach(entry => {
      if (!lines.includes(entry)) {
        if (content.length > 0 && !content.endsWith('\n')) {
          content += '\n';
        }
        content += `${entry}\n`;
        modified = true;
      }
    });

    if (modified || !existsSync(gitignorePath)) {
      writeFileSync(gitignorePath, content, 'utf8');
    }
  }
}
