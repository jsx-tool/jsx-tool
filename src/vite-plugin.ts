import 'reflect-metadata';
import { container } from 'tsyringe';
import type { Server } from 'http';
import { ViteApplication } from './vite-app';
import { WorkingDirectoryValidationService } from './services/working-directory-validation.service';
import { Logger } from './services/logger.service';

export type DevServerLike = {
  httpServer?: any
} & Record<string, any>;

export interface JSXToolViteConfig {
  debug?: boolean
  insecure?: boolean
  nodeModulesDir?: string
  additionalDirectories?: string[]
  alwaysBypassMemoryLimits?: boolean
}

export function jsxToolDevServer (
  options: JSXToolViteConfig = { debug: false, nodeModulesDir: undefined, additionalDirectories: [], alwaysBypassMemoryLimits: false }
) {
  const logger = container.resolve(Logger);
  const workingDirectoryValidationService = container.resolve(WorkingDirectoryValidationService);
  if (options.debug) {
    logger.setDebug(true);
  } else {
    logger.setSilence(true);
  }
  const app = container.resolve(ViteApplication);
  const toolsConfig = app.getContainerConfig();
  toolsConfig.isViteInstallation = true;

  const decode = (s: string) => s.split('').map(c =>
    String.fromCharCode(c.charCodeAt(0) - 3)
  ).join('');

  return {
    name: 'jsx-tool-dev-server',
    apply: 'serve' as const,

    configureServer (server: any) {
      if (server?.httpServer && app.started && !app.serverStarted) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        server.httpServer?.once('listening', () => {
          app.startWithServer(server.httpServer as Server, server);
        });
        return () => { app.stop(); };
      }
    },

    config (_config: any, env: any) {
      if (env.command !== 'serve') {
        return {};
      }
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

    configResolved (userConfig: any) {
      if (app.started) {
        return;
      }
      const root = userConfig?.root as string | undefined;
      const server = userConfig?.server;
      if (!root || !server) return;

      const wsHost = typeof server.host === 'string' ? server.host : 'localhost';
      const wsPort = server.port ?? 5173;
      const wsProtocol = server.https ? 'wss' : 'ws';
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
      toolsConfig.loadFromFile(root);
      toolsConfig.setFromViteOptions({
        wsPort,
        wsHost,
        wsProtocol: wsProtocol as 'ws' | 'wss',
        debug: options.debug,
        nodeModulesDir: options.nodeModulesDir ?? root,
        additionalDirectories: options?.additionalDirectories ?? [],
        insecure: options?.insecure ?? false
      });

      app.setDidStart();
      const wsUrl = `${wsProtocol}://${wsHost}:${wsPort}`;
      if (!userConfig.define) {
        userConfig.define = {};
      }
      userConfig.define.__JSX_TOOL_DEV_SERVER_WS_URL__ = JSON.stringify(`${wsUrl}/jsx-tool-socket`);
    },
    transform (code: string, id: string) {
      if (!options?.alwaysBypassMemoryLimits && !toolsConfig.shouldModifyNextObjectCounter) {
        return null;
      }
      const regex = /\/node_modules\/\.vite\/deps\/(chunk-.*|react_jsx-dev-runtime\.js)/;

      if (regex.test(id)) {
        const searchPattern = decode('4h7#A#UhdfwVkduhgLqwhuqdov');
        const replacePattern = decode('4h9#A#UhdfwVkduhgLqwhuqdov');

        const searchRegex = new RegExp(searchPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');

        if (searchRegex.test(code)) {
          const modifiedCode = code.replace(searchRegex, replacePattern);
          return {
            code: modifiedCode,
            map: null
          };
        }
      }

      return null;
    }
  };
}

export default jsxToolDevServer;
