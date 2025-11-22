import { injectable, inject, singleton } from 'tsyringe';
import { WebSocketServer, WebSocket } from 'ws';
import { createVerify } from 'crypto';
import { ConfigService } from './config.service';
import { Logger } from './logger.service';
import { KeyFetcher } from './key-fetcher.service';
import { KeyManager } from './key-manager.service';
import { SignatureVerifierService } from './signature-verifier.service';
import { LocalKeyService } from './local-key.service';
import { TerminalManagerService } from './terminal-manager.service';
import type {
  ExistsResult,
  LsArgs,
  LsResult,
  ProjectInfo,
  ReadFileArgs,
  ReadFileResult,
  RmResult,
  TreeResult,
  WriteFileArgs,
  WriteFileResult,
  GitStatusResult,
  FileChangeEvent,
  MoveItemsArgs,
  CopyToClipboardArgs,
  ImportItemsArgs,
  MoveItemsResult,
  CopyToClipboardResult,
  ImportItemsResult
} from './file-system-api.service';
import {
  FileSystemApiService
} from './file-system-api.service';
import type { AvailableApis } from './desktop-client-registry.service';
import { DesktopClientRegistryService } from './desktop-client-registry.service';
import { DesktopEmitterService } from './desktop-emitter.service';
import { type Server } from 'http';
import { VERSION } from '../version';
import type { LspJsonRpcRequest, LspJsonRpcResponse } from './lsp.service';
import type { DiagnosticCheckResult, OpenFileInfo } from './diagnostic-checker.service';
import { type RipGrepSearchOptions, type RipGrepSearchResult, RipGrepService } from './ripgrep.service';
import { LspWorkerManagerService } from './lsp-worker-manager.service';

export interface RequestParamMap {
  read_file: ReadFileArgs
  write_file: WriteFileArgs
  exists: {
    filePath: string
  }
  ls: LsArgs
  rm: {
    path: string
  }
  tree: {
    filePath: string
  }
  read_file_many: {
    files: ReadFileArgs[]
  }
  write_file_many: {
    files: WriteFileArgs[]
  }
  exists_many: {
    paths: string[]
  }
  ls_many: {
    dirs: LsArgs[]
  }
  rm_many: {
    paths: Array<{ path: string }>
  }
  tree_many: {
    dirPaths: string[]
  }

  move_items: MoveItemsArgs

  // host-level
  copy_to_clipboard: CopyToClipboardArgs

  import_items: ImportItemsArgs

  // sdk api
  open_element: {
    file_path: string
    line_number: number
    column_number: number
  }
  open_file: {
    file_path: string
  }
  // event api
  get_project_info: unknown
  get_unix_client_info: unknown
  get_prompt_rules: unknown
  get_version: unknown
  get_proxy_info: unknown
  set_should_modify_next_object_counter: {
    shouldModifyNextObjectCounter: boolean
  }
  // lsp
  lsp_request: LspJsonRpcRequest

  open_files: {
    files: OpenFileInfo[]
  }

  check_diagnostics: {
    files: Array<string | {
      filePath: string
      buffer?: string
    }>
  }

  // git
  get_git_status: unknown

  // ripgrep
  search: {
    pattern: string
    options?: RipGrepSearchOptions
  }

  // terminal
  set_terminal_secret: {
    secret: string
  }

  has_terminal_secret: unknown

  check_terminal_secret: {
    secret: string
  }

  create_terminal_session: {
    secret: string
    cols?: number
    rows?: number
  }

  send_terminal_key_strokes: {
    secret: string
    session_id: string
    data: string
  }

  pull_terminal_changes: {
    secret: string
    session_id: string
    cursor: number
  }

  kill_terminal_session: {
    secret: string
    session_id: string
  }

  fetch_terminal_sessions: {
    secret: string
  }

  run_single_terminal_command: {
    secret: string
    command: string
  }
}

export interface EventPayloadMap {
  read_file: {
    filePath: string
    response: ReadFileResult
  }
  write_file: {
    filePath: string
    response: WriteFileResult
  }
  exists: {
    filePath: string
    response: ExistsResult
  }
  ls: {
    filePath: string
    response: LsResult
  }
  rm: {
    path: string
    response: RmResult
  }
  tree: {
    filePath: string
    response: TreeResult
  }
  read_file_many: {
    files: ReadFileArgs[]
    responses: ReadFileResult[]
  }
  write_file_many: {
    files: WriteFileArgs[]
    responses: WriteFileResult[]
  }
  exists_many: {
    paths: string[]
    responses: ExistsResult[]
  }
  ls_many: {
    dirs: LsArgs[]
    responses: LsResult[]
  }
  rm_many: {
    paths: Array<{ path: string }>
    responses: RmResult[]
  }
  tree_many: {
    dirPaths: string[]
    responses: TreeResult[]
  }

