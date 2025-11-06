import 'reflect-metadata';
import { container } from 'tsyringe';
import { LspService } from '../services/lsp.service';
import { DiagnosticCheckerService } from '../services/diagnostic-checker.service';
import { ConfigService } from '../services/config.service';
import { Logger } from '../services/logger.service';
import type { JSXToolConfig } from '../types/config';

let lspService: LspService;
let diagnosticChecker: DiagnosticCheckerService;
let logger: Logger;
let isInitialized = false;

process.send!({ type: 'ready' });

process.on('message', async (message: any) => {
  try {
    switch (message.type) {
      case 'init_worker': {
        await initializeWorker(message.config);
        process.send!({ type: 'worker_initialized' });
        break;
      }

      case 'initialize':
        if (!isInitialized) {
          logger.error('Worker not initialized - call init_worker first');
          process.send!({
            type: 'error',
            requestId: message.requestId,
            error: 'Worker not initialized'
          });
          break;
        }
        await lspService.initialize();
        process.send!({ type: 'initialized' });
        break;

      case 'jsonrpc':
        if (!isInitialized) {
          process.send!({
            type: 'error',
            requestId: message.requestId,
            error: 'Worker not initialized'
          });
          break;
        }
        {
          const response = await lspService.handleJsonRpc(message.payload);
          process.send!({
            type: 'jsonrpc_response',
            requestId: message.requestId,
            payload: response
          });
        }
        break;

      case 'update_file':
        if (!isInitialized) break;
        lspService.updateFile(message.uri, message.content);
        process.send!({ type: 'file_updated' });
        break;

      case 'start_watchers':
        if (!isInitialized) break;
        lspService.startFileWatchers();
        process.send!({ type: 'watchers_started' });
        break;

      case 'init_open_files':
        if (!isInitialized) {
          process.send!({
            type: 'error',
            requestId: message.requestId,
            error: 'Worker not initialized'
          });
          break;
        }
        await diagnosticChecker.initializeOpenFiles(message.files);
        process.send!({
          type: 'open_files_initialized',
          requestId: message.requestId
        });
        break;

      case 'check_diagnostics':
        if (!isInitialized) {
          process.send!({
            type: 'error',
            requestId: message.requestId,
            error: 'Worker not initialized'
          });
          break;
        }
        {
          const result = await diagnosticChecker.checkFiles(message.files);
          process.send!({
            type: 'diagnostics_result',
            requestId: message.requestId,
            payload: result
          });
        }
        break;

      case 'shutdown':
        if (isInitialized) {
          lspService.cleanup();
        }
        process.exit(0);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    process.send!({
      type: 'error',
      requestId: message.requestId,
      error: errorMessage
    });
  }
});

async function initializeWorker (config: Partial<JSXToolConfig>): Promise<void> {
  const configService = container.resolve(ConfigService);
  if (config.workingDirectory) {
    configService.setWorkingDirectory(config.workingDirectory);
  }
  if (config.nodeModulesDir) {
    configService.setNodeModulesDirectory(config.nodeModulesDir);
  }

  await configService.loadFromFile(config.workingDirectory);

  configService.setFromCliOptions(config);

  logger = container.resolve(Logger);
  logger.setDebug(config.debug ?? false);
  if (config.logging || config.debug) {
    logger.setSilence(false);
  } else {
    logger.setSilence(true);
  }

  lspService = container.resolve(LspService);
  diagnosticChecker = container.resolve(DiagnosticCheckerService);

  lspService.listen((response) => {
    process.send!({ type: 'lsp_broadcast', payload: response });
  });

  isInitialized = true;
  logger.info('LSP worker initialized with config from parent');
}

process.on('uncaughtException', (error) => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  process.send!({
    type: 'error',
    error: `Uncaught exception: ${errorMessage}`
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  const errorMessage = reason instanceof Error ? reason.message : String(reason);
  process.send!({
    type: 'error',
    error: `Unhandled rejection: ${errorMessage}`
  });
  process.exit(1);
});
