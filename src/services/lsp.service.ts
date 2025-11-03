import { injectable, inject, singleton } from 'tsyringe';
import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from './config.service';
import { Logger } from './logger.service';
import { FileSystemApiService } from './file-system-api.service';
import type {
  Position,
  CompletionItem,
  Hover,
  Location,
  Diagnostic,
  InsertTextFormat,
  MarkupContent,
  Range
} from 'vscode-languageserver-types';
import {
  CompletionItemKind,
  DiagnosticSeverity
} from 'vscode-languageserver-types';
import type { DefinitionParams, HoverParams } from 'vscode-languageserver';
import { TextDocumentSyncKind } from 'vscode-languageserver';
import type { ESLint } from 'eslint';
import type * as Prettier from 'prettier';

export interface InitializeParams {
  rootUri?: string
  rootPath?: string
  capabilities?: unknown
  processId?: number | null
  workspaceFolders?: unknown
}

export interface TextDocumentIdentifier {
  uri: string
}

export interface VersionedTextDocumentIdentifier extends TextDocumentIdentifier {
  version: number
}

export interface TextDocumentItem {
  uri: string
  languageId: string
  version: number
  text: string
}

export interface TextDocumentContentChangeEvent {
  text: string
  range?: {
    start: Position
    end: Position
  }
  rangeLength?: number
}

export interface DidOpenTextDocumentParams {
  textDocument: TextDocumentItem
}

export interface DidChangeTextDocumentParams {
  textDocument: VersionedTextDocumentIdentifier
  contentChanges: TextDocumentContentChangeEvent[]
}

export interface DidCloseTextDocumentParams {
  textDocument: TextDocumentIdentifier
}

export interface TextDocumentPositionParams {
  textDocument: TextDocumentIdentifier
  position: Position
}

export interface CompletionParams extends TextDocumentPositionParams {
  context?: {
    triggerKind: number
    triggerCharacter?: string
  }
}

export interface CompletionItemData {
  fileName: string
  offset: number
  name: string
  source?: string
  tsData?: unknown
}

export interface CompletionItemResolveParams {
  label: string
  kind?: number
  detail?: string
  documentation?: unknown
  sortText?: string
  filterText?: string
  insertText?: string
  insertTextFormat?: number
  data?: CompletionItemData
}

export interface ReferenceParams extends TextDocumentPositionParams {
  context: {
    includeDeclaration: boolean
  }
}

export interface DocumentSymbolParams {
  textDocument: TextDocumentIdentifier
}

export interface InsertImportParams {
  textDocument: TextDocumentIdentifier
  position: Position
  moduleSpecifier: string
  identifierName: string
}

export type LspMethodParams =
  | InitializeParams
  | DidOpenTextDocumentParams
  | DidChangeTextDocumentParams
  | DidCloseTextDocumentParams
  | TextDocumentPositionParams
  | CompletionParams
  | CompletionItemResolveParams
  | ReferenceParams
  | DocumentSymbolParams
  | undefined;

export type LspJsonRpcRequest =
  | { jsonrpc: '2.0', id: number | string, method: 'initialize', params: InitializeParams }
  | { jsonrpc: '2.0', method: 'initialized', params?: undefined }
  | { jsonrpc: '2.0', id: number | string, method: 'shutdown', params?: undefined }
  | { jsonrpc: '2.0', method: 'exit', params?: undefined }
  | { jsonrpc: '2.0', method: 'textDocument/didOpen', params: DidOpenTextDocumentParams }
  | { jsonrpc: '2.0', method: 'textDocument/didChange', params: DidChangeTextDocumentParams }
  | { jsonrpc: '2.0', method: 'textDocument/didClose', params: DidCloseTextDocumentParams }
  | { jsonrpc: '2.0', id: number | string, method: 'textDocument/hover', params: TextDocumentPositionParams }
  | { jsonrpc: '2.0', id: number | string, method: 'textDocument/definition', params: TextDocumentPositionParams }
  | { jsonrpc: '2.0', id: number | string, method: 'textDocument/references', params: ReferenceParams }
  | { jsonrpc: '2.0', id: number | string, method: 'textDocument/documentSymbol', params: DocumentSymbolParams }
  | { jsonrpc: '2.0', id: number | string, method: 'textDocument/completion', params: CompletionParams }
  | { jsonrpc: '2.0', id: number | string, method: 'completionItem/resolve', params: CompletionItemResolveParams }
  | { jsonrpc: '2.0', id: number | string, method: 'jsx-tool/insertImport', params: InsertImportParams }
  | { jsonrpc: '2.0', id: number | string, method: 'jsx-tool/format', params: { textDocument: TextDocumentIdentifier } }
  | { jsonrpc: '2.0', id: number | string, method: 'jsx-tool/formatRange', params: { textDocument: TextDocumentIdentifier, range: any } };

export interface InitializeResult {
  capabilities: {
    textDocumentSync: number
    completionProvider: {
      triggerCharacters: string[]
      resolveProvider: boolean
      completionItem: {
        labelDetailsSupport: boolean
      }
    }
    hoverProvider: boolean
    definitionProvider: boolean
    referencesProvider: boolean
    documentSymbolProvider: boolean
    workspaceSymbolProvider: boolean
    codeActionProvider: boolean
    codeLensProvider: boolean
    documentFormattingProvider: boolean
    documentRangeFormattingProvider: boolean
    documentOnTypeFormattingProvider: boolean
    renameProvider: boolean
    documentLinkProvider: boolean
    colorProvider: boolean
    foldingRangeProvider: boolean
    declarationProvider: boolean
    implementationProvider: boolean
    typeDefinitionProvider: boolean
    callHierarchyProvider: boolean
    semanticTokensProvider: boolean
    linkedEditingRangeProvider: boolean
    monikerProvider: boolean
    inlayHintProvider: boolean
  }
  serverInfo: {
    name: string
    version: string
  }
}

interface TypeSymbol {
  children: Array<TypeSymbol | null>
  name: string
  kind: number
  containerName: string
  range: {
    start: Position
    end: Position
  }
  selectionRange: {
    start: Position
    end: Position
  }
}

export type LspSuccessResponse =
  | { jsonrpc: '2.0', id: number | string, result: InitializeResult }
  | { jsonrpc: '2.0', id: number | string, result: CompletionItem[] }
  | { jsonrpc: '2.0', id: number | string, result: CompletionItem }
  | { jsonrpc: '2.0', id: number | string, result: Hover | null }
  | { jsonrpc: '2.0', id: number | string, result: Location[] }
  | { jsonrpc: '2.0', id: number | string, result: TypeSymbol[] }
  | { jsonrpc: '2.0', id: number | string, result: TextEdit[] }
  | { jsonrpc: '2.0', id: number | string, result: null };

export interface LspErrorResponse {
  jsonrpc: '2.0'
  id: number | string
  error: {
    code: number
    message: string
    data?: unknown
  }
}

export interface LspNotification {
  jsonrpc: '2.0'
  method: 'textDocument/publishDiagnostics'
  params: {
    uri: string
    diagnostics: Diagnostic[]
  }
}

export type LspJsonRpcResponse = LspSuccessResponse | LspErrorResponse | LspNotification;

interface SuccessResult<T> {
  jsonrpc: '2.0'
  id: number | string
  result: T
}

interface ErrorResult {
  jsonrpc: '2.0'
  id: number | string
  error: {
    code: number
    message: string
    data?: unknown
  }
}

export interface ExistingImport {
  line: number
  text: string
  offset: number
}

export interface TextEdit {
  range: {
    start: Position
    end: Position
  }
  newText: string
}

interface LspRequestParams {
  method: 'completion' | 'hover' | 'definition' | 'references' | 'diagnostics'
  uri: string
  position?: { line: number, character: number }
  content?: string
}

export type CompletionResponse =
  | { success: true, data: CompletionItem[], validFor?: RegExp }
  | { success: false, error: string };

export type HoverResponse =
  | { success: true, data: Hover | null }
  | { success: false, error: string };

export type LocationResponse =
  | { success: true, data: Location[] }
  | { success: false, error: string };

export type DiagnosticResponse =
  | { success: true, data: Diagnostic[] }
  | { success: false, error: string };

type LspResponse = CompletionResponse | HoverResponse | LocationResponse | DiagnosticResponse;

@singleton()
@injectable()
export class LspService {
  private languageService?: ts.LanguageService;
  private languageServiceHost?: ts.LanguageServiceHost;
  private readonly fileCache = new Map<string, string>();
  private readonly fileVersions = new Map<string, number>();
  private workspaceRoot: string;
  private listeners: Array<(response: LspJsonRpcResponse) => void> = [];

  private readonly watchers: fs.FSWatcher[] = [];
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();

  private eslint?: ESLint;
  private hasEslint = false;

  private prettier?: typeof Prettier;
  private hasPrettier = false;

  private readonly tailwindCompletions = new Map<string, CompletionItem[]>();
  private hasTailwind = false;
  private readonly tailwindVersion?: string;

  constructor (
    @inject(ConfigService) private readonly config: ConfigService,
    @inject(Logger) private readonly logger: Logger,
    @inject(FileSystemApiService) private readonly fileSystemApi: FileSystemApiService
  ) {
    this.workspaceRoot = this.config.getConfig().workingDirectory;
  }

  listen (listener: (response: LspJsonRpcResponse) => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private broadcast (message: LspJsonRpcResponse) {
    this.listeners.forEach(l => { l(message); });
  }

  startFileWatchers (): void {
    const config = this.config.getConfig();
    const additionalDirs = config.additionalDirectories ?? [];

    const roots = [
      config.workingDirectory,
      ...additionalDirs.map(dir => path.resolve(config.workingDirectory, dir))
    ];

    this.watchDirs(this.dedupeRoots(roots));
    this.logger.info(`LSP: Started file watchers for ${roots.length} directories`);
  }

  private watchDirs (roots: string[]): void {
    for (const root of roots) {
      try {
        const watcher = fs.watch(root, { recursive: true }, (eventType, filename) => {
          if (!filename) return;

          const filePath = path.join(root, filename);
          const ext = path.extname(filePath).toLowerCase();

          const supportedExtensions = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];
          if (!supportedExtensions.includes(ext)) return;

          const existing = this.debounceTimers.get(filePath);
          if (existing) clearTimeout(existing);

          const timer = setTimeout(() => {
            this.handleFileSystemChange(filePath, eventType);
            this.debounceTimers.delete(filePath);
          }, 100);

          this.debounceTimers.set(filePath, timer);
        });

        this.watchers.push(watcher);
        this.logger.debug(`LSP: Watching directory: ${root}`);
      } catch (error) {
        this.logger.error(`LSP: Failed to watch directory ${root}: ${(error as Error).message}`);
      }
    }
  }

