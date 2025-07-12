import { injectable, singleton } from 'tsyringe';
import { promises as fs } from 'fs';
import { join } from 'path';
import inquirer from 'inquirer';
import { existsSync, readFileSync } from 'fs';

const DEFAULT_CONFIG = {
  serverPort: 3000,
  serverHost: 'localhost',
  serverProtocol: 'http',
  proxyPort: 4000,
  proxyHost: 'localhost',
  proxyProtocol: 'http',
  wsPort: 3002,
  wsHost: 'localhost',
  wsProtocol: 'ws',
  debug: false,
  injectAt: '</head>'
};

export interface ConfigCreationResult {
  created: boolean;
  updated: boolean;
  message: string;
  error?: string;
}

export interface InteractiveConfigOptions {
  interactive?: boolean;
  directory?: string;
  allOptions?: boolean;
}

@singleton()
@injectable()
export class ConfigManagerService {
  async createConfigFile(directory: string = process.cwd(), options: InteractiveConfigOptions = {}): Promise<ConfigCreationResult> {
    const configPath = join(directory, 'filemap.json'); 

    const reactValidation = this.validateReactApp(directory);
    if (!reactValidation.isValid) {
      return {
        created: false,
        updated: false,
        message: '[filemap] Cannot initialize filemap in a non-React project.',
        error: reactValidation.error
      };
    }
    
    let existingConfig = null;
    let isUpdate = false;
    
    try {
      await fs.access(configPath);
      const fileContent = await fs.readFile(configPath, 'utf8');
      existingConfig = JSON.parse(fileContent);
      isUpdate = true;
    } catch {
      existingConfig = { ...DEFAULT_CONFIG };
    }
    
    let config = { ...existingConfig };
    
    if (options.interactive) {
      config = await this.promptForConfiguration(options.allOptions, existingConfig);
    }
    
    await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
    
    if (isUpdate) {
      return {
        created: false,
        updated: true,
        message: '[filemap] Updated filemap.json in the current directory.'
      };
    } else {
      return {
        created: true,
        updated: false,
        message: '[filemap] Created filemap.json in the current directory.'
      };
    }
  }

  private validateReactApp(directory: string): { isValid: boolean; error?: string } {
    const packageJsonPath = join(directory, 'package.json');
    
    if (!existsSync(packageJsonPath)) {
      return {
        isValid: false,
        error: 'No package.json found. This does not appear to be a Node.js project.'
      };
    }

    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
      const dependencies = packageJson.dependencies || {};
      const devDependencies = packageJson.devDependencies || {};
      
      const hasReact = dependencies.react || devDependencies.react;
      
      if (!hasReact) {
        return {
          isValid: false,
          error: 'React is not listed in package.json dependencies. This does not appear to be a React project.'
        };
      }

      return { isValid: true };
    } catch (error) {
      return {
        isValid: false,
        error: 'Could not read or parse package.json.'
      };
    }
  }

  private async promptForConfiguration(allOptions = false, existingConfig?: any) {
    if (allOptions) {
      return this.promptForAllConfiguration(existingConfig);
    } else {
      return this.promptForPortConfiguration(existingConfig);
    }
  }

  private async promptForPortConfiguration(existingConfig?: any) {
    const currentConfig = existingConfig || DEFAULT_CONFIG;
    
    console.log('\n[filemap] Port Configuration Setup\n');
    console.log('Configure the ports for your filemap development server:\n');
    
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'serverPort',
        message: 'Application server port (where your React app runs):',
        default: currentConfig.serverPort?.toString() || DEFAULT_CONFIG.serverPort.toString(),
        validate: (input: string) => {
          const port = parseInt(input);
          return (port >= 1 && port <= 65535) ? true : 'Port must be between 1 and 65535';
        },
        filter: (input: string) => parseInt(input)
      },
      {
        type: 'input',
        name: 'proxyPort',
        message: 'Filemap server port (where you will access your app when filemap runs):',
        default: currentConfig.proxyPort?.toString() || DEFAULT_CONFIG.proxyPort.toString(),
        validate: (input: string) => {
          const port = parseInt(input);
          return (port >= 1 && port <= 65535) ? true : 'Port must be between 1 and 65535';
        },
        filter: (input: string) => parseInt(input)
      },
      {
        type: 'input',
        name: 'wsPort',
        message: 'WebSocket server port:',
        default: currentConfig.wsPort?.toString() || DEFAULT_CONFIG.wsPort.toString(),
        validate: (input: string) => {
          const port = parseInt(input);
          return (port >= 1 && port <= 65535) ? true : 'Port must be between 1 and 65535';
        },
        filter: (input: string) => parseInt(input)
      }
    ]);

    return {
      ...currentConfig,
      ...answers
    };
  }

  private async promptForAllConfiguration(existingConfig?: any) {
    const currentConfig = existingConfig || DEFAULT_CONFIG;
    
    console.log('\n[filemap] Full Configuration Setup\n');
    console.log('Configure all settings for your filemap development server:\n');
    
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'serverPort',
        message: 'Application server port (where your React app runs):',
        default: currentConfig.serverPort?.toString() || DEFAULT_CONFIG.serverPort.toString(),
        validate: (input: string) => {
          const port = parseInt(input);
          return (port >= 1 && port <= 65535) ? true : 'Port must be between 1 and 65535';
        },
        filter: (input: string) => parseInt(input)
      },
      {
        type: 'input',
        name: 'proxyPort',
        message: 'Filemap server port (where you will access your app when filemap runs):',
        default: currentConfig.proxyPort?.toString() || DEFAULT_CONFIG.proxyPort.toString(),
        validate: (input: string) => {
          const port = parseInt(input);
          return (port >= 1 && port <= 65535) ? true : 'Port must be between 1 and 65535';
        },
        filter: (input: string) => parseInt(input)
      },
      {
        type: 'input',
        name: 'wsPort',
        message: 'WebSocket server port:',
        default: currentConfig.wsPort?.toString() || DEFAULT_CONFIG.wsPort.toString(),
        validate: (input: string) => {
          const port = parseInt(input);
          return (port >= 1 && port <= 65535) ? true : 'Port must be between 1 and 65535';
        },
        filter: (input: string) => parseInt(input)
      },
      {
        type: 'input',
        name: 'serverHost',
        message: 'Target server host:',
        default: currentConfig.serverHost || DEFAULT_CONFIG.serverHost
      },
      {
        type: 'list',
        name: 'serverProtocol',
        message: 'Target server protocol:',
        choices: ['http', 'https'],
        default: currentConfig.serverProtocol || DEFAULT_CONFIG.serverProtocol
      },
      {
        type: 'list',
        name: 'proxyProtocol',
        message: 'Proxy server protocol:',
        choices: ['http', 'https'],
        default: currentConfig.proxyProtocol || DEFAULT_CONFIG.proxyProtocol
      },
      {
        type: 'list',
        name: 'wsProtocol',
        message: 'WebSocket protocol:',
        choices: ['ws', 'wss'],
        default: currentConfig.wsProtocol || DEFAULT_CONFIG.wsProtocol
      },
      {
        type: 'confirm',
        name: 'debug',
        message: 'Enable debug logging?',
        default: currentConfig.debug !== undefined ? currentConfig.debug : DEFAULT_CONFIG.debug
      },
      {
        type: 'input',
        name: 'injectAt',
        message: 'HTML injection point:',
        default: currentConfig.injectAt || DEFAULT_CONFIG.injectAt
      }
    ]);

    return {
      ...currentConfig,
      ...answers
    };
  }

  getDefaultConfig() {
    return { ...DEFAULT_CONFIG };
  }
} 