  move_items: MoveItemsResult

  copy_to_clipboard: CopyToClipboardResult

  import_items: ImportItemsResult

  get_project_info: {
    projectInfo: ProjectInfo
  }
  get_unix_client_info: {
    unixConnectionCount: number
    utilizedApis: AvailableApis[]
  }
  get_prompt_rules: {
    rules: string | null
  }
  get_version: {
    version: string
  }
  get_proxy_info: null | {
    serverUrl: string
    proxyUrl: string
    isViteInstallation: boolean
  }
  set_should_modify_next_object_counter: {
    shouldModifyNextObjectCounter: boolean
  }
  lsp_request: LspJsonRpcResponse | null

  open_files: unknown

  check_diagnostics: DiagnosticCheckResult

  get_git_status: GitStatusResult

  search: RipGrepSearchResult

  create_terminal_session: {
    session_id: string
  }

  send_terminal_key_strokes: null

  pull_terminal_changes: {
    changes: Array<{ id: number, data: string }>
    new_cursor: number
  }

  kill_terminal_session: null

  fetch_terminal_sessions: {
    sessions: string[]
  }

  run_single_terminal_command: {
    output: string
  }

  set_terminal_secret: {
    success: boolean
    error?: string
  }

  has_terminal_secret: {
    hasSecret: boolean
  }

  check_terminal_secret: {
    isMatching: boolean
  }
}

export interface WebSocketInboundEvent<K extends keyof RequestParamMap> {
  event_name: K
  params: RequestParamMap[K]
  signature: string
  message_id: string
}

export type WebSocketInboundRequest<K extends keyof RequestParamMap> =
  WebSocketInboundEvent<K>;

export type WebSocketPostInitMessage =
  {
    [K in keyof RequestParamMap]: WebSocketInboundRequest<K>;
  }[keyof RequestParamMap];

export type ForwardableEvents =
  | 'get_git_status'
  | 'copy_to_clipboard'
  | 'import_items'
  | 'set_terminal_secret'
  | 'has_terminal_secret'
  | 'check_terminal_secret'
  | 'fetch_terminal_sessions'
  | 'create_terminal_session'
  | 'send_terminal_key_strokes'
  | 'pull_terminal_changes'
  | 'kill_terminal_session'
  | 'run_single_terminal_command';

export interface HostForwardRequest<K extends ForwardableEvents> {
  event_name: 'host_forward'
  request_uuid: string
  workspace_dir: string
  wrapped_request: WebSocketInboundRequest<K>
}

export interface HostResponseMessage<K extends ForwardableEvents> {
  event_name: 'host_response'
  request_uuid: string
  wrapped_response: WebSocketResponseEvent<K>
}

export interface HostBroadcastMessage {
  event_name: 'host_broadcast'
  wrapped_broadcast: string
}

type WebSocketUnsignedMessage =
  | {
    event_name: 'key_registered'
    uuid: string
    [key: string]: any
  }
  | {
    event_name: 'host_init'
    signature: string
    timestamp: number
  } | HostResponseMessage<ForwardableEvents>
  | HostBroadcastMessage;

type WebSocketMessage = WebSocketPostInitMessage | WebSocketUnsignedMessage;

export interface WebSocketResponseEvent<K extends keyof EventPayloadMap> {
  event_response: K
  message_id: string
  payload: EventPayloadMap[K]
}

const signedEvents = new Set<keyof RequestParamMap>([
  'read_file',
  'write_file',
  'exists',
  'ls',
  'rm',
  'tree',
  'read_file_many',
  'write_file_many',
  'exists_many',
  'ls_many',
  'rm_many',
  'tree_many',
  'move_items',
  'copy_to_clipboard',
  'import_items',
  'open_element',
  'open_file',
  'get_project_info',
  'get_unix_client_info',
  'get_prompt_rules',
  'get_version',
  'get_proxy_info',
  'set_should_modify_next_object_counter',
  'lsp_request',
  'open_files',
  'check_diagnostics',
  'get_git_status',
  'search',
  'set_terminal_secret',
  'has_terminal_secret',
  'check_terminal_secret',
  'fetch_terminal_sessions',
  'create_terminal_session',
  'send_terminal_key_strokes',
  'pull_terminal_changes',
  'kill_terminal_session',
  'run_single_terminal_command'
]);