  private handleFileSystemChange (filePath: string, eventType: string): void {
    const uri = this.fileNameToUri(filePath);

    if (eventType === 'change') {
      if (fs.existsSync(filePath)) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');

          if (this.fileCache.has(filePath)) {
            this.updateFile(uri, content);
            this.logger.debug(`LSP: File changed (via watcher): ${filePath}`);
          }
        } catch (error) {
          this.logger.error(`LSP: Error reading changed file ${filePath}: ${(error as Error).message}`);
        }
      }
    } else if (eventType === 'rename') {
      if (!fs.existsSync(filePath)) {
        this.fileCache.delete(filePath);
        this.fileVersions.delete(filePath);
        this.logger.debug(`LSP: File deleted (via watcher): ${filePath}`);
      }
    }
  }

  private dedupeRoots (roots: string[]): string[] {
    const resolved = roots
      .map(r => path.resolve(r))
      .sort((a, b) => a.localeCompare(b));

    const result: string[] = [];
    for (const r of resolved) {
      if (!result.some(top => r.startsWith(top + path.sep))) {
        result.push(r);
      }
    }
    return result;
  }

  async handleJsonRpc (message: LspJsonRpcRequest): Promise<LspJsonRpcResponse | null> {
    const { method, params } = message;

    this.logger.debug(`LSP: Handling ${method}`);

    switch (method) {
      case 'initialize':
        return await this.handleInitialize(message.id, params);

      case 'initialized':
        this.handleInitialized();
        return null;

      case 'shutdown':
        return {
          jsonrpc: '2.0',
          id: message.id,
          result: null
        };

      case 'exit':
        this.cleanup();
        return null;

      case 'textDocument/didOpen':
        this.handleDidOpen(params);
        return null;

      case 'textDocument/didChange':
        this.handleDidChange(params);
        return null;

      case 'textDocument/didClose':
        this.handleDidClose(params);
        return null;

      case 'textDocument/hover':
        return await this.handleHover(message.id, params);

      case 'textDocument/definition':
        return await this.handleDefinition(message.id, params);

      case 'textDocument/references':
        return await this.handleReferences(message.id, params);

      case 'textDocument/documentSymbol':
        return this.handleDocumentSymbols(message.id, params);

      case 'textDocument/completion':
        return await this.handleCompletion(message.id, params);

      case 'completionItem/resolve':
        return this.handleCompletionResolve(message.id, params);

      case 'jsx-tool/insertImport':
        return this.handleInsertImport(message.id, params);

      case 'jsx-tool/format':
        return await this.handleFormat(message.id, params);
      case 'jsx-tool/formatRange':
        return await this.handleFormatRange(message.id, params);

      default: {
        const unknownMessage: LspJsonRpcRequest = message;
        if ('id' in unknownMessage) {
          const msg: LspErrorResponse = message;
          const errorResponse: LspErrorResponse = {
            jsonrpc: '2.0',
            id: msg.id,
            error: {
              code: -32601,
              message: `Method not found: ${String(method)}`
            }
          };
          return errorResponse;
        }
        return null;
      }
    }
  }

  private async handleInitialize (id: number | string, params: InitializeParams): Promise<LspJsonRpcResponse> {
    if (params.rootUri) {
      this.workspaceRoot = this.uriToFileName(params.rootUri);
      this.logger.info(`LSP: Set workspace root to ${this.workspaceRoot}`);
    } else if (params.rootPath) {
      this.workspaceRoot = params.rootPath;
      this.logger.info(`LSP: Set workspace root to ${this.workspaceRoot}`);
    }

    await this.initialize();

    return {
      jsonrpc: '2.0',
      id,
      result: {
        capabilities: {
          textDocumentSync: TextDocumentSyncKind.Full,
          completionProvider: {
            triggerCharacters: ['.', '"', "'", '/', '<', ' ', '@'],
            resolveProvider: true,
            completionItem: {
              labelDetailsSupport: true
            }
          },
          hoverProvider: true,
          definitionProvider: true,
          referencesProvider: true,
          documentSymbolProvider: true,
          workspaceSymbolProvider: false,
          codeActionProvider: false,
          codeLensProvider: false,
          documentFormattingProvider: false,
          documentRangeFormattingProvider: false,
          documentOnTypeFormattingProvider: false,
          renameProvider: false,
          documentLinkProvider: false,
          colorProvider: false,
          foldingRangeProvider: false,
          declarationProvider: false,
          implementationProvider: false,
          typeDefinitionProvider: false,
          callHierarchyProvider: false,
          semanticTokensProvider: false,
          linkedEditingRangeProvider: false,
          monikerProvider: false,
          inlayHintProvider: false
        },
        serverInfo: {
          name: 'jsx-tool-lsp',
          version: '1.0.0'
        }
      }
    };
  }

  private handleInitialized (): void {
    this.logger.info('LSP: Client initialized successfully');
  }

  private handleDidOpen (params: DidOpenTextDocumentParams): void {
    const { uri, text } = params.textDocument;
    this.updateFile(uri, text);
    this.logger.debug(`LSP: Opened document ${uri}`);

    setTimeout(() => {
      this.pushDiagnostics(uri);
    }, 100);
  }

  private handleDidChange (params: DidChangeTextDocumentParams): void {
    const { uri } = params.textDocument;
    const changes = params.contentChanges;

    if (changes && changes.length > 0) {
      const fullText = changes[0].text;
      this.updateFile(uri, fullText);
      this.logger.debug(`LSP: Changed document ${uri}`);

      setTimeout(() => {
        this.pushDiagnostics(uri);
      }, 100);
    }
  }

  private handleDidClose (params: DidCloseTextDocumentParams): void {
    const { uri } = params.textDocument;
    const fileName = this.uriToFileName(uri);

    this.fileCache.delete(fileName);
    this.fileVersions.delete(fileName);

    this.logger.debug(`LSP: Closed document ${uri}`);
  }

  private async handleCompletion (id: number | string, params: CompletionParams): Promise<SuccessResult<CompletionItem[]> | ErrorResult> {
    const response = await this.handleRequest({
      method: 'completion',
      uri: params.textDocument.uri,
      position: params.position
    }) as CompletionResponse;

    if (response.success) {
      const items = response.data.map(item => ({
        ...item,
        data: {
          ...item.data,
          customValidFor: response.validFor?.source
        }
      }));

      return {
        jsonrpc: '2.0',
        id,
        result: items
      };
    } else {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: response.error
        }
      };
    }
  }

  private async handleHover (id: number | string, params: HoverParams): Promise<SuccessResult<Hover | null> | ErrorResult> {
    const response = await this.handleRequest({
      method: 'hover',
      uri: params.textDocument.uri,
      position: params.position
    }) as HoverResponse;

    if (response.success) {
      return {
        jsonrpc: '2.0',
        id,
        result: response.data
      };
    } else {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: response.error
        }
      };
    }
  }

  private async handleDefinition (id: number | string, params: DefinitionParams): Promise<SuccessResult<Location[]> | ErrorResult> {
    const response = await this.handleRequest({
      method: 'definition',
      uri: params.textDocument.uri,
      position: params.position
    }) as LocationResponse;

    if (response.success) {
      return {
        jsonrpc: '2.0',
        id,
        result: response.data
      };
    } else {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: response.error
        }
      };
    }
  }

  private handleCompletionResolve (id: number | string, params: CompletionItemResolveParams): SuccessResult<CompletionItem> | ErrorResult {
    if (!params.data) {
      return {
        jsonrpc: '2.0',
        id,
        result: params as CompletionItem
      };
    }

    const { fileName, name, source, tsData } = params.data;

    try {
      if (source && tsData) {
        this.logger.debug(`LSP: Resolving completion for ${name} from ${source}`);

        const moduleSpecifier = this.filePathToModuleSpecifier(source, fileName);

        if (!moduleSpecifier) {
          this.logger.warn(`LSP: Could not convert ${source} to module specifier`);
          return {
            jsonrpc: '2.0',
            id,
            result: params as CompletionItem
          };
        }

        this.logger.debug(`LSP: Converted ${source} to module specifier: ${moduleSpecifier}`);

        const isValidImport = this.validateImport(moduleSpecifier, name, fileName);
        if (!isValidImport) {
          this.logger.warn(`LSP: Import validation failed for ${name} from ${moduleSpecifier} - skipping import generation`);
          return {
            jsonrpc: '2.0',
            id,
            result: params as CompletionItem
          };
        }

        const content = this.getContent(fileName);
        if (!content) {
          this.logger.warn(`LSP: Could not get file content for ${fileName}`);
          return {
            jsonrpc: '2.0',
            id,
            result: params as CompletionItem
          };
        }

        const existingImport = this.findExistingImport(content, moduleSpecifier);

        let importEdit: TextEdit | null;
        if (existingImport) {
          importEdit = this.mergeWithExistingImport(content, existingImport, name);
          if (!importEdit) {
            return {
              jsonrpc: '2.0',
              id,
              result: params as CompletionItem
            };
          }
          this.logger.info(`LSP: Merging ${name} into existing import from ${moduleSpecifier}`);
        } else {
          const importInsertPosition = this.findImportInsertPosition(content);
          const importStatement = `import { ${name} } from '${moduleSpecifier}';\n`;

          importEdit = {
            range: {
              start: this.offsetToPosition(content, importInsertPosition),
              end: this.offsetToPosition(content, importInsertPosition)
            },
            newText: importStatement
          };

          this.logger.info(`LSP: Generated new import for ${name} from ${moduleSpecifier}`);
        }

        const resolvedItem: CompletionItem = {
          label: params.label,
          kind: params.kind as CompletionItemKind | undefined,
          detail: params.detail,
          documentation: params.documentation as (string | MarkupContent | undefined),
          sortText: params.sortText,
          filterText: params.filterText,
          insertText: params.insertText,
          insertTextFormat: params.insertTextFormat as (InsertTextFormat | undefined),
          data: params.data,
          additionalTextEdits: [importEdit]
        };

        return {
          jsonrpc: '2.0',
          id,
          result: resolvedItem
        };
      }

      return {
        jsonrpc: '2.0',
        id,
        result: params as CompletionItem
      };
    } catch (error) {
      this.logger.error(`LSP: Error resolving completion: ${(error as Error).message}`);
      this.logger.debug(`LSP: Stack trace: ${(error as Error).stack}`);
      return {
        jsonrpc: '2.0',
        id,
        result: params as CompletionItem
      };
    }
  }

  private findExistingImport (content: string, moduleSpecifier: string): ExistingImport | null {
    const lines = content.split('\n');

    const importRegex = new RegExp(`^import\\s+(?:{[^}]*}|\\w+)\\s+from\\s+['"]${moduleSpecifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]\\s*;?\\s*$`);

    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (importRegex.test(line)) {
        return {
          line: i,
          text: lines[i],
          offset
        };
      }
      offset += lines[i].length + 1;
    }

    return null;
  }

  private mergeWithExistingImport (content: string, existingImport: { line: number, text: string, offset: number }, newName: string): TextEdit | null {
    const lines = content.split('\n');
    const importLine = lines[existingImport.line];

    const match = importLine.match(/import\s+{([^}]*)}\s+from\s+(['"][^'"]+['"])/);

    if (match) {
      const existingImports = match[1].split(',').map(s => s.trim()).filter(Boolean);

      if (existingImports.includes(newName)) {
        return null;
      }

      const allImports = [...existingImports, newName].sort();
      const newImportLine = `import { ${allImports.join(', ')} } from ${match[2]};`;

      const lineStart = existingImport.offset;
      const lineEnd = lineStart + importLine.length;

      return {
        range: {
          start: this.offsetToPosition(content, lineStart),
          end: this.offsetToPosition(content, lineEnd)
        },
        newText: newImportLine
      };
    }

    const importInsertPosition = this.findImportInsertPosition(content);
    const moduleSpecifier = importLine.match(/from\s+(['"][^'"]+['"])/)?.[1].replace(/['"]/g, '');

    return {
      range: {
        start: this.offsetToPosition(content, importInsertPosition),
        end: this.offsetToPosition(content, importInsertPosition)
      },
      newText: `import { ${newName} } from '${moduleSpecifier}';\n`
    };
  }

  private validateImport (moduleSpecifier: string, exportName: string, containingFile: string): boolean {
    try {
      const result = ts.resolveModuleName(
        moduleSpecifier,
        containingFile,
        this.languageServiceHost!.getCompilationSettings(),
        ts.sys
      );

      if (!result.resolvedModule) {
        return false;
      }

      return true;
    } catch (error) {
      this.logger.debug(`LSP: Could not validate import: ${(error as Error).message}`);
      return true;
    }
  }

  private filePathToModuleSpecifier (filePath: string, containingFile: string): string | null {
    try {
      this.logger.debug(`LSP: Converting filePath: ${filePath}`);
      this.logger.debug(`LSP: Containing file: ${containingFile}`);

      const modulePath = filePath.replace(/\.(d\.ts|tsx?|jsx?)$/, '');

      const nodeModulesIndex = modulePath.indexOf('node_modules/');
      if (nodeModulesIndex !== -1) {
        this.logger.debug('LSP: Detected node_modules path');
        const afterNodeModules = modulePath.substring(nodeModulesIndex + 'node_modules/'.length);

        if (afterNodeModules.startsWith('@')) {
          const parts = afterNodeModules.split('/');
          if (parts.length >= 2) {
            const scope = parts[0];
            const packageName = parts[1];
            const rest = parts.slice(2).join('/');

            const basePackage = `${scope}/${packageName}`;

            if (!rest) {
              this.logger.debug(`LSP: Returning base package: ${basePackage}`);
              return basePackage;
            }

            const specifier = this.resolvePackageSubpath(basePackage, rest, filePath);
            this.logger.debug(`LSP: Resolved to: ${specifier || basePackage}`);
            return specifier || basePackage;
          }
        } else {
          const parts = afterNodeModules.split('/');
          const packageName = parts[0];
          const rest = parts.slice(1).join('/');

          if (!rest) {
            this.logger.debug(`LSP: Returning package: ${packageName}`);
            return packageName;
          }

          const specifier = this.resolvePackageSubpath(packageName, rest, filePath);
          this.logger.debug(`LSP: Resolved to: ${specifier || packageName}`);
          return specifier || packageName;
        }
      }

      this.logger.debug('LSP: Computing relative path for local file');
      const relative = path.relative(path.dirname(containingFile), modulePath);
      this.logger.debug(`LSP: Relative path computed: ${relative}`);

      if (!relative.startsWith('.')) {
        const result = './' + relative;
        this.logger.debug(`LSP: Returning: ${result}`);
        return result;
      }

      this.logger.debug(`LSP: Returning: ${relative}`);
      return relative;
    } catch (error) {
      this.logger.error(`LSP: Error converting path to module specifier: ${(error as Error).message}`);
      return null;
    }
  }

  private resolvePackageSubpath (packageName: string, restPath: string, originalFilePath: string): string | null {
    const internalDirs = ['dist', 'lib', 'esm', 'cjs', 'src', 'compiled', 'build', 'out'];

    let cleanPath = restPath;
    for (const dir of internalDirs) {
      if (cleanPath.startsWith(`${dir}/`)) {
        cleanPath = cleanPath.substring(dir.length + 1);
        break;
      }
    }

    cleanPath = cleanPath.replace(/\/index(\.[^/]*)?$/, '');

    if (cleanPath === 'index' || cleanPath.match(/^index\.[^/]+$/)) {
      cleanPath = '';
    }

    if (cleanPath === packageName || cleanPath === packageName.split('/').pop()) {
      return packageName;
    }

    if (!cleanPath) {
      return packageName;
    }

    try {
      const packageJsonPath = this.findPackageJson(originalFilePath);
      if (packageJsonPath && fs.existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

        if (packageJson.exports) {
          const exports = packageJson.exports;

          const possiblePaths = [
            `./${cleanPath}`,
            `./${cleanPath}/index`,
            cleanPath
          ];

          for (const testPath of possiblePaths) {
            if (exports[testPath]) {
              return `${packageName}/${cleanPath}`;
            }
          }

          if (exports['.'] && !exports[`./${cleanPath}`]) {
            return packageName;
          }
        }
      }
    } catch (error) {
    }

    return `${packageName}/${cleanPath}`;
  }

  private findPackageJson (filePath: string): string | null {
    const nodeModulesIndex = filePath.indexOf('node_modules/');
    if (nodeModulesIndex === -1) return null;

    const afterNodeModules = filePath.substring(nodeModulesIndex + 'node_modules/'.length);
    const parts = afterNodeModules.split('/');

    const packageParts = parts[0].startsWith('@') ? 2 : 1;
    const packagePath = parts.slice(0, packageParts).join('/');

    const packageDir = filePath.substring(0, nodeModulesIndex) + 'node_modules/' + packagePath;
    return path.join(packageDir, 'package.json');
  }

  private findImportInsertPosition (content: string): number {
    const lines = content.split('\n');
    let lastImportEndLine = -1;
    let i = 0;

    while (i < lines.length) {
      const line = lines[i].trim();
      if (line.startsWith('import ') || line.startsWith('import{')) {
        let currentLine = i;
        let importText = lines[i];
        while (!importText.includes(';') && !importText.match(/from\s+['"][^'"]+['"]\s*$/) && currentLine < lines.length - 1) {
          currentLine++;
          importText += '\n' + lines[currentLine];
        }
        lastImportEndLine = currentLine;
        i = currentLine;
      } else if (line && !line.startsWith('//') && !line.startsWith('/*') && lastImportEndLine !== -1) {
        break;
      }
      i++;
    }

    if (lastImportEndLine !== -1) {
      let offset = 0;
      for (let i = 0; i <= lastImportEndLine; i++) {
        offset += lines[i].length + 1;
      }
      return offset;
    }

    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('//') || line.startsWith('/*') || line.startsWith('*') ||
        line.startsWith('"use ') || line.startsWith("'use ") || !line) {
        offset += lines[i].length + 1;
      } else {
        break;
      }
    }
    return offset;
  }

  private async handleReferences (id: number | string, params: ReferenceParams): Promise<SuccessResult<Location[]> | ErrorResult> {
    const response = await this.handleRequest({
      method: 'references',
      uri: params.textDocument.uri,
      position: params.position
    }) as LocationResponse;

    if (response.success) {
      return {
        jsonrpc: '2.0',
        id,
        result: response.data
      };
    } else {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: response.error
        }
      };
    }
  }

  private handleDocumentSymbols (id: number | string, params: DocumentSymbolParams): SuccessResult<TypeSymbol[]> | ErrorResult {
    const fileName = this.uriToFileName(params.textDocument.uri);

    if (!this.languageService) {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: 'Language service not initialized'
        }
      };
    }

    try {
      const navTree = this.languageService.getNavigationTree(fileName);
      const symbols = this.convertNavTreeToSymbols(navTree, params.textDocument.uri);

      return {
        jsonrpc: '2.0',
        id,
        result: symbols
      };
    } catch (error) {
      this.logger.error(`LSP: Error getting document symbols: ${(error as Error).message}`);
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: 'Failed to get document symbols'
        }
      };
    }
  }

  private convertNavTreeToSymbols (navItem: ts.NavigationTree, uri: string): TypeSymbol[] {
    const symbols: TypeSymbol[] = [];

    const convertItem = (item: ts.NavigationTree, containerName?: string): TypeSymbol | null => {
      const content = this.getContent(this.uriToFileName(uri));
      if (!content) return null;

      const startPos = this.offsetToPosition(content, item.spans[0].start);
      const endPos = this.offsetToPosition(content, item.spans[0].start + item.spans[0].length);

      const symbol: TypeSymbol = {
        name: item.text,
        kind: this.mapNavItemKindToSymbolKind(item.kind),
        range: {
          start: startPos,
          end: endPos
        },
        selectionRange: {
          start: startPos,
          end: endPos
        },
        containerName: '',
        children: []
      };

      if (containerName) {
        symbol.containerName = containerName;
      }

      if (item.childItems && item.childItems.length > 0) {
        symbol.children = item.childItems
          .map(child => convertItem(child, item.text))
          .filter(Boolean);
      }

      return symbol;
    };

    if (navItem.childItems) {
      for (const child of navItem.childItems) {
        const symbol = convertItem(child);
        if (symbol) {
          symbols.push(symbol);
        }
      }
    }

    return symbols;
  }

  private mapNavItemKindToSymbolKind (kind: ts.ScriptElementKind): number {
    const SymbolKind = {
      File: 1,
      Module: 2,
      Namespace: 3,
      Package: 4,
      Class: 5,
      Method: 6,
      Property: 7,
      Field: 8,
      Constructor: 9,
      Enum: 10,
      Interface: 11,
      Function: 12,
      Variable: 13,
      Constant: 14,
      String: 15,
      Number: 16,
      Boolean: 17,
      Array: 18,
      Object: 19,
      Key: 20,
      Null: 21,
      EnumMember: 22,
      Struct: 23,
      Event: 24,
      Operator: 25,
      TypeParameter: 26
    };

    switch (kind) {
      case ts.ScriptElementKind.moduleElement:
        return SymbolKind.Module;
      case ts.ScriptElementKind.classElement:
        return SymbolKind.Class;
      case ts.ScriptElementKind.interfaceElement:
        return SymbolKind.Interface;
      case ts.ScriptElementKind.enumElement:
        return SymbolKind.Enum;
      case ts.ScriptElementKind.enumMemberElement:
        return SymbolKind.EnumMember;
      case ts.ScriptElementKind.functionElement:
      case ts.ScriptElementKind.localFunctionElement:
        return SymbolKind.Function;
      case ts.ScriptElementKind.memberFunctionElement:
      case ts.ScriptElementKind.memberGetAccessorElement:
      case ts.ScriptElementKind.memberSetAccessorElement:
        return SymbolKind.Method;
      case ts.ScriptElementKind.memberVariableElement:
        return SymbolKind.Property;
      case ts.ScriptElementKind.variableElement:
      case ts.ScriptElementKind.letElement:
        return SymbolKind.Variable;
      case ts.ScriptElementKind.constElement:
        return SymbolKind.Constant;
      case ts.ScriptElementKind.constructorImplementationElement:
        return SymbolKind.Constructor;
      case ts.ScriptElementKind.typeParameterElement:
        return SymbolKind.TypeParameter;
      default:
        return SymbolKind.Variable;
    }
  }

  async initialize () {
    if (this.languageService) return;
    this.initializeTypescript();
    this.initializeESLint();
    this.initializePrettier();
    await this.initializeTailwind();
  }

  private initializeTypescript (): void {
    if (this.languageService) return;
    const tsconfigPath = path.join(this.workspaceRoot, 'tsconfig.json');
    let compilerOptions: ts.CompilerOptions = {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      jsx: ts.JsxEmit.ReactJSX,
      lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
      allowJs: true,
      checkJs: false,
      skipLibCheck: true,
      strict: true,
      noImplicitAny: true,
      esModuleInterop: true,
      resolveJsonModule: true,
      allowSyntheticDefaultImports: true,
      noEmit: true
    };
    let projectFiles: string[] = [];
    let hasTsConfig = false;
    if (fs.existsSync(tsconfigPath)) {
      try {
        const configFile = ts.readConfigFile(tsconfigPath, (path) => ts.sys.readFile(path));
        if (!configFile.error) {
          const parsedConfig = ts.parseJsonConfigFileContent(
            configFile.config,
            ts.sys,
            this.workspaceRoot
          );
          compilerOptions = {
            ...parsedConfig.options,
            moduleResolution: ts.ModuleResolutionKind.Node10
          };
          projectFiles = parsedConfig.fileNames;
          hasTsConfig = true;
          this.logger.info(`LSP: Loaded tsconfig.json with ${projectFiles.length} files`);
        }
      } catch (error) {
        this.logger.error(`LSP: Error loading tsconfig: ${(error as Error).message}`);
      }
    }

    if (!hasTsConfig) {
      const projectInfo = this.fileSystemApi.projectInfo();
      const supportedExtensions = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];
      const ignoreDirs = ['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.nuxt', '.react-router', '.vite', 'out', '.turbo', '.cache'];

      projectFiles = projectInfo.files.filter(file => {
        const ext = path.extname(file).toLowerCase();
        const isInIgnoredDir = ignoreDirs.some(dir =>
          file.includes(`${path.sep}${dir}${path.sep}`) ||
          file.includes(`${path.sep}.${dir}${path.sep}`)
        );
        return supportedExtensions.includes(ext) && !isInIgnoredDir;
      });

      this.logger.info(`LSP: No tsconfig.json found. Running in JavaScript mode with ${projectFiles.length} files`);
    }

    this.languageServiceHost = {
      getScriptFileNames: () => {
        const allFiles = new Set([...projectFiles, ...Array.from(this.fileCache.keys())]);
        return Array.from(allFiles);
      },
      getScriptVersion: (fileName: string) => {
        return (this.fileVersions.get(fileName) || 0).toString();
      },
      getScriptSnapshot: (fileName: string) => {
        const content = this.fileCache.get(fileName);
        if (content !== undefined) {
          return ts.ScriptSnapshot.fromString(content);
        }
        if (fs.existsSync(fileName)) {
          try {
            const fileContent = fs.readFileSync(fileName, 'utf-8');
            return ts.ScriptSnapshot.fromString(fileContent);
          } catch (error) {
            this.logger.error(`LSP: Error reading file ${fileName}: ${(error as Error).message}`);
          }
        }
        return undefined;
      },
      getCurrentDirectory: () => this.workspaceRoot,
      getCompilationSettings: () => compilerOptions,
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      fileExists: (fileName: string) => ts.sys.fileExists(fileName),
      readFile: (fileName: string) => ts.sys.readFile(fileName),
      readDirectory: (path: string, extensions?: readonly string[], exclude?: readonly string[], include?: readonly string[], depth?: number) =>
        ts.sys.readDirectory(path, extensions, exclude, include, depth),
      resolveModuleNames: (moduleNames: string[], containingFile: string) => {
        return moduleNames.map((moduleName) => {
          const result = ts.resolveModuleName(
            moduleName,
            containingFile,
            compilerOptions,
            ts.sys
          );
          return result.resolvedModule;
        });
      }
    };

    this.languageService = ts.createLanguageService(
      this.languageServiceHost,
      ts.createDocumentRegistry()
    );

    this.logger.success('LSP: TypeScript language service initialized');
  }

  private async initializeTailwind (): Promise<void> {
    try {
      const tailwindConfigPath = this.findTailwindConfig();
      if (!tailwindConfigPath) {
        this.logger.info('LSP: No Tailwind config found, skipping Tailwind integration');
        return;
      }

      const tailwindPath = path.join(this.workspaceRoot, 'node_modules', 'tailwindcss');
      if (!fs.existsSync(tailwindPath)) {
        this.logger.info('LSP: Tailwind config found but tailwindcss is not installed');
        return;
      }

      this.hasTailwind = true;
      await this.generateTailwindCompletions();
      this.logger.success('LSP: Tailwind integration initialized');
    } catch (error) {
      this.logger.warn(`LSP: Failed to initialize Tailwind: ${(error as Error).message}`);
      this.hasTailwind = false;
    }
  }

  private initializeESLint (): void {
    const eslintConfigFiles = [
      '.eslintrc.js',
      '.eslintrc.cjs',
      '.eslintrc.yaml',
      '.eslintrc.yml',
      '.eslintrc.json',
      'eslint.config.js',
      'eslint.config.mjs',
      'eslint.config.cjs'
    ];

    const hasConfig = eslintConfigFiles.some(configFile => {
      const configPath = path.join(this.workspaceRoot, configFile);
      return fs.existsSync(configPath);
    });

    const packageJsonPath = path.join(this.workspaceRoot, 'package.json');
    let hasPackageJsonConfig = false;
    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        hasPackageJsonConfig = !!packageJson.eslintConfig;
      } catch (error) {
      }
    }

    if (!hasConfig && !hasPackageJsonConfig) {
      this.logger.info('LSP: No ESLint configuration found, skipping ESLint integration');
      return;
    }

    try {
      const eslintPath = path.join(this.workspaceRoot, 'node_modules', 'eslint');

      if (!fs.existsSync(eslintPath)) {
        this.logger.info('LSP: ESLint config found but ESLint is not installed in node_modules');
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Module = require('module');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, n/no-deprecated-api
      const createRequire = Module.createRequire || Module.createRequireFromPath;

      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-call
      const userRequire = createRequire(path.join(this.workspaceRoot, 'package.json')) as NodeJS.Require;

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const { ESLint } = userRequire('eslint');

      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      this.eslint = new ESLint({
        cwd: this.workspaceRoot,
        useEslintrc: true
      }) as ESLint;

      this.hasEslint = true;
      this.logger.success('LSP: ESLint integration initialized');
    } catch (error) {
      this.logger.warn(`LSP: Failed to initialize ESLint: ${(error as Error).message}`);
      this.hasEslint = false;
    }
  }

  private initializePrettier (): void {
    this.logger.info('LSP: Checking for Prettier configuration...');

    const prettierConfigFiles = [
      '.prettierrc',
      '.prettierrc.json',
      '.prettierrc.js',
      '.prettierrc.cjs',
      '.prettierrc.mjs',
      '.prettierrc.yaml',
      '.prettierrc.yml',
      'prettier.config.js',
      'prettier.config.cjs',
      'prettier.config.mjs'
    ];

    const hasConfig = prettierConfigFiles.some((configFile) => {
      const configPath = path.join(this.workspaceRoot, configFile);
      const exists = fs.existsSync(configPath);
      if (exists) {
        this.logger.info(`LSP: Found Prettier config: ${configFile}`);
      }
      return exists;
    });

    const packageJsonPath = path.join(this.workspaceRoot, 'package.json');
    let hasPackageJsonConfig = false;
    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        hasPackageJsonConfig = !!packageJson.prettier;
        if (hasPackageJsonConfig) {
          this.logger.info('LSP: Found Prettier config in package.json');
        }
      } catch {}
    }

    if (!hasConfig && !hasPackageJsonConfig) {
      this.logger.info('LSP: No Prettier configuration found, skipping Prettier integration');
      return;
    }

    try {
      const prettierPath = path.join(this.workspaceRoot, 'node_modules', 'prettier');
      this.logger.info(`LSP: Looking for Prettier at: ${prettierPath}`);

      if (!fs.existsSync(prettierPath)) {
        this.logger.warn('LSP: Prettier config found but Prettier is not installed in node_modules');
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Module = require('module');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, n/no-deprecated-api
      const createRequire = Module.createRequire || Module.createRequireFromPath;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      const userRequire = createRequire(path.join(this.workspaceRoot, 'package.json')) as NodeJS.Require;

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      this.prettier = userRequire('prettier') as typeof Prettier;

      this.hasPrettier = true;
      this.logger.success('LSP: Prettier integration initialized successfully');
    } catch (error) {
      this.logger.warn(`LSP: Failed to initialize Prettier: ${(error as Error).message}`);
      this.hasPrettier = false;
    }
  }

  updateFile (uri: string, content: string): void {
    const fileName = this.uriToFileName(uri);
    this.fileCache.set(fileName, content);

    const currentVersion = this.fileVersions.get(fileName) || 0;
    this.fileVersions.set(fileName, currentVersion + 1);

    this.logger.debug(`LSP: Updated file ${fileName}`);
  }

  async handleRequest (params: LspRequestParams): Promise<LspResponse> {
    if (!this.languageService) {
      await this.initialize();
    }

    if (!this.languageService) {
      return {
        success: false,
        error: 'Language service not initialized'
      };
    }

    try {
      if (params.content !== undefined) {
        this.updateFile(params.uri, params.content);
      }

      switch (params.method) {
        case 'completion':
          return this.getCompletions(params.uri, params.position!);

        case 'hover':
          return this.getHover(params.uri, params.position!);

        case 'definition':
          return this.getDefinition(params.uri, params.position!);

        case 'references':
          return this.getReferences(params.uri, params.position!);

        case 'diagnostics':
          return await this.getDiagnostics(params.uri);

        default:
          return {
            success: false,
            error: 'Unknown LSP method'
          };
      }
    } catch (error) {
      this.logger.error(`LSP: Error handling ${params.method}: ${(error as Error).message}`);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  private handleInsertImport (id: number | string, params: InsertImportParams): SuccessResult<TextEdit[]> | ErrorResult {
    try {
      const fileName = this.uriToFileName(params.textDocument.uri);
      const content = this.getContent(fileName);

      if (!content) {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32603,
            message: 'File content not found'
          }
        };
      }

      const identifierName = params.identifierName;
      const moduleSpecifier = params.moduleSpecifier;

      if (!identifierName) {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32603,
            message: 'Identifier name is required'
          }
        };
      }

      const offset = this.positionToOffset(content, params.position);
      if (this.isInsideImportStatement(content, offset)) {
        return {
          jsonrpc: '2.0',
          id,
          result: []
        };
      }

      const existingImport = this.findExistingImport(content, moduleSpecifier);

      let importEdit: TextEdit;
      if (existingImport) {
        const edit = this.mergeWithExistingImport(content, existingImport, identifierName);
        if (!edit) {
          return {
            jsonrpc: '2.0',
            id,
            result: []
          };
        }
        importEdit = edit;
      } else {
        const importInsertPosition = this.findImportInsertPosition(content);
        const importStatement = `import { ${identifierName} } from '${moduleSpecifier}';\n`;

        importEdit = {
          range: {
            start: this.offsetToPosition(content, importInsertPosition),
            end: this.offsetToPosition(content, importInsertPosition)
          },
          newText: importStatement
        };
      }

      return {
        jsonrpc: '2.0',
        id,
        result: [importEdit]
      };
    } catch (error) {
      this.logger.error(`LSP: Error inserting import: ${(error as Error).message}`);
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: (error as Error).message
        }
      };
    }
  }

  private isInsideImportStatement (content: string, offset: number): boolean {
    const beforeCursor = content.substring(Math.max(0, offset - 500), offset);

    const lastNewline = beforeCursor.lastIndexOf('\n');
    const currentLine = lastNewline === -1 ? beforeCursor : beforeCursor.substring(lastNewline + 1);

    const importRegex = /^\s*import\s+/;
    if (importRegex.test(currentLine)) {
      const afterCursor = content.substring(offset, Math.min(content.length, offset + 200));
      const nextNewline = afterCursor.indexOf('\n');
      const restOfLine = nextNewline === -1 ? afterCursor : afterCursor.substring(0, nextNewline);

      return !restOfLine.includes(';');
    }

    return false;
  }

  private async handleFormat (id: number | string, params: { textDocument: TextDocumentIdentifier }): Promise<SuccessResult<TextEdit[]> | ErrorResult> {
    try {
      const fileName = this.uriToFileName(params.textDocument.uri);
      const content = this.getContent(fileName);

      if (!content) {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32603,
            message: 'File content not found'
          }
        };
      }

      if (this.hasPrettier && this.prettier) {
        try {
          const configFile = await this.prettier.resolveConfigFile(fileName);
          if (!configFile) {
            return { jsonrpc: '2.0', id, result: [] };
          }

          let rawConfig: any;
          if (configFile.endsWith('.json') || configFile.endsWith('.prettierrc')) {
            const configContent = fs.readFileSync(configFile, 'utf-8');
            rawConfig = JSON.parse(configContent);
          } else {
            rawConfig = await this.prettier.resolveConfig(fileName, { editorconfig: true });
          }

          if (!rawConfig) {
            return { jsonrpc: '2.0', id, result: [] };
          }

          const options = { ...rawConfig };

          if (options.plugins && Array.isArray(options.plugins)) {
            const loadedPlugins = [];
            for (const plugin of options.plugins) {
              if (typeof plugin === 'string') {
                try {
                  const pluginPath = require.resolve(plugin, {
                    paths: [this.workspaceRoot]
                  });
                  const loaded = await import(pluginPath);
                  loadedPlugins.push(loaded.default || loaded);
                } catch (error) {
                  this.logger.warn(`LSP: Failed to load plugin ${plugin}`);
                }
              } else {
                loadedPlugins.push(plugin);
              }
            }
            options.plugins = loadedPlugins;
          }

          const formatted = await this.prettier.format(content, {
            ...options,
            filepath: fileName
          });

          if (formatted === content) {
            return { jsonrpc: '2.0', id, result: [] };
          }

          const edit: TextEdit = {
            range: {
              start: { line: 0, character: 0 },
              end: this.offsetToPosition(content, content.length)
            },
            newText: formatted
          };

          this.logger.info(`LSP: Formatted ${fileName} with Prettier`);
          return { jsonrpc: '2.0', id, result: [edit] };
        } catch (error) {
          this.logger.error(`LSP: Prettier formatting error: ${(error as Error).message}`);
        }
      }

      return { jsonrpc: '2.0', id, result: [] };
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: (error as Error).message
        }
      };
    }
  }

  private async handleFormatRange (
    id: number | string,
    params: { textDocument: TextDocumentIdentifier, range: Range }
  ): Promise<SuccessResult<TextEdit[]> | ErrorResult> {
    try {
      const fileName = this.uriToFileName(params.textDocument.uri);
      const content = this.getContent(fileName);

      if (!content) {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32603,
            message: 'File content not found'
          }
        };
      }

      const startOffset = this.positionToOffset(content, params.range.start);
      const endOffset = this.positionToOffset(content, params.range.end);

      if (this.hasPrettier && this.prettier) {
        try {
          const configFile = await this.prettier.resolveConfigFile(fileName);

          if (!configFile) {
            return { jsonrpc: '2.0', id, result: [] };
          }

          let rawConfig: any;

          if (configFile.endsWith('.json') || configFile.endsWith('.prettierrc')) {
            const configContent = fs.readFileSync(configFile, 'utf-8');
            rawConfig = JSON.parse(configContent);
          } else {
            try {
              rawConfig = await this.prettier.resolveConfig(fileName, { editorconfig: true });
            } catch (err) {
              this.logger.debug(`LSP: Could not resolve Prettier config: ${(err as Error).message}`);
              return { jsonrpc: '2.0', id, result: [] };
            }
          }

          if (!rawConfig) {
            return { jsonrpc: '2.0', id, result: [] };
          }

          const options = { ...rawConfig };

          if (options.plugins && Array.isArray(options.plugins)) {
            const loadedPlugins = [];
            for (const plugin of options.plugins) {
              if (typeof plugin === 'string') {
                try {
                  const pluginPath = require.resolve(plugin, {
                    paths: [this.workspaceRoot]
                  });
                  const loaded = await import(pluginPath);
                  loadedPlugins.push(loaded.default || loaded);
                } catch (error) {
                  this.logger.warn(`LSP: Failed to load Prettier plugin ${plugin}`);
                }
              } else {
                loadedPlugins.push(plugin);
              }
            }
            options.plugins = loadedPlugins;
          }

          const formatted = await this.prettier.format(content, {
            ...options,
            filepath: fileName,
            rangeStart: startOffset,
            rangeEnd: endOffset
          });

          if (formatted === content) {
            return { jsonrpc: '2.0', id, result: [] };
          }

          const edit: TextEdit = {
            range: {
              start: params.range.start,
              end: params.range.end
            },
            newText: formatted.substring(startOffset, startOffset + (formatted.length - content.length) + (endOffset - startOffset))
          };

          this.logger.info(`LSP: Formatted range in ${fileName} with Prettier`);
          return { jsonrpc: '2.0', id, result: [edit] };
        } catch (error) {
          this.logger.error(`LSP: Prettier range formatting error: ${(error as Error).message}`);
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32603,
              message: `Prettier formatting failed: ${(error as Error).message}`
            }
          };
        }
      }

      this.logger.debug('LSP: No Prettier configuration found');
      return { jsonrpc: '2.0', id, result: [] };
    } catch (error) {
      this.logger.error(`LSP: Format range error: ${(error as Error).message}`);
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: (error as Error).message
        }
      };
    }
  }

  private getCompletions (uri: string, position: Position): CompletionResponse {
    const fileName = this.uriToFileName(uri);
    const content = this.getContent(fileName);

    if (!content) {
      return { success: false, error: 'File content not found' };
    }

    const offset = this.positionToOffset(content, position);

    if (this.isInClassNameAttribute(content, offset)) {
      return this.getTailwindCompletions(uri, position);
    }

    const completionOptions: ts.GetCompletionsAtPositionOptions = {
      includeCompletionsForModuleExports: true,
      includeCompletionsWithInsertText: true,
      includeAutomaticOptionalChainCompletions: true,
      includeCompletionsForImportStatements: true,
      includeCompletionsWithClassMemberSnippets: true,
      includeCompletionsWithObjectLiteralMethodSnippets: true
    };

    const completions = this.languageService!.getCompletionsAtPosition(
      fileName,
      offset,
      completionOptions
    );

    if (!completions) {
      return { success: true, data: [] };
    }

    const items: CompletionItem[] = completions.entries.map((entry) => {
      let sortPrefix = '50';
      if (entry.source) {
        const moduleSpec = this.filePathToModuleSpecifier(entry.source, fileName);

        const isFirstParty = moduleSpec && (moduleSpec.startsWith('.') || moduleSpec.startsWith('/'));

        if (isFirstParty) {
          sortPrefix = '10';
        } else {
          sortPrefix = '30';
        }
      } else if (entry.name.startsWith('declare ')) {
        sortPrefix = '90';
      }

      let displayDetail = entry.kindModifiers;
      if (entry.source) {
        const moduleSpec = this.filePathToModuleSpecifier(entry.source, fileName);
        displayDetail = moduleSpec ? `Auto import from '${moduleSpec}'` : `Auto import from '${entry.source}'`;
      }

      const item: CompletionItem = {
        label: entry.name,
        kind: this.mapCompletionKind(entry.kind),
        detail: displayDetail,
        sortText: `${sortPrefix.padStart(3, '0')}_${(entry.sortText || entry.name).padStart(100, '0')}`,
        insertText: entry.insertText,
        insertTextFormat: entry.isSnippet ? 2 : 1
      };

      if (entry.data || entry.source) {
        item.data = {
          fileName,
          offset,
          name: entry.name,
          source: entry.source,
          tsData: entry.data
        };
      }

      return item;
    });

    return { success: true, data: items };
  }

  private findTailwindConfig (): string | null {
    const configFiles = [
      'tailwind.config.js',
      'tailwind.config.cjs',
      'tailwind.config.mjs',
      'tailwind.config.ts'
    ];

    for (const configFile of configFiles) {
      const configPath = path.join(this.workspaceRoot, configFile);
      if (fs.existsSync(configPath)) {
        return configPath;
      }
    }

    return null;
  }

  private async generateTailwindCompletions (): Promise<void> {
    try {
      this.buildBasicTailwindCompletions();

      const configPath = this.findTailwindConfig();
      if (configPath) {
        try {
          await this.enhanceWithConfigTheme(configPath);
        } catch (error) {
          this.logger.debug(`LSP: Could not enhance Tailwind completions from config: ${(error as Error).message}`);
        }
      }
    } catch (error) {
      this.logger.error(`LSP: Failed to generate Tailwind completions: ${(error as Error).message}`);
      this.buildBasicTailwindCompletions();
    }
  }

  private async enhanceWithConfigTheme (configPath: string): Promise<void> {
    const content = fs.readFileSync(configPath, 'utf-8');

    const colorMatches = content.matchAll(/colors:\s*{([^}]+)}/g);
    const colors = new Set<string>();

    for (const match of colorMatches) {
      const colorBlock = match[1];
      const colorNames = colorBlock.matchAll(/['"]?(\w+)['"]?\s*:/g);
      for (const colorName of colorNames) {
        colors.add(colorName[1]);
      }
    }

    if (colors.size > 0) {
      const existingCompletions = this.tailwindCompletions.get('all') || [];
      const newCompletions: CompletionItem[] = [];

      colors.forEach(color => {
        ['text', 'bg', 'border'].forEach(prefix => {
          newCompletions.push({
            label: `${prefix}-${color}`,
            kind: CompletionItemKind.Constant,
            detail: 'Tailwind CSS',
            sortText: `tw_colors_${prefix}-${color}`,
            insertText: `${prefix}-${color}`,
            insertTextFormat: 1
          });
        });
      });

      this.tailwindCompletions.set('all', [...existingCompletions, ...newCompletions]);
      this.logger.info(`LSP: Added ${newCompletions.length} custom color completions`);
    }
  }

  private buildBasicTailwindCompletions (): void {
    const commonClasses = [
      'container', 'flex', 'grid', 'block', 'inline-block', 'inline', 'hidden',
      'flex-row', 'flex-col', 'flex-wrap', 'items-center', 'items-start', 'items-end',
      'justify-center', 'justify-between', 'justify-start', 'justify-end',
      'gap-1', 'gap-2', 'gap-4', 'gap-8',

      'p-0', 'p-1', 'p-2', 'p-4', 'p-6', 'p-8',
      'm-0', 'm-1', 'm-2', 'm-4', 'm-6', 'm-8',
      'px-4', 'py-2', 'mx-auto',

      'text-xs', 'text-sm', 'text-base', 'text-lg', 'text-xl', 'text-2xl',
      'font-normal', 'font-medium', 'font-semibold', 'font-bold',
      'text-gray-500', 'text-gray-900', 'text-white',

      'bg-white', 'bg-gray-100', 'bg-gray-900', 'bg-blue-500',

      'border', 'border-2', 'rounded', 'rounded-lg', 'rounded-full',

      'shadow', 'shadow-md', 'shadow-lg', 'opacity-50', 'opacity-100',

      'sm:', 'md:', 'lg:', 'xl:', '2xl:',

      'hover:', 'focus:', 'active:', 'disabled:'
    ];

    const completions: CompletionItem[] = commonClasses.map(className => ({
      label: className,
      kind: CompletionItemKind.Constant,
      detail: 'Tailwind CSS',
      sortText: `tw_${className}`,
      insertText: className,
      insertTextFormat: 1
    }));

    this.tailwindCompletions.set('all', completions);
    this.logger.info(`LSP: Built ${completions.length} basic Tailwind completions`);
  }

  private getTailwindCompletions (uri: string, position: Position): CompletionResponse {
    if (!this.hasTailwind) {
      return { success: true, data: [] };
    }

    const fileName = this.uriToFileName(uri);
    const content = this.getContent(fileName);

    if (!content) {
      return { success: false, error: 'File content not found' };
    }

    const offset = this.positionToOffset(content, position);
    const currentClass = this.getCurrentClassName(content, offset);

    let completions = this.tailwindCompletions.get('all') || [];

    if (currentClass) {
      completions = completions
        .filter(item => item.label.toLowerCase().startsWith(currentClass.toLowerCase()))
        .map(item => {
          return {
            ...item,
            insertText: item.label,
            data: {
              ...item.data,
              isTailwind: true
            },
            textEdit: {
              range: {
                start: this.offsetToPosition(content, offset - currentClass.length),
                end: this.offsetToPosition(content, offset)
              },
              newText: item.label
            }
          };
        });
    }

    if (this.shouldShowVariants(content, offset)) {
      const variantCompletions = this.getVariantCompletions();
      const enhancedVariants: CompletionItem[] = [];

      for (const item of variantCompletions) {
        if (!currentClass) {
          enhancedVariants.push(item);
          continue;
        }

        const newText = typeof item.insertText === 'string'
          ? item.insertText
          : (typeof item.label === 'string' ? item.label : '');

        const enhanced: CompletionItem = {
          label: item.label,
          kind: item.kind,
          detail: item.detail,
          documentation: item.documentation,
          sortText: item.sortText,
          insertText: item.insertText,
          insertTextFormat: item.insertTextFormat,
          textEdit: {
            range: {
              start: this.offsetToPosition(content, offset - currentClass.length),
              end: this.offsetToPosition(content, offset)
            },
            newText
          }
        };

        enhancedVariants.push(enhanced);
      }

      completions = [...completions, ...enhancedVariants];
    }

    return {
      success: true,
      data: completions
    };
  }

  private shouldShowVariants (content: string, offset: number): boolean {
    const currentClass = this.getCurrentClassName(content, offset);
    return !currentClass.includes(':');
  }

  private getVariantCompletions (): CompletionItem[] {
    const variants = [
      { name: 'hover', description: 'Applies on hover' },
      { name: 'focus', description: 'Applies when focused' },
      { name: 'active', description: 'Applies when active' },
      { name: 'disabled', description: 'Applies when disabled' },
      { name: 'sm', description: 'Applies on small screens and up (640px)' },
      { name: 'md', description: 'Applies on medium screens and up (768px)' },
      { name: 'lg', description: 'Applies on large screens and up (1024px)' },
      { name: 'xl', description: 'Applies on extra large screens and up (1280px)' },
      { name: '2xl', description: 'Applies on 2xl screens and up (1536px)' },
      { name: 'dark', description: 'Applies in dark mode' },
      { name: 'group-hover', description: 'Applies when parent group is hovered' },
      { name: 'peer-focus', description: 'Applies when peer is focused' }
    ];

    return variants.map(variant => ({
      label: `${variant.name}:`,
      kind: CompletionItemKind.Keyword,
      detail: 'Tailwind Variant',
      documentation: variant.description,
      sortText: `tw_variant_${variant.name}`,
      insertText: `${variant.name}:`,
      insertTextFormat: 1
    }));
  }

  private getCurrentClassName (content: string, offset: number): string {
    const beforeCursor = content.substring(0, offset);
    const match = beforeCursor.match(/[\s"'`]([^\s"'`]*)$/);
    return match ? match[1] : '';
  }

  private isInClassNameAttribute (content: string, offset: number): boolean {
    const beforeCursor = content.substring(Math.max(0, offset - 200), offset);
    let lastQuotePos = -1;
    let quoteChar = '';

    for (let i = beforeCursor.length - 1; i >= 0; i--) {
      const char = beforeCursor[i];
      if (char === '"' || char === "'" || char === '`') {
        lastQuotePos = i;
        quoteChar = char;
        break;
      }
    }

    if (lastQuotePos === -1) return false;
    const afterQuote = beforeCursor.substring(lastQuotePos + 1);
    if (afterQuote.includes(quoteChar)) {
      return false;
    }

    const beforeQuote = beforeCursor.substring(0, lastQuotePos);
    const match = /(?:className|class)\s*=\s*$/.test(beforeQuote);

    return match;
  }

  private getHover (uri: string, position: Position): HoverResponse {
    const fileName = this.uriToFileName(uri);
    const content = this.getContent(fileName);

    if (!content) {
      return { success: false, error: 'File content not found' };
    }

    const offset = this.positionToOffset(content, position);

    const syntacticDiagnostics = this.languageService!.getSyntacticDiagnostics(fileName);
    const semanticDiagnostics = this.languageService!.getSemanticDiagnostics(fileName);
    const allDiagnostics = [...syntacticDiagnostics, ...semanticDiagnostics];

    const diagnosticAtPosition = allDiagnostics.find(diag => {
      if (diag.start === undefined || diag.length === undefined) return false;
      return offset >= diag.start && offset <= diag.start + diag.length;
    });

    if (diagnosticAtPosition) {
      const message = ts.flattenDiagnosticMessageText(diagnosticAtPosition.messageText, '\n');

      if (diagnosticAtPosition.code === 2304 || message.includes('Cannot find name')) {
        const nameMatch = message.match(/Cannot find name '([^']+)'/);
        const identifierName = nameMatch ? nameMatch[1] : null;

        if (identifierName) {
          const completions = this.languageService!.getCompletionsAtPosition(
            fileName,
            diagnosticAtPosition.start!,
            {
              includeCompletionsForModuleExports: true,
              includeCompletionsWithInsertText: true
            }
          );

          if (completions) {
            const importSuggestions = completions.entries.filter(entry =>
              entry.name === identifierName && entry.source
            ).reverse();

            if (importSuggestions.length > 0) {
              let fixMessage = message + '\n\n';

              if (importSuggestions.length === 1) {
                const moduleSpec = this.filePathToModuleSpecifier(importSuggestions[0].source!, fileName);
                fixMessage += `💡 Import from '${moduleSpec || importSuggestions[0].source}'`;
              } else {
                fixMessage += '💡 Available imports:\n';
                importSuggestions.slice(0, 5).forEach((suggestion, i) => {
                  const moduleSpec = this.filePathToModuleSpecifier(suggestion.source!, fileName);
                  fixMessage += `  ${i + 1}. Import from '${moduleSpec || suggestion.source}'\n`;
                });
                if (importSuggestions.length > 5) {
                  fixMessage += `  ... and ${importSuggestions.length - 5} more`;
                }
              }

              const hover: Hover = {
                contents: {
                  kind: 'plaintext',
                  value: fixMessage
                }
              };
              return { success: true, data: hover };
            }
          }
        }
      }

      const hover: Hover = {
        contents: {
          kind: 'plaintext',
          value: message
        }
      };
      return { success: true, data: hover };
    }

    const info = this.languageService!.getQuickInfoAtPosition(fileName, offset);

    if (!info) {
      return { success: true, data: null };
    }

    const displayText = ts.displayPartsToString(info.displayParts || []);
    const hover: Hover = {
      contents: {
        language: 'typescript',
        value: displayText
      }
    };

    return { success: true, data: hover };
  }

  private getDefinition (uri: string, position: Position): { success: true, data: Location[] } | { success: false, error: string } {
    const fileName = this.uriToFileName(uri);
    const content = this.getContent(fileName);

    if (!content) {
      return { success: false, error: 'File content not found' };
    }

    const offset = this.positionToOffset(content, position);
    const definitions = this.languageService!.getDefinitionAtPosition(fileName, offset);

    if (!definitions || definitions.length === 0) {
      return { success: true, data: [] };
    }

    const locations: Location[] = definitions.map((def) => {
      const defUri = this.fileNameToUri(def.fileName);
      const defContent = this.getContent(def.fileName);

      if (!defContent) {
        return null;
      }

      return {
        uri: defUri,
        range: {
          start: this.offsetToPosition(defContent, def.textSpan.start),
          end: this.offsetToPosition(defContent, def.textSpan.start + def.textSpan.length)
        }
      };
    }).filter((loc): loc is Location => loc !== null);

    return { success: true, data: locations };
  }

  private getReferences (uri: string, position: Position): LocationResponse {
    const fileName = this.uriToFileName(uri);
    const content = this.getContent(fileName);

    if (!content) {
      return { success: false, error: 'File content not found' };
    }

    const offset = this.positionToOffset(content, position);
    const references = this.languageService!.getReferencesAtPosition(fileName, offset);

    if (!references || references.length === 0) {
      return { success: true, data: [] };
    }

    const locations: Location[] = references.map((ref) => {
      const refUri = this.fileNameToUri(ref.fileName);
      const refContent = this.getContent(ref.fileName);

      if (!refContent) {
        return null;
      }

      return {
        uri: refUri,
        range: {
          start: this.offsetToPosition(refContent, ref.textSpan.start),
          end: this.offsetToPosition(refContent, ref.textSpan.start + ref.textSpan.length)
        }
      };
    }).filter((loc): loc is Location => loc !== null);

    return { success: true, data: locations };
  }

  private async getDiagnostics (uri: string): Promise<DiagnosticResponse> {
    const fileName = this.uriToFileName(uri);
    const content = this.getContent(fileName);

    if (!content) {
      return { success: false, error: 'File content not found' };
    }

    try {
      const syntacticDiagnostics = this.languageService!.getSyntacticDiagnostics(fileName);
      const semanticDiagnostics = this.languageService!.getSemanticDiagnostics(fileName);
      const suggestionDiagnostics = this.languageService!.getSuggestionDiagnostics(fileName);

      const unusedImportDiagnostics = this.checkUnusedImports(fileName, content);

      const allDiagnostics = [
        ...syntacticDiagnostics,
        ...semanticDiagnostics,
        ...suggestionDiagnostics,
        ...unusedImportDiagnostics
      ];

      const diagnostics: Diagnostic[] = allDiagnostics
        .filter((diag) => {
          if (diag.code === 2304 && diag.start !== undefined && diag.length !== undefined) {
            const before = content.substring(Math.max(0, diag.start - 2), diag.start);

            if (before === '</') {
              return false;
            }
          }
          return true;
        })
        .map((diag) => {
          const start = diag.start !== undefined
            ? this.offsetToPosition(content, diag.start)
            : { line: 0, character: 0 };
          const end = diag.start !== undefined && diag.length !== undefined
            ? this.offsetToPosition(content, diag.start + diag.length)
            : { line: 0, character: 0 };

          let severity: DiagnosticSeverity;
          switch (diag.category) {
            case ts.DiagnosticCategory.Error:
              severity = DiagnosticSeverity.Error;
              break;
            case ts.DiagnosticCategory.Warning:
              severity = DiagnosticSeverity.Warning;
              break;
            case ts.DiagnosticCategory.Suggestion:
              severity = DiagnosticSeverity.Information;
              break;
            case ts.DiagnosticCategory.Message:
            default:
              severity = DiagnosticSeverity.Information;
              break;
          }

          return {
            severity,
            range: { start, end },
            message: ts.flattenDiagnosticMessageText(diag.messageText, '\n'),
            source: 'TypeScript',
            code: diag.code
          };
        });

      if (this.hasEslint && this.eslint) {
        const eslintDiagnostics = await this.getESLintDiagnostics(fileName, content);
        diagnostics.push(...eslintDiagnostics);
      }

      if (this.hasPrettier && this.prettier) {
        this.logger.info('LSP: Checking Prettier diagnostics...');
        const prettierDiagnostic = await this.getPrettierDiagnostic(fileName, content);
        if (prettierDiagnostic) {
          this.logger.info('LSP: Adding Prettier diagnostic');
          diagnostics.push(prettierDiagnostic);
        }
      }

      return { success: true, data: diagnostics };
    } catch (error) {
      this.logger.debug(`LSP: Could not get diagnostics for ${fileName}: ${(error as Error).message}`);
      return { success: true, data: [] };
    }
  }

  private async getESLintDiagnostics (fileName: string, content: string): Promise<Diagnostic[]> {
    if (!this.eslint) return [];

    try {
      const results = await this.eslint.lintText(content, { filePath: fileName });
      const diagnostics: Diagnostic[] = [];

      for (const result of results) {
        for (const message of result.messages) {
          const severity = message.severity === 2
            ? DiagnosticSeverity.Error
            : DiagnosticSeverity.Warning;

          diagnostics.push({
            severity,
            range: {
              start: {
                line: Math.max(0, message.line - 1),
                character: Math.max(0, message.column - 1)
              },
              end: {
                line: Math.max(0, (message.endLine ?? message.line) - 1),
                character: Math.max(0, (message.endColumn ?? message.column) - 1)
              }
            },
            message: message.message,
            source: 'ESLint',
            code: message.ruleId || undefined
          });
        }
      }

      return diagnostics;
    } catch (error) {
      this.logger.debug(`LSP: ESLint error for ${fileName}: ${(error as Error).message}`);
      return [];
    }
  }

  private async getPrettierDiagnostic (fileName: string, content: string): Promise<Diagnostic | null> {
    if (!this.prettier) {
      return null;
    }

    try {
      const configFile = await this.prettier.resolveConfigFile(fileName);

      if (!configFile) {
        this.logger.debug('LSP: No Prettier config file found');
        return null;
      }

      this.logger.debug(`LSP: Found config at ${configFile}`);

      let rawConfig: any;

      if (configFile.endsWith('.json') || configFile.endsWith('.prettierrc')) {
        const content = fs.readFileSync(configFile, 'utf-8');
        rawConfig = JSON.parse(content);
      } else {
        try {
          rawConfig = await this.prettier.resolveConfig(fileName, {
            editorconfig: true
          });
        } catch (err) {
          this.logger.debug(`LSP: Could not resolve config: ${(err as Error).message}`);
          return null;
        }
      }

      if (!rawConfig) {
        return null;
      }

      const options = { ...rawConfig };

      if (options.plugins && Array.isArray(options.plugins)) {
        const loadedPlugins = [];

        for (const plugin of options.plugins) {
          if (typeof plugin === 'string') {
            try {
              const pluginPath = require.resolve(plugin, {
                paths: [this.workspaceRoot]
              });

              this.logger.debug(`LSP: Loading plugin from ${pluginPath}`);

              const loaded = await import(pluginPath);
              loadedPlugins.push(loaded.default || loaded);
            } catch (error) {
              this.logger.warn(`LSP: Failed to load plugin ${plugin}: ${(error as Error).message}`);
            }
          } else {
            loadedPlugins.push(plugin);
          }
        }

        options.plugins = loadedPlugins;
      }

      const formatted = await this.prettier.format(content, {
        ...options,
        filepath: fileName
      });

      if (formatted !== content) {
        this.logger.info(`LSP: File ${fileName} needs Prettier formatting`);

        const originalLines = content.split('\n');
        const formattedLines = formatted.split('\n');

        let firstDiffLine = 0;
        let lastDiffLine = originalLines.length - 1;

        for (let i = 0; i < Math.min(originalLines.length, formattedLines.length); i++) {
          if (originalLines[i] !== formattedLines[i]) {
            firstDiffLine = i;
            break;
          }
        }

        for (let i = Math.min(originalLines.length, formattedLines.length) - 1; i >= firstDiffLine; i--) {
          if (originalLines[i] !== formattedLines[i]) {
            lastDiffLine = i;
            break;
          }
        }

        return {
          severity: DiagnosticSeverity.Information,
          range: {
            start: { line: firstDiffLine, character: 0 },
            end: { line: lastDiffLine, character: originalLines[lastDiffLine]?.length || 0 }
          },
          message: 'Code is not formatted according to Prettier rules.',
          source: 'Prettier',
          code: 'prettier/format'
        };
      }

      return null;
    } catch (error) {
      this.logger.error(`LSP: Prettier error for ${fileName}: ${(error as Error).message}`);
      return null;
    }
  }

  private checkUnusedImports (fileName: string, content: string): ts.Diagnostic[] {
    const sourceFile = this.languageService!.getProgram()?.getSourceFile(fileName);
    if (!sourceFile) return [];

    const diagnostics: ts.Diagnostic[] = [];

    sourceFile.forEachChild(node => {
      if (ts.isImportDeclaration(node)) {
        const importClause = node.importClause;
        if (!importClause) return;

        if (importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
          const namedImports = importClause.namedBindings.elements;

          namedImports.forEach(importSpecifier => {
            const importName = importSpecifier.name.text;
            const nameStart = importSpecifier.name.getStart(sourceFile);
            const nameEnd = importSpecifier.name.getEnd();

            const references = this.languageService!.findReferences(fileName, nameStart);

            let usageCount = 0;
            if (references) {
              for (const refGroup of references) {
                for (const ref of refGroup.references) {
                  if (ref.isDefinition) continue;
                  usageCount++;
                }
              }
            }

            if (usageCount === 0) {
              diagnostics.push({
                file: sourceFile,
                start: nameStart,
                length: nameEnd - nameStart,
                messageText: `'${importName}' is declared but its value is never read.`,
                category: ts.DiagnosticCategory.Warning,
                code: 6133
              });
            }
          });
        }

        if (importClause.name) {
          const importName = importClause.name.text;
          const nameStart = importClause.name.getStart(sourceFile);
          const nameEnd = importClause.name.getEnd();

          const references = this.languageService!.findReferences(fileName, nameStart);

          let usageCount = 0;
          if (references) {
            for (const refGroup of references) {
              for (const ref of refGroup.references) {
                if (ref.isDefinition) continue;
                usageCount++;
              }
            }
          }

          if (usageCount === 0) {
            diagnostics.push({
              file: sourceFile,
              start: nameStart,
              length: nameEnd - nameStart,
              messageText: `'${importName}' is declared but its value is never read.`,
              category: ts.DiagnosticCategory.Warning,
              code: 6133
            });
          }
        }

        if (importClause.namedBindings && ts.isNamespaceImport(importClause.namedBindings)) {
          const importName = importClause.namedBindings.name.text;
          const nameStart = importClause.namedBindings.name.getStart(sourceFile);
          const nameEnd = importClause.namedBindings.name.getEnd();

          const references = this.languageService!.findReferences(fileName, nameStart);

          let usageCount = 0;
          if (references) {
            for (const refGroup of references) {
              for (const ref of refGroup.references) {
                if (ref.isDefinition) continue;
                usageCount++;
              }
            }
          }

          if (usageCount === 0) {
            diagnostics.push({
              file: sourceFile,
              start: nameStart,
              length: nameEnd - nameStart,
              messageText: `'${importName}' is declared but its value is never read.`,
              category: ts.DiagnosticCategory.Warning,
              code: 6133
            });
          }
        }
      }
    });

    return diagnostics;
  }

  private getContent (fileName: string): string | undefined {
    const cached = this.fileCache.get(fileName);
    if (cached !== undefined) {
      return cached;
    }

    if (fs.existsSync(fileName)) {
      try {
        return fs.readFileSync(fileName, 'utf-8');
      } catch (error) {
        this.logger.error(`LSP: Error reading file ${fileName}: ${(error as Error).message}`);
      }
    }

    return undefined;
  }

  uriToFileName (uri: string): string {
    let filePath = decodeURIComponent(uri.replace('file://', ''));

    if (process.platform === 'win32' && filePath.startsWith('/')) {
      filePath = filePath.slice(1);
    }

    if (!path.isAbsolute(filePath)) {
      filePath = path.join(this.workspaceRoot, filePath);
    }

    return filePath;
  }

  public fileNameToUri (fileName: string): string {
    const filePath = fileName.replace(/\\/g, '/');
    if (filePath[0] !== '/' && process.platform !== 'win32') {
      return 'file:///' + filePath;
    }
    return 'file://' + filePath;
  }

  private positionToOffset (content: string, position: Position): number {
    const lines = content.split('\n');
    let offset = 0;
    for (let i = 0; i < position.line; i++) {
      offset += lines[i].length + 1;
    }
    offset += position.character;
    return offset;
  }

  private offsetToPosition (content: string, offset: number): Position {
    const lines = content.split('\n');
    let currentOffset = 0;

    for (let line = 0; line < lines.length; line++) {
      const lineLength = lines[line].length;
      if (currentOffset + lineLength >= offset) {
        return {
          line,
          character: offset - currentOffset
        };
      }
      currentOffset += lineLength + 1;
    }

    return {
      line: lines.length - 1,
      character: lines[lines.length - 1].length
    };
  }

  private async pushDiagnostics (uri: string): Promise<void> {
    const response = await this.getDiagnostics(uri);

    if (response.success) {
      const diagnosticNotification = {
        jsonrpc: '2.0' as const,
        method: 'textDocument/publishDiagnostics',
        params: {
          uri,
          diagnostics: response.data || []
        }
      };

      this.broadcast(diagnosticNotification as any);
      this.logger.debug(`LSP: Pushed ${(response.data as any)?.length || 0} diagnostics for ${uri}`);
    }
  }

  private mapCompletionKind (kind: ts.ScriptElementKind): CompletionItemKind {
    switch (kind) {
      case ts.ScriptElementKind.primitiveType:
      case ts.ScriptElementKind.keyword:
        return CompletionItemKind.Keyword;
      case ts.ScriptElementKind.variableElement:
        return CompletionItemKind.Variable;
      case ts.ScriptElementKind.functionElement:
      case ts.ScriptElementKind.memberFunctionElement:
        return CompletionItemKind.Function;
      case ts.ScriptElementKind.classElement:
        return CompletionItemKind.Class;
      case ts.ScriptElementKind.interfaceElement:
        return CompletionItemKind.Interface;
      case ts.ScriptElementKind.moduleElement:
        return CompletionItemKind.Module;
      case ts.ScriptElementKind.memberVariableElement:
        return CompletionItemKind.Field;
      case ts.ScriptElementKind.constElement:
        return CompletionItemKind.Constant;
      default:
        return CompletionItemKind.Text;
    }
  }

  cleanup (): void {
    this.eslint = undefined;
    this.hasEslint = false;

    this.prettier = undefined;
    this.hasPrettier = false;

    for (const watcher of this.watchers) {
      watcher?.close?.();
    }
    this.watchers.length = 0;

    this.debounceTimers.forEach(timer => { clearTimeout(timer); });
    this.debounceTimers.clear();

    this.listeners = [];
    this.fileCache.clear();
    this.fileVersions.clear();
    this.languageService = undefined;
    this.languageServiceHost = undefined;

    this.logger.info('LSP: Service cleaned up');
  }
}
