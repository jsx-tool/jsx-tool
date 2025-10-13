import 'reflect-metadata';
import { container } from 'tsyringe';
import type { Server } from 'http';
import { ViteApplication } from './vite-app';
import { WorkingDirectoryValidationService } from './services/working-directory-validation.service';
import { Logger } from './services/logger.service';

export type DevServerLike = {
  httpServer?: any
} & Record<string, any>;

export interface PluginLike {
  name: string
  apply?: 'serve' | 'build' | ((config: any, env: any) => boolean)
  enforce?: 'pre' | 'post'
  configureServer?: Function | undefined
  config?: (config: any, env: any) => any
  configResolved?: (config: any, env: any) => any
}

export interface JSXToolViteConfig {
  debug?: boolean
  nodeModulesDir?: string
  additionalDirectories?: string[]
}

export function jsxToolDevServer (
  options: JSXToolViteConfig = { debug: false, nodeModulesDir: undefined, additionalDirectories: [] }
): PluginLike {
  const logger = container.resolve(Logger);
  const workingDirectoryValidationService = container.resolve(WorkingDirectoryValidationService);
  if (options.debug) {
    logger.setDebug(true);
  } else {
    logger.setSilence(true);
  }
  const app = container.resolve(ViteApplication);

  return {
    name: 'jsx-tool-dev-server',
    apply: 'serve',

    configureServer (server: any) {
      if (server?.httpServer && app.started && !app.serverStarted) {
        server.httpServer?.once('listening', () => {
          app.startWithServer(server.httpServer as Server);
        });
        return () => { app.stop(); };
      }
    },

    config () {
      return {
        define: {
          __JSX_TOOL_DEV_SERVER_WS_URL__: `(() => {
                    const base = import.meta.env.DEV 
                        ? \`\${location.protocol === 'https:' ? 'wss' : 'ws'}://\${location.host}\`
                        : '';
                    return \`\${base}/jsx-tool-socket\`;
                })()`
        }
      };
    },

    configResolved (userConfig: any, _env: any) {
      if (app.started) {
        return;
      }
      const root = userConfig?.root as string | undefined;
      const server = userConfig?.server;
      if (!root || !server) return;

      const wsHost = typeof server.host === 'string' ? server.host : 'localhost';
      const wsPort = server.port ?? 5173;
      const wsProtocol = server.https ? 'wss' : 'ws';

      const toolsConfig = app.getContainerConfig();
      logger.setDebug(!!options.debug);

      if (!options.nodeModulesDir) {
        const detectedDir = workingDirectoryValidationService.findNodeModulesWithPackage(root, 'react');
        if (detectedDir) {
          options.nodeModulesDir = detectedDir;
          if (options.debug) logger.debug(`Auto-detected node_modules directory: ${options.nodeModulesDir}`);
        }
      }

      const validation = workingDirectoryValidationService.validateWorkingDirectory(
        root,
        options.nodeModulesDir
      );

      if (!validation.isValid) {
        logger.error('Invalid working directory:');
        validation.errors.forEach(err => { logger.error(`  • ${err}`); });
        return;
      }

      const additionalDirectoriesValidation = workingDirectoryValidationService.validateAdditionalDirectories(
        root,
        options.additionalDirectories ?? []
      );
      if (!additionalDirectoriesValidation.isValid) {
        logger.error('Invalid additional directories:');
        additionalDirectoriesValidation.errors.forEach(err => { logger.error(`  • ${err}`); });
        return;
      }

      toolsConfig.setWorkingDirectory(root);
      toolsConfig.setNodeModulesDirectory(options.nodeModulesDir ?? root);
      toolsConfig.setFromViteOptions({
        wsPort,
        wsHost,
        wsProtocol: wsProtocol as 'ws' | 'wss',
        debug: options.debug,
        nodeModulesDir: options.nodeModulesDir ?? root,
        additionalDirectories: options?.additionalDirectories ?? []
      });

      app.setDidStart();
      const wsUrl = `${wsProtocol}://${wsHost}:${wsPort}`;
      return {
        define: {
          __JSX_TOOL_DEV_SERVER_WS_URL__: JSON.stringify(`${wsUrl}/jsx-tool-socket`)
        }
      };
    }
  };
}

export default jsxToolDevServer;