@singleton()
@injectable()
export class WebSocketService {
  private wss?: WebSocketServer;
  private readonly clients = new Set<WebSocket>();
  private hostClient: WebSocket | null = null;
  private readonly pendingHostRequests = new Map<string, {
    resolve: (payload: any) => void
    reject: (error: Error) => void
    timeout: NodeJS.Timeout
  }>();

  constructor (
    @inject(ConfigService) private readonly config: ConfigService,
    @inject(Logger) private readonly logger: Logger,
    @inject(KeyFetcher) private readonly keyFetcher: KeyFetcher,
    @inject(KeyManager) private readonly keyManager: KeyManager,
    @inject(DesktopClientRegistryService) private readonly desktopClientRegistryService: DesktopClientRegistryService,
    @inject(SignatureVerifierService) private readonly signatureVerifier: SignatureVerifierService,
    @inject(FileSystemApiService) private readonly fileSystemApi: FileSystemApiService,
    @inject(DesktopEmitterService) private readonly desktopEmitterService: DesktopEmitterService,
    @inject(LspWorkerManagerService) private readonly lspWorkerManager: LspWorkerManagerService,
    @inject(RipGrepService) private readonly ripgrepService: RipGrepService,
    @inject(LocalKeyService) private readonly localKeyService: LocalKeyService,
    @inject(TerminalManagerService) private readonly terminalManager: TerminalManagerService
  ) { }

  async startWithHttpServer (httpServer: Server): Promise<void> {
    const { wsPort, wsHost, wsProtocol } = this.config.getConfig();

    this.wss = new WebSocketServer({
      noServer: true
    });

    httpServer.on('upgrade', (request, socket, head) => {
      const { pathname } = new URL(request.url!, `http://${request.headers.host}`);

      if (pathname === '/jsx-tool-socket') {
        this.wss!.handleUpgrade(request, socket, head, (ws) => {
          this.wss!.emit('connection', ws, request);
        });
      }
    });

    await this.startListeners(wsProtocol, wsHost, wsPort);
  }

  async start (): Promise<void> {
    const { wsPort, wsHost, wsProtocol } = this.config.getConfig();

    await new Promise<void>((resolve, reject) => {
      this.wss = new WebSocketServer({ port: wsPort, host: wsHost }, resolve);
      this.wss.once('error', reject);
    });

    await this.startListeners(wsProtocol, wsHost, wsPort);
  }

