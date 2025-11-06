import { injectable, inject, singleton } from 'tsyringe';
import type { ChildProcess } from 'child_process';
import { fork } from 'child_process';
import { join } from 'path';
import { Logger } from './logger.service';
import { ConfigService } from './config.service';
import type { LspJsonRpcRequest, LspJsonRpcResponse } from './lsp.service';
import type { OpenFileInfo, DiagnosticCheckResult } from './diagnostic-checker.service';

interface PendingRequest {
  resolve: (value: any) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

@singleton()
@injectable()
export class LspWorkerManagerService {
  private worker?: ChildProcess;
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private requestIdCounter = 0;
  private listeners: Array<(response: LspJsonRpcResponse) => void> = [];
  private isReady = false;
  private readyPromise: Promise<void>;
  private readyResolve?: () => void;

  constructor (
    @inject(Logger) private readonly logger: Logger,
    @inject(ConfigService) private readonly configService: ConfigService
  ) {
    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve;
    });
  }

  async start (): Promise<void> {
    if (this.worker) {
      this.logger.warn('LSP worker already started');
      return;
    }

    const workerPath = join(__dirname, '../workers/lsp-worker.js');

    this.worker = fork(workerPath, [], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      env: process.env
    });

    this.worker.on('message', (message: any) => {
      this.handleWorkerMessage(message);
    });

    this.worker.on('error', (error) => {
      this.logger.error(`LSP worker error: ${error.message}`);
      this.restart();
    });

    this.worker.on('exit', (code) => {
      this.logger.warn(`LSP worker exited with code ${code}`);
      if (code !== 0) {
        this.restart();
      }
    });

    await this.readyPromise;

    const config = this.configService.getConfig();
    this.sendMessage({
      type: 'init_worker',
      config: {
        workingDirectory: config.workingDirectory,
        nodeModulesDir: config.nodeModulesDir,
        additionalDirectories: config.additionalDirectories,
        debug: config.debug,
        logging: config.logging,
        insecure: config.insecure
      }
    });

    this.sendMessage({ type: 'initialize' });
    this.logger.success('LSP worker started successfully');
  }

  private handleWorkerMessage (message: any): void {
    switch (message.type) {
      case 'ready':
        this.isReady = true;
        if (this.readyResolve) {
          this.readyResolve();
        }
        break;

      case 'initialized':
        this.logger.info('LSP worker initialized');
        break;

      case 'jsonrpc_response':
        this.handleJsonRpcResponse(message);
        break;

      case 'lsp_broadcast':
        this.broadcast(message.payload);
        break;

      case 'open_files_initialized':
      case 'diagnostics_result':
        this.handleGenericResponse(message);
        break;

      case 'error':
        this.handleErrorResponse(message);
        break;

      case 'file_updated':
      case 'watchers_started':
        break;
    }
  }

  private handleJsonRpcResponse (message: any): void {
    const pending = this.pendingRequests.get(message.requestId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(message.requestId);
      pending.resolve(message.payload);
    }
  }

  private handleGenericResponse (message: any): void {
    const pending = this.pendingRequests.get(message.requestId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(message.requestId);
      pending.resolve(message.payload);
    }
  }

  private handleErrorResponse (message: any): void {
    const pending = this.pendingRequests.get(message.requestId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(message.requestId);
      pending.reject(new Error(message.error));
    } else {
      this.logger.error(`LSP worker error: ${message.error}`);
    }
  }

  async handleJsonRpc (request: LspJsonRpcRequest): Promise<LspJsonRpcResponse | null> {
    const requestId = `req_${this.requestIdCounter++}`;

    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('LSP request timeout'));
      }, 30000);

      this.pendingRequests.set(requestId, { resolve, reject, timeout });

      this.sendMessage({
        type: 'jsonrpc',
        requestId,
        payload: request
      });
    });
  }

  updateFile (uri: string, content: string): void {
    this.sendMessage({
      type: 'update_file',
      uri,
      content
    });
  }

  startFileWatchers (): void {
    this.sendMessage({
      type: 'start_watchers'
    });
  }

  async initializeOpenFiles (files: OpenFileInfo[]): Promise<void> {
    const requestId = `req_${this.requestIdCounter++}`;

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Initialize open files timeout'));
      }, 30000);

      this.pendingRequests.set(requestId, { resolve, reject, timeout });

      this.sendMessage({
        type: 'init_open_files',
        requestId,
        files
      });
    });
  }

  async checkDiagnostics (
    files: Array<string | { filePath: string, buffer?: string }>
  ): Promise<DiagnosticCheckResult> {
    const requestId = `req_${this.requestIdCounter++}`;

    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Check diagnostics timeout'));
      }, 30000);

      this.pendingRequests.set(requestId, { resolve, reject, timeout });

      this.sendMessage({
        type: 'check_diagnostics',
        requestId,
        files
      });
    });
  }

  listen (listener: (response: LspJsonRpcResponse) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private broadcast (response: LspJsonRpcResponse): void {
    this.listeners.forEach(l => { l(response); });
  }

  private sendMessage (message: any): void {
    if (!this.worker || !this.isReady) {
      this.logger.warn('LSP worker not ready, message queued');
      return;
    }
    this.worker.send(message);
  }

  private async restart (): Promise<void> {
    this.logger.info('Restarting LSP worker...');

    if (this.worker) {
      this.worker.removeAllListeners();
      this.worker.kill();
    }

    this.pendingRequests.forEach((pending) => {
      clearTimeout(pending.timeout);
      pending.reject(new Error('LSP worker restarted'));
    });
    this.pendingRequests.clear();

    this.isReady = false;
    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve;
    });

    await this.start();
  }

  async stop (): Promise<void> {
    if (!this.worker) return;

    this.sendMessage({ type: 'shutdown' });

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this.worker?.kill('SIGKILL');
        resolve();
      }, 5000);

      this.worker?.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    this.worker = undefined;
    this.logger.info('LSP worker stopped');
  }
}