  private async startListeners (wsProtocol: 'ws' | 'wss', wsHost: string, wsPort: number) {
    this.keyManager.setListener((_keyData) => {
      this.broadcastKeyReady();
    });

    this.desktopClientRegistryService.addUnixClientsChangedListener(() => {
      this.broadcastUnixConnectionsChanged();
    });

    this.fileSystemApi.setListener((fileChanges: FileChangeEvent[]) => {
      this.broadcastProjectInfoChanged(fileChanges);
    });

    this.lspWorkerManager.listen((lspResponse: LspJsonRpcResponse) => {
      this.broadcast(JSON.stringify({
        event_name: 'lsp_update',
        lsp_response: lspResponse
      }));
    });

    this.terminalManager.on('created', (sessionId: string) => {
      this.broadcast(JSON.stringify({
        event_name: 'terminal_session_created',
        session_id: sessionId
      }));
    });

    this.terminalManager.on('data', (sessionId: string) => {
      this.broadcast(JSON.stringify({
        event_name: 'terminal_output_available',
        session_id: sessionId
      }));
    });

    this.terminalManager.on('exit', (sessionId: string, exitCode: number) => {
      this.broadcast(JSON.stringify({
        event_name: 'terminal_session_closed',
        session_id: sessionId,
        exit_code: exitCode
      }));
    });

    if (!this.wss) return;

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      this.logger.info('WebSocket client connected');

      ws.send(JSON.stringify({
        event_name: 'init',
        key_ready: this.keyManager.hasValidKey()
      }));

      ws.on('message', (data) => {
        this.logger.debug(`WebSocket received: ${data.toString()}`);
        this.handleMessage(data.toString(), ws);
      });

      ws.on('close', () => {
        this.clients.delete(ws);

        if (this.hostClient === ws) {
          this.logger.warn('Host client disconnected');
          this.hostClient = null;
        }

        this.logger.info('WebSocket client disconnected');
      });

      ws.on('error', (error) => {
        this.logger.error(`WebSocket error: ${error.message}`);
        this.clients.delete(ws);

        if (this.hostClient === ws) {
          this.logger.error('Host client error');
          this.hostClient = null;
        }
      });
    });

    this.logger.success(
      `WebSocket server listening on ${wsProtocol}://${wsHost}:${wsPort}`
    );

    if (process.env.NODE_ENV !== 'test') {
      await this.lspWorkerManager.start();
      this.lspWorkerManager.startFileWatchers();
    }
  }

  async stop (): Promise<void> {
    if (!this.wss) return;

    this.keyFetcher.cleanup();
    this.keyManager.cleanup();

    for (const [, pending] of this.pendingHostRequests.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('WebSocket server shutting down'));
    }

    await this.lspWorkerManager.stop();

    await Promise.all(
      [...this.clients].map(
        async (client) => {
          await new Promise<void>((resolve) => {
            if (client.readyState === WebSocket.CLOSED) { resolve(); return; }
            client.once('close', resolve);
            client.close();
          });
        }
      )
    );

    this.clients.clear();
    this.hostClient = null;
    await new Promise<void>((resolve) => { this.wss!.close(() => { resolve(); }); });
    this.logger.info('WebSocket server stopped');
  }

  private async handleMessage (data: string, socket: WebSocket): Promise<void> {
    try {
      const message: WebSocketMessage = JSON.parse(data);
      const isInsecure = this.config.getConfig()?.insecure ?? false;

      if (message.event_name === 'key_registered') {
        this.handleKeyRegistered(message, socket);
        return;
      }

      if (message.event_name === 'host_init') {
        this.handleHostInit(message, socket);
        return;
      }

      if (message.event_name === 'host_response' && socket === this.hostClient) {
        this.handleHostResponse(message as HostResponseMessage<ForwardableEvents>);
        return;
      }

      if (message.event_name === 'host_broadcast' && socket === this.hostClient) {
        this.broadcast(message.wrapped_broadcast);
        return;
      }

      if (!signedEvents.has(message.event_name as any)) {
        this.logger.warn(`Unknown event received: ${message.event_name}`);
        return;
      }

      const postInitMessage = message as WebSocketPostInitMessage;
      const { signature, ...messageWithoutSignature } = postInitMessage;

      const signedPayload = {
        event_name: messageWithoutSignature.event_name,
        params: messageWithoutSignature.params,
        message_id: messageWithoutSignature.message_id
      };

      if (!isInsecure && !this.signatureVerifier.verify(signedPayload, signature)) {
        this.logger.warn('Discarding message with invalid signature');
        return;
      }

      switch (postInitMessage.event_name) {
        case 'read_file': {
          const res = this.fileSystemApi.readFile(postInitMessage.params.filePath);
          socket.send(
            this.serializeResponseMessage(postInitMessage, {
              filePath: postInitMessage.params.filePath,
              response: res
            })
          );
          break;
        }

        case 'write_file': {
          const res = this.fileSystemApi.writeToFile(
            postInitMessage.params.filePath,
            postInitMessage.params.content,
            postInitMessage.params.encoding
          );
          socket.send(
            this.serializeResponseMessage(postInitMessage, {
              filePath: postInitMessage.params.filePath,
              response: res
            })
          );
          break;
        }

        case 'exists': {
          const res = this.fileSystemApi.exists(postInitMessage.params.filePath);
          socket.send(
            this.serializeResponseMessage(postInitMessage, {
              filePath: postInitMessage.params.filePath,
              response: res
            })
          );
          break;
        }

        case 'ls': {
          const res = this.fileSystemApi.ls(
            postInitMessage.params.dirPath,
            postInitMessage.params.options
          );
          socket.send(
            this.serializeResponseMessage(postInitMessage, {
              filePath: postInitMessage.params.dirPath,
              response: res
            })
          );
          break;
        }

        case 'rm': {
          const res = this.fileSystemApi.rm(postInitMessage.params.path);
          socket.send(
            this.serializeResponseMessage(postInitMessage, {
              path: postInitMessage.params.path,
              response: res
            })
          );
          break;
        }

        case 'tree': {
          const res = this.fileSystemApi.tree(
            postInitMessage.params.filePath
          );
          socket.send(
            this.serializeResponseMessage(postInitMessage, {
              filePath: postInitMessage.params.filePath,
              response: res
            })
          );
          break;
        }
        case 'read_file_many': {
          const res = this.fileSystemApi.readFileMany(postInitMessage.params.files);
          socket.send(
            this.serializeResponseMessage(postInitMessage, {
              files: postInitMessage.params.files,
              responses: res
            })
          );
          break;
        }

        case 'write_file_many': {
          const res = this.fileSystemApi.writeToFileMany(postInitMessage.params.files);
          socket.send(
            this.serializeResponseMessage(postInitMessage, {
              files: postInitMessage.params.files,
              responses: res
            })
          );
          break;
        }

        case 'exists_many': {
          const res = this.fileSystemApi.existsMany(postInitMessage.params.paths);
          socket.send(
            this.serializeResponseMessage(postInitMessage, {
              paths: postInitMessage.params.paths,
              responses: res
            })
          );
          break;
        }

        case 'ls_many': {
          const res = this.fileSystemApi.lsMany(postInitMessage.params.dirs);
          socket.send(
            this.serializeResponseMessage(postInitMessage, {
              dirs: postInitMessage.params.dirs,
              responses: res
            })
          );
          break;
        }

        case 'rm_many': {
          const res = this.fileSystemApi.rmMany(postInitMessage.params.paths);
          socket.send(
            this.serializeResponseMessage(postInitMessage, {
              paths: postInitMessage.params.paths,
              responses: res
            })
          );
          break;
        }

        case 'tree_many': {
          const res = this.fileSystemApi.treeMany(postInitMessage.params.dirPaths);
          socket.send(
            this.serializeResponseMessage(postInitMessage, {
              dirPaths: postInitMessage.params.dirPaths,
              responses: res
            })
          );
          break;
        }

        case 'move_items': {
          const res = this.fileSystemApi.moveItems(
            postInitMessage.params.sourcePaths,
            postInitMessage.params.targetDirectory
          );
          socket.send(
            this.serializeResponseMessage(postInitMessage, res)
          );
          break;
        }

        case 'copy_to_clipboard': {
          if (this.hasHostClient()) {
            const result = await this.sendToHost(postInitMessage);
            socket.send(
              this.serializeResponseMessage(postInitMessage, result)
            );
          } else {
            const res = this.fileSystemApi.copyToClipboard(postInitMessage.params.paths);
            socket.send(
              this.serializeResponseMessage(postInitMessage, res)
            );
          }
          break;
        }

        case 'import_items': {
          if (this.hasHostClient()) {
            const result = await this.sendToHost(postInitMessage);
            socket.send(
              this.serializeResponseMessage(postInitMessage, result)
            );
          } else {
            const res = this.fileSystemApi.importItems(
              postInitMessage.params.sourcePaths,
              postInitMessage.params.targetDirectory
            );
            socket.send(
              this.serializeResponseMessage(postInitMessage, res)
            );
          }
          break;
        }

        case 'open_element': {
          this.desktopEmitterService.forwardMessage(postInitMessage);
          break;
        }

        case 'open_file': {
          this.desktopEmitterService.forwardMessage(postInitMessage);
          break;
        }

        case 'get_project_info': {
          const projectInfo = this.fileSystemApi.projectInfo();
          socket.send(
            this.serializeResponseMessage(postInitMessage, {
              projectInfo
            })
          );
          break;
        }

        case 'get_unix_client_info': {
          socket.send(
            this.serializeResponseMessage(postInitMessage, {
              unixConnectionCount: this.desktopClientRegistryService.count(),
              utilizedApis: this.desktopClientRegistryService.utilizedApis()
            })
          );
          break;
        }

        case 'get_prompt_rules': {
          socket.send(
            this.serializeResponseMessage(postInitMessage, {
              rules: this.config.getPromptRules()
            })
          );
          break;
        }

        case 'get_version': {
          socket.send(
            this.serializeResponseMessage(postInitMessage, {
              version: VERSION
            })
          );
          break;
        }

        case 'get_proxy_info': {
          const { noProxy, proxyHost, proxyPort, proxyProtocol, serverHost, serverPort, serverProtocol } = this.config.getConfig();
          if (noProxy && !this.config.isViteInstallation) {
            socket.send(
              this.serializeResponseMessage(postInitMessage, null)
            );
          }
          socket.send(
            this.serializeResponseMessage(postInitMessage, {
              serverUrl: `${serverProtocol}://${serverHost}:${serverPort}`,
              proxyUrl: `${proxyProtocol}://${proxyHost}:${proxyPort}`,
              isViteInstallation: this.config.isViteInstallation
            })
          );
          break;
        }

        case 'set_should_modify_next_object_counter': {
          this.config.setShouldModifyNextObjectCounter(postInitMessage.params.shouldModifyNextObjectCounter);
          if (this.config.isViteInstallation) {
            this.config.fullReload();
          }
          socket.send(
            this.serializeResponseMessage(postInitMessage, {
              shouldModifyNextObjectCounter: this.config.shouldModifyNextObjectCounter
            })
          );
          break;
        }

        case 'lsp_request': {
          const response = await this.lspWorkerManager.handleJsonRpc(postInitMessage.params);
          socket.send(this.serializeResponseMessage(postInitMessage, response));
          break;
        }

        case 'open_files': {
          await this.lspWorkerManager.initializeOpenFiles(postInitMessage.params.files);
          socket.send(
            this.serializeResponseMessage(postInitMessage, {})
          );
          break;
        }

        case 'check_diagnostics': {
          const result = await this.lspWorkerManager.checkDiagnostics(postInitMessage.params.files);
          socket.send(
            this.serializeResponseMessage(postInitMessage, result)
          );
          break;
        }

        case 'get_git_status': {
          if (this.hasHostClient()) {
            const result = await this.sendToHost(postInitMessage);
            socket.send(
              this.serializeResponseMessage(postInitMessage, result)
            );
          } else {
            const result = this.fileSystemApi.gitStatus();
            socket.send(
              this.serializeResponseMessage(postInitMessage, result)
            );
          }
          break;
        }

        case 'search': {
          const result = await this.ripgrepService.search(
            postInitMessage.params.pattern,
            postInitMessage.params.options
          );
          socket.send(
            this.serializeResponseMessage(postInitMessage, result)
          );
          break;
        }

        case 'create_terminal_session': {
          if (!this.verifyTerminalSecret(postInitMessage.params.secret)) {
            return;
          }
          if (this.hasHostClient()) {
            const payload = await this.sendToHost(postInitMessage);
            socket.send(this.serializeResponseMessage(postInitMessage, payload));
          } else {
            const sessionId = this.terminalManager.createSession(
              process.platform === 'win32' ? 'cmd.exe' : process.env.SHELL || '/bin/zsh',
              process.platform === 'win32' ? [] : ['-l'],
              postInitMessage.params.cols || 80,
              postInitMessage.params.rows || 24
            );
            socket.send(
              this.serializeResponseMessage(postInitMessage, {
                session_id: sessionId
              })
            );
          }
          break;
        }

        case 'send_terminal_key_strokes': {
          if (!this.verifyTerminalSecret(postInitMessage.params.secret)) {
            return;
          }
          if (this.hasHostClient()) {
            const payload = await this.sendToHost(postInitMessage);
            socket.send(this.serializeResponseMessage(postInitMessage, payload));
          } else {
            this.terminalManager.write(
              postInitMessage.params.session_id,
              postInitMessage.params.data
            );
            socket.send(
              this.serializeResponseMessage(postInitMessage, null)
            );
          }
          break;
        }

        case 'pull_terminal_changes': {
          if (!this.verifyTerminalSecret(postInitMessage.params.secret)) {
            return;
          }
          if (this.hasHostClient()) {
            const payload = await this.sendToHost(postInitMessage);
            socket.send(this.serializeResponseMessage(postInitMessage, payload));
          } else {
            const { logs, nextCursor } = this.terminalManager.getLogs(
              postInitMessage.params.session_id,
              postInitMessage.params.cursor
            );
            socket.send(
              this.serializeResponseMessage(postInitMessage, {
                changes: logs,
                new_cursor: nextCursor
              })
            );
          }
          break;
        }

        case 'kill_terminal_session': {
          if (!this.verifyTerminalSecret(postInitMessage.params.secret)) {
            return;
          }
          if (this.hasHostClient()) {
            const payload = await this.sendToHost(postInitMessage);
            socket.send(this.serializeResponseMessage(postInitMessage, payload));
          } else {
            this.terminalManager.kill(postInitMessage.params.session_id);
            socket.send(
              this.serializeResponseMessage(postInitMessage, null)
            );
          }
          break;
        }

        case 'fetch_terminal_sessions': {
          if (!this.verifyTerminalSecret(postInitMessage.params.secret)) {
            return;
          }
          if (this.hasHostClient()) {
            const payload = await this.sendToHost(postInitMessage);
            socket.send(this.serializeResponseMessage(postInitMessage, payload));
          } else {
            const sessions = this.terminalManager.getSessions();
            socket.send(
              this.serializeResponseMessage(postInitMessage, {
                sessions
              })
            );
          }
          break;
        }

        case 'run_single_terminal_command': {
          if (!this.verifyTerminalSecret(postInitMessage.params.secret)) {
            return;
          }
          if (this.hasHostClient()) {
            const payload = await this.sendToHost(postInitMessage);
            socket.send(this.serializeResponseMessage(postInitMessage, payload));
          } else {
            const output = await this.terminalManager.runOneOffCommand(
              postInitMessage.params.command
            );
            socket.send(
              this.serializeResponseMessage(postInitMessage, {
                output
              })
            );
          }
          break;
        }

        case 'set_terminal_secret': {
          const terminalSecretPath = this.config.getTerminalSecretPath();
          if (this.fileSystemApi.exists(terminalSecretPath).exists) {
            socket.send(
              this.serializeResponseMessage(postInitMessage, {
                success: false,
                error: 'Terminal secret already set'
              })
            );
            break;
          }

          this.config.ensureGitIgnore();
          const res = this.fileSystemApi.writeToFile(terminalSecretPath, postInitMessage.params.secret);

          if (!res.success) {
            socket.send(
              this.serializeResponseMessage(postInitMessage, {
                success: false,
                error: 'Failed to set terminal secret'
              })
            );
          } else {
            socket.send(
              this.serializeResponseMessage(postInitMessage, {
                success: true
              })
            );
          }
          break;
        }

        case 'has_terminal_secret': {
          const terminalSecretPath = this.config.getTerminalSecretPath();
          let hasSecret = false;
          if (terminalSecretPath) {
            hasSecret = this.fileSystemApi.exists(terminalSecretPath).exists;
          }
          socket.send(
            this.serializeResponseMessage(postInitMessage, {
              hasSecret
            })
          );
          break;
        }

        case 'check_terminal_secret': {
          const isMatching = this.verifyTerminalSecret(postInitMessage.params.secret);
          socket.send(
            this.serializeResponseMessage(postInitMessage, {
              isMatching
            })
          );
          break;
        }
      }
    } catch (err) {
      this.logger.error(
        `Failed to parse WebSocket message: ${err instanceof Error ? err.message : 'unknown error'
        }`
      );
    }
  }

  private handleHostInit (message: { event_name: 'host_init', signature: string, timestamp: number }, socket: WebSocket): void {
    const publicKey = this.localKeyService.getPublicKey();
    if (!publicKey) {
      this.logger.error('Cannot verify host init: No public key available');
      socket.send(JSON.stringify({
        event_name: 'host_init_rejected',
        reason: 'No public key available'
      }));
      return;
    }

    try {
      const payload = JSON.stringify({
        event_name: 'host_init',
        timestamp: message.timestamp
      });

      const verify = createVerify('SHA256');
      verify.update(payload);
      verify.end();

      const isValid = verify.verify(publicKey, message.signature, 'base64');

      if (!isValid) {
        this.logger.warn('Host init rejected: Invalid signature');
        socket.send(JSON.stringify({
          event_name: 'host_init_rejected',
          reason: 'Invalid signature'
        }));
        return;
      }

      const timeDiff = Math.abs(Date.now() - message.timestamp);
      if (timeDiff > 30000) {
        this.logger.warn('Host init rejected: Timestamp too old');
        socket.send(JSON.stringify({
          event_name: 'host_init_rejected',
          reason: 'Timestamp expired'
        }));
        return;
      }

      const oldHostClient = this.hostClient;
      this.hostClient = socket;

      if (oldHostClient && oldHostClient !== socket) {
        this.logger.info('Replacing existing host client connection');
        oldHostClient.close();
      }

      this.logger.success('Host client authenticated and registered');

      socket.send(JSON.stringify({
        event_name: 'host_init_ack'
      }));
    } catch (error) {
      this.logger.error(`Failed to verify host init: ${(error as Error).message}`);
      socket.send(JSON.stringify({
        event_name: 'host_init_rejected',
        reason: 'Verification failed'
      }));
    }
  }

  private async sendToHost<K extends ForwardableEvents>(
    request: WebSocketInboundRequest<K>
  ): Promise<EventPayloadMap[K]> {
    if (!this.hostClient || this.hostClient.readyState !== WebSocket.OPEN) {
      throw new Error('Host client not available');
    }

    return await new Promise<EventPayloadMap[K]>((resolve, reject) => {
      const requestUuid = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const timeout = setTimeout(() => {
        this.pendingHostRequests.delete(requestUuid);
        reject(new Error('Host request timeout (10s)'));
      }, 10000);

      this.pendingHostRequests.set(requestUuid, {
        resolve,
        reject,
        timeout
      });

      const forwardMessage: HostForwardRequest<K> = {
        event_name: 'host_forward',
        request_uuid: requestUuid,
        workspace_dir: this.config.getConfig().workingDirectory,
        wrapped_request: request
      };

      this.hostClient!.send(JSON.stringify(forwardMessage));
      this.logger.debug(`Forwarded ${request.event_name} to host client (uuid: ${requestUuid})`);
    });
  }

  private handleHostResponse<K extends ForwardableEvents>(
    message: HostResponseMessage<K>
  ): void {
    const pending = this.pendingHostRequests.get(message.request_uuid);

    if (!pending) {
      this.logger.warn(`Received host response for unknown request: ${message.request_uuid}`);
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingHostRequests.delete(message.request_uuid);

    pending.resolve(message.wrapped_response.payload);
    this.logger.debug(`Completed host request ${message.request_uuid}`);
  }

  private serializeResponseMessage<
    K extends keyof EventPayloadMap,
  >(
    req: WebSocketInboundRequest<K>,
    payload: EventPayloadMap[K]
  ): string {
    const msg: WebSocketResponseEvent<K> = {
      message_id: req.message_id,
      event_response: req.event_name,
      payload
    };
    return JSON.stringify(msg);
  }

  private handleKeyRegistered (message: { event_name: 'key_registered', uuid: string, [key: string]: any }, socket: WebSocket): void {
    if (!message.uuid) {
      this.logger.error('Key registered event missing UUID');
      return;
    }
    this.logger.info(`Key registered (uuid: ${message.uuid})`);

    const currentKey = this.keyManager.getCurrentKey();
    if (currentKey?.uuid === message.uuid) {
      this.logger.debug(`Already have key for UUID ${message.uuid}, sending key_ready`);
      socket.send(JSON.stringify({
        event_name: 'key_ready'
      }));
      return;
    }

    this.keyFetcher.startFetching(message.uuid);
  }

  broadcast (message: string): void {
    this.clients.forEach((c) => {
      if (c.readyState === WebSocket.OPEN) c.send(message);
    });
  }

  public broadcastKeyReady () {
    this.broadcast(JSON.stringify({
      event_name: 'key_ready'
    }));
  }

  public broadcastUnixConnectionsChanged () {
    this.broadcast(this.getUnixClientInfoEvent());
  }

  private getUnixClientInfoEvent () {
    return JSON.stringify({
      event_name: 'updated_unix_client_info'
    });
  }

  public broadcastProjectInfoChanged (fileChanges: FileChangeEvent[]) {
    this.broadcast(this.getProjectInfo(fileChanges));
  }

  private getProjectInfo (fileChanges: FileChangeEvent[]) {
    return JSON.stringify({
      event_name: 'updated_project_info',
      file_changes: fileChanges ?? []
    });
  }

  getClientCount (): number {
    return this.clients.size;
  }

  hasHostClient (): boolean {
    return this.hostClient !== null && this.hostClient.readyState === WebSocket.OPEN;
  }

  getCurrentKeyStatus (): {
    hasKey: boolean
    uuid?: string
    expirationTime?: string
  } {
    const cur = this.keyManager.getCurrentKey();
    return {
      hasKey: this.keyManager.hasValidKey(),
      uuid: cur?.uuid,
      expirationTime: cur?.expirationTime
    };
  }

  getFetcherStatus (): { isActive: boolean, currentUuid?: string } {
    const uuids = this.keyFetcher.getCurrentUuids();
    const currentKey = this.keyManager.getCurrentKey();

    if (currentKey && uuids.includes(currentKey.uuid)) {
      return {
        isActive: true,
        currentUuid: currentKey.uuid
      };
    }

    return {
      isActive: uuids.length > 0,
      currentUuid: uuids[0]
    };
  }

  private verifyTerminalSecret (secret: string): boolean {
    const terminalSecretPath = this.config.getTerminalSecretPath();
    if (!terminalSecretPath) return false;

    const result = this.fileSystemApi.readFile(terminalSecretPath, 'utf-8', true);
    if (!result.success || !result.data) return false;

    return result.data.trim() === secret.trim();
  }
}
