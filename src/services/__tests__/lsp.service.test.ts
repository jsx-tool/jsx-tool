import 'reflect-metadata';
import { container } from 'tsyringe';
import { LspService } from '../lsp.service';
import { ConfigService } from '../config.service';
import { Logger } from '../logger.service';
import { FileSystemApiService } from '../file-system-api.service';
import type {
  CompletionResponse,
  HoverResponse,
  LocationResponse,
  DiagnosticResponse
} from '../lsp.service';
import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('typescript', () => ({
  ...jest.requireActual('typescript'),
  createLanguageService: jest.fn(),
  createDocumentRegistry: jest.fn(),
  readConfigFile: jest.fn(),
  parseJsonConfigFileContent: jest.fn(),
  getDefaultLibFilePath: jest.fn(),
  resolveModuleName: jest.fn(),
  ScriptSnapshot: {
    fromString: jest.fn((text: string) => ({
      getText: () => text,
      getLength: () => text.length,
      getChangeRange: () => undefined
    }))
  },
  displayPartsToString: jest.fn(),
  flattenDiagnosticMessageText: jest.fn(),
  DiagnosticCategory: {
    Error: 0,
    Warning: 1,
    Suggestion: 2,
    Message: 3
  },
  ScriptElementKind: {
    primitiveType: 'primitive type',
    keyword: 'keyword',
    variableElement: 'var',
    functionElement: 'function',
    memberFunctionElement: 'method',
    classElement: 'class',
    interfaceElement: 'interface',
    moduleElement: 'module',
    memberVariableElement: 'property',
    constElement: 'const',
    localVariableElement: 'localVar',
  },
  sys: {
    fileExists: jest.fn(),
    readFile: jest.fn(),
    readDirectory: jest.fn()
  }
}));

jest.mock('fs');
jest.mock('path');

describe('LspService', () => {
  let service: LspService;
  let mockConfigService: jest.Mocked<ConfigService>;
  let mockLogger: jest.Mocked<Logger>;
  let mockFileSystemApi: jest.Mocked<FileSystemApiService>;
  let mockLanguageService: jest.Mocked<ts.LanguageService>;

  const mockWorkingDir = '/project/root';

  beforeEach(() => {
    container.clearInstances();

    mockConfigService = {
      getConfig: jest.fn().mockReturnValue({
        workingDirectory: mockWorkingDir,
        additionalDirectories: []
      }),
    } as unknown as jest.Mocked<ConfigService>;

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      success: jest.fn()
    } as unknown as jest.Mocked<Logger>;

    mockFileSystemApi = {
      projectInfo: jest.fn().mockReturnValue({
        projectRoot: mockWorkingDir,
        files: [
          '/project/root/src/app.tsx',
          '/project/root/src/utils.ts',
          '/project/root/src/index.js'
        ],
        additionalDirRoots: []
      })
    } as unknown as jest.Mocked<FileSystemApiService>;

    container.registerInstance(ConfigService, mockConfigService);
    container.registerInstance(Logger, mockLogger);
    container.registerInstance(FileSystemApiService, mockFileSystemApi);

    mockLanguageService = {
      getCompletionsAtPosition: jest.fn(),
      getQuickInfoAtPosition: jest.fn(),
      getDefinitionAtPosition: jest.fn(),
      getReferencesAtPosition: jest.fn(),
      getSyntacticDiagnostics: jest.fn(),
      getSemanticDiagnostics: jest.fn(),
      getSuggestionDiagnostics: jest.fn(),
      getCompletionEntryDetails: jest.fn(),
      getProgram: jest.fn()
    } as unknown as jest.Mocked<ts.LanguageService>;

    (ts.createLanguageService as jest.Mock).mockReturnValue(mockLanguageService);
    (ts.createDocumentRegistry as jest.Mock).mockReturnValue({});
    (ts.getDefaultLibFilePath as jest.Mock).mockReturnValue('/lib.d.ts');
    (ts.resolveModuleName as jest.Mock).mockReturnValue({ resolvedModule: { resolvedFileName: 'test' } });

    (path.join as jest.Mock).mockImplementation((...args: string[]) => {
      const filtered = args.filter(Boolean);
      if (filtered.length === 0) return '.';
      
      let result = filtered.join('/').replace(/\/+/g, '/');
      
      const rootPattern = '/project/root/project/root';
      if (result.includes(rootPattern)) {
        result = result.replace(rootPattern, '/project/root');
      }
      
      return result;
    });
    
    (path.extname as jest.Mock).mockImplementation((p) => {
      const parts = p.split('.');
      return parts.length > 1 ? `.${parts[parts.length - 1]}` : '';
    });
    
    (path.dirname as jest.Mock).mockImplementation((p: string) => {
      const parts = p.split('/');
      parts.pop();
      return parts.join('/') || '/';
    });
    
    (path.relative as jest.Mock).mockImplementation((from: string, to: string) => {
      return to.replace(from + '/', '');
    });
    
    (path.isAbsolute as jest.Mock).mockImplementation((p: string) => {
      return p.startsWith('/');
    });

    (fs.existsSync as jest.Mock).mockReturnValue(false);
    (fs.readFileSync as jest.Mock).mockReturnValue('file content');

    service = container.resolve(LspService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialize', () => {
    it('should initialize with tsconfig.json when present', () => {
      const mockTsConfig = { compilerOptions: { target: 'ES2020', module: 'ESNext', strict: true } };

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (ts.readConfigFile as jest.Mock).mockReturnValue({ config: mockTsConfig, error: undefined });
      (ts.parseJsonConfigFileContent as jest.Mock).mockReturnValue({
        options: {
          target: ts.ScriptTarget.ES2020,
          module: ts.ModuleKind.ESNext,
          strict: true
        },
        fileNames: ['/project/root/src/app.ts', '/project/root/src/index.ts']
      });
      (ts.getDefaultLibFilePath as jest.Mock).mockReturnValue('/lib.d.ts');

      service.initialize();

      expect(fs.existsSync).toHaveBeenCalledWith('/project/root/tsconfig.json');
      expect(ts.readConfigFile).toHaveBeenCalled();
      expect(ts.parseJsonConfigFileContent).toHaveBeenCalled();
      expect(ts.createLanguageService).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith('LSP: Loaded tsconfig.json with 2 files');
    });

    it('should initialize without tsconfig.json for JS projects', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      service.initialize();

      expect(mockFileSystemApi.projectInfo).toHaveBeenCalled();
      expect(ts.createLanguageService).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'LSP: No tsconfig.json found. Running in JavaScript mode with 3 files'
      );
    });

    it('should filter out non-JS/TS files when no tsconfig', () => {
      const pathSep = require('path').sep;
      
      mockFileSystemApi.projectInfo.mockReturnValue({
        projectRoot: mockWorkingDir,
        files: [
          '/project/root/src/app.tsx',
          '/project/root/src/style.css',
          '/project/root/dist/bundle.js',
          `/project/root${pathSep}.next${pathSep}server.js`,
          '/project/root/package.json'
        ],
        additionalDirRoots: []
      });

      (fs.existsSync as jest.Mock).mockReturnValue(false);
      service.initialize();

      const call = (ts.createLanguageService as jest.Mock).mock.calls[0];
      const host = call[0];
      const fileNames = host.getScriptFileNames();

      expect(fileNames).toContain('/project/root/src/app.tsx');
      expect(fileNames).not.toContain('/project/root/src/style.css');
      expect(fileNames).not.toContain(`/project/root${pathSep}.next${pathSep}server.js`);
      expect(fileNames).not.toContain('/project/root/package.json');
    });

    it('should handle tsconfig.json read errors gracefully', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (ts.readConfigFile as jest.Mock).mockReturnValue({
        config: {},
        error: { messageText: 'Invalid JSON' }
      });

      service.initialize();

      expect(mockFileSystemApi.projectInfo).toHaveBeenCalled();
      expect(ts.createLanguageService).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('No tsconfig.json found'));
    });

    it('should only initialize once', () => {
      service.initialize();
      service.initialize();
      expect(ts.createLanguageService).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleRequest', () => {
    beforeEach(() => {
      service.cleanup();

      (fs.existsSync as jest.Mock).mockReturnValue(false);
      (fs.readFileSync as jest.Mock).mockReturnValue('file content');
      (ts.getDefaultLibFilePath as jest.Mock).mockReturnValue('/lib.d.ts');

      (ts.createLanguageService as jest.Mock).mockClear();
      (ts.createLanguageService as jest.Mock).mockReturnValue(mockLanguageService);

      service.initialize();
      expect(ts.createLanguageService).toHaveBeenCalled();
    });

    describe('completion', () => {
      it('should return completions', async () => {
        const mockCompletions: ts.CompletionInfo = {
          isGlobalCompletion: false,
          isMemberCompletion: false,
          isNewIdentifierLocation: false,
          entries: [
            { name: 'console', kind: ts.ScriptElementKind.variableElement, sortText: '0', kindModifiers: '' } as ts.CompletionEntry,
            { name: 'const', kind: ts.ScriptElementKind.keyword, sortText: '1', kindModifiers: '' } as ts.CompletionEntry
          ]
        };
        mockLanguageService.getCompletionsAtPosition.mockReturnValue(mockCompletions);

        const result = await service.handleRequest({
          method: 'completion',
          uri: 'file:///project/root/src/app.ts',
          position: { line: 0, character: 5 },
          content: 'const test = 123;\n'
        }) as CompletionResponse;

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toHaveLength(2);
          expect(result.data[0].label).toBe('console');
          expect(result.data[1].label).toBe('const');
        }
      });

      it('should handle no completions', async () => {
        mockLanguageService.getCompletionsAtPosition.mockReturnValue(undefined);

        const result = await service.handleRequest({
          method: 'completion',
          uri: 'file:///project/root/src/app.ts',
          position: { line: 0, character: 5 },
          content: 'const test = 123;\n'
        }) as CompletionResponse;

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toEqual([]);
        }
      });

      it('should update file content before getting completions', () => {
        const content = 'const test = 123;\n';

        service.updateFile('file:///project/root/src/app.ts', content);

        const call = (ts.createLanguageService as jest.Mock).mock.calls[0];
        const host = call[0];
        const snapshot = host.getScriptSnapshot('/project/root/src/app.ts');
        expect(snapshot).toBeDefined();
        expect(snapshot?.getText()).toBe(content);
      });
    });

    describe('hover', () => {
      it('should return hover information', async () => {
        const mockQuickInfo: ts.QuickInfo = {
          kind: ts.ScriptElementKind.localVariableElement as ts.ScriptElementKind,
          kindModifiers: '',
          textSpan: { start: 10, length: 5 },
          displayParts: [
            { text: 'const', kind: 'keyword' },
            { text: ' ', kind: 'space' },
            { text: 'test', kind: 'localName' },
            { text: ':', kind: 'punctuation' },
            { text: ' ', kind: 'space' },
            { text: 'string', kind: 'keyword' }
          ],
          documentation: [],
          tags: []
        };

        mockLanguageService.getSyntacticDiagnostics.mockReturnValue([]);
        mockLanguageService.getSemanticDiagnostics.mockReturnValue([]);
        mockLanguageService.getQuickInfoAtPosition.mockReturnValue(mockQuickInfo);
        (ts.displayPartsToString as jest.Mock).mockReturnValue('const test: string');

        const result = await service.handleRequest({
          method: 'hover',
          uri: 'file:///project/root/src/app.ts',
          position: { line: 0, character: 5 },
          content: 'const test: string = "a";\n'
        }) as HoverResponse;

        expect(result.success).toBe(true);
        if (result.success && result.data) {
          const contents = result.data.contents;
          expect(contents).toHaveProperty('language');
          expect(contents).toHaveProperty('value');
          if (typeof contents === 'object' && contents !== null && 'language' in contents && 'value' in contents) {
            expect(contents.language).toBe('typescript');
            expect(contents.value).toBe('const test: string');
          }
        }
      });

      it('should handle no hover info', async () => {
        mockLanguageService.getSyntacticDiagnostics.mockReturnValue([]);
        mockLanguageService.getSemanticDiagnostics.mockReturnValue([]);
        mockLanguageService.getQuickInfoAtPosition.mockReturnValue(undefined);

        const result = await service.handleRequest({
          method: 'hover',
          uri: 'file:///project/root/src/app.ts',
          position: { line: 0, character: 5 },
          content: 'const test = 123;\n'
        }) as HoverResponse;

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toBeNull();
        }
      });
    });

    describe('definition', () => {
      it('should return definition locations', async () => {
        const mockDefinitions: readonly ts.DefinitionInfo[] = [
          {
            fileName: '/project/root/src/utils.ts',
            textSpan: { start: 100, length: 10 },
            kind: ts.ScriptElementKind.functionElement,
            name: 'testFunction',
            containerKind: ts.ScriptElementKind.moduleElement,
            containerName: 'utils'
          }
        ];

        mockLanguageService.getDefinitionAtPosition.mockReturnValue(mockDefinitions);
        (fs.existsSync as jest.Mock).mockReturnValue(true);
        (fs.readFileSync as jest.Mock).mockReturnValue('a'.repeat(200));

        const result = await service.handleRequest({
          method: 'definition',
          uri: 'file:///project/root/src/app.ts',
          position: { line: 0, character: 0 },
          content: 'export const x = 1;\n'
        }) as LocationResponse;

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toHaveLength(1);
          expect(result.data[0].uri).toBe('file:///project/root/src/utils.ts');
        }
      });

      it('should handle no definitions', async () => {
        mockLanguageService.getDefinitionAtPosition.mockReturnValue(undefined);

        const result = await service.handleRequest({
          method: 'definition',
          uri: 'file:///project/root/src/app.ts',
          position: { line: 0, character: 0 },
          content: 'export const x = 1;\n'
        }) as LocationResponse;

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toEqual([]);
        }
      });

      it('should filter out definitions for missing files', async () => {
        const mockDefinitions: readonly ts.DefinitionInfo[] = [
          {
            fileName: '/project/root/src/exists.ts',
            textSpan: { start: 0, length: 10 },
            kind: ts.ScriptElementKind.functionElement,
            name: 'existsFunc',
            containerKind: ts.ScriptElementKind.moduleElement,
            containerName: 'exists'
          },
          {
            fileName: '/project/root/src/missing.ts',
            textSpan: { start: 0, length: 10 },
            kind: ts.ScriptElementKind.functionElement,
            name: 'missingFunc',
            containerKind: ts.ScriptElementKind.moduleElement,
            containerName: 'missing'
          }
        ];

        mockLanguageService.getDefinitionAtPosition.mockReturnValue(mockDefinitions);

        (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
          if (typeof p !== 'string') return false;
          if (p.endsWith('tsconfig.json')) return false;
          if (p.includes('/src/missing.ts')) return false;
          return true;
        });

        (fs.readFileSync as jest.Mock).mockImplementation((p: string) =>
          p.includes('/src/exists.ts') ? '/* exists */' + 'a'.repeat(50) : 'file content'
        );

        const result = await service.handleRequest({
          method: 'definition',
          uri: 'file:///project/root/src/app.ts',
          position: { line: 0, character: 0 },
          content: 'export const x = 1;\n'
        }) as LocationResponse;

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toHaveLength(1);
          expect(result.data[0].uri).toContain('exists.ts');
        }
      });
    });

    describe('references', () => {
      it('should return reference locations', async () => {
        const mockReferences: ts.ReferenceEntry[] = [
          {
            fileName: '/project/root/src/app.ts',
            textSpan: { start: 50, length: 5 },
            isWriteAccess: false,
          },
          {
            fileName: '/project/root/src/utils.ts',
            textSpan: { start: 100, length: 5 },
            isWriteAccess: true,
            isInString: true,
          }
        ];

        mockLanguageService.getReferencesAtPosition.mockReturnValue(mockReferences);
        (fs.existsSync as jest.Mock).mockReturnValue(true);
        (fs.readFileSync as jest.Mock).mockReturnValue('a'.repeat(200));

        const result = await service.handleRequest({
          method: 'references',
          uri: 'file:///project/root/src/app.ts',
          position: { line: 0, character: 0 },
          content: 'const foo = 1;\nfoo;\n'
        }) as LocationResponse;

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toHaveLength(2);
        }
      });

      it('should handle no references', async () => {
        mockLanguageService.getReferencesAtPosition.mockReturnValue(undefined);

        const result = await service.handleRequest({
          method: 'references',
          uri: 'file:///project/root/src/app.ts',
          position: { line: 0, character: 0 },
          content: 'const foo = 1;\n'
        }) as LocationResponse;

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toEqual([]);
        }
      });
    });

    describe('diagnostics', () => {
      it('should return diagnostics', async () => {
        const mockSyntacticDiagnostics: ts.DiagnosticWithLocation[] = [
          {
            file: {} as ts.SourceFile,
            start: 10,
            length: 5,
            messageText: 'Missing semicolon',
            category: ts.DiagnosticCategory.Error,
            code: 1005
          }
        ];

        const mockSemanticDiagnostics: ts.Diagnostic[] = [
          {
            file: {} as ts.SourceFile,
            start: 20,
            length: 8,
            messageText: 'Type mismatch',
            category: ts.DiagnosticCategory.Warning,
            code: 2322
          }
        ];

        mockLanguageService.getSyntacticDiagnostics.mockReturnValue(mockSyntacticDiagnostics);
        mockLanguageService.getSemanticDiagnostics.mockReturnValue(mockSemanticDiagnostics);
        mockLanguageService.getSuggestionDiagnostics.mockReturnValue([]);
        mockLanguageService.getProgram.mockReturnValue(undefined);
        (ts.flattenDiagnosticMessageText as jest.Mock).mockImplementation((text) => text);

        const result = await service.handleRequest({
          method: 'diagnostics',
          uri: 'file:///project/root/src/app.ts',
          content: 'const a = 1\nconst b: string = 2\n'
        }) as DiagnosticResponse;

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toHaveLength(2);
          expect(result.data[0].message).toBe('Missing semicolon');
          expect(result.data[0].severity).toBe(1);
          expect(result.data[1].message).toBe('Type mismatch');
          expect(result.data[1].severity).toBe(2);
        }
      });

      it('should handle files not in the program', async () => {
        mockLanguageService.getSyntacticDiagnostics.mockImplementation(() => {
          throw new Error('File not in program');
        });

        const result = await service.handleRequest({
          method: 'diagnostics',
          uri: 'file:///project/root/src/unknown.ts',
          content: 'let x = 1;\n'
        }) as DiagnosticResponse;

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toEqual([]);
        }
        expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('Could not get diagnostics'));
      });

      it('should handle diagnostics without position info', async () => {
        mockLanguageService.getSyntacticDiagnostics.mockReturnValue([]);

        const mockSemanticDiagnostics: ts.Diagnostic[] = [
          {
            file: undefined,
            start: undefined,
            length: undefined,
            messageText: 'Global error',
            category: ts.DiagnosticCategory.Error,
            code: 1000
          }
        ];

        mockLanguageService.getSemanticDiagnostics.mockReturnValue(mockSemanticDiagnostics);
        mockLanguageService.getSuggestionDiagnostics.mockReturnValue([]);
        mockLanguageService.getProgram.mockReturnValue(undefined);
        (ts.flattenDiagnosticMessageText as jest.Mock).mockReturnValue('Global error');

        const result = await service.handleRequest({
          method: 'diagnostics',
          uri: 'file:///project/root/src/app.ts',
          content: '/* empty */\n'
        }) as DiagnosticResponse;

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toHaveLength(1);
          expect(result.data[0].range.start).toEqual({ line: 0, character: 0 });
          expect(result.data[0].range.end).toEqual({ line: 0, character: 0 });
        }
      });
    });

    it('should handle unknown methods', async () => {
      const result = await service.handleRequest({
        method: 'unknown' as 'completion',
        uri: 'file:///project/root/src/app.ts'
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Unknown LSP method');
      }
    });

    it('should handle errors during request processing', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue('const test = 123;\n');

      mockLanguageService.getCompletionsAtPosition.mockImplementation(() => {
        throw new Error('Internal error');
      });

      const result = await service.handleRequest({
        method: 'completion',
        uri: 'file:///project/root/src/app.ts',
        position: { line: 0, character: 0 },
        content: 'const test = 123;\n'
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Internal error');
      }
      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Error handling completion'));
    });

    it('should initialize language service if not already initialized', async () => {
      service.cleanup();
      (ts.createLanguageService as jest.Mock).mockClear();
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      await service.handleRequest({
        method: 'hover',
        uri: 'file:///project/root/src/app.ts',
        position: { line: 0, character: 0 },
        content: 'const x = 1;\n'
      });

      expect(ts.createLanguageService).toHaveBeenCalled();
    });
  });

  describe('updateFile', () => {
    beforeEach(() => {
      service.initialize();
    });

    it('should update file content and version', () => {
      const content = 'export const updated = true;\n';

      service.updateFile('file:///project/root/src/app.ts', content);

      const call = (ts.createLanguageService as jest.Mock).mock.calls[0];
      const host = call[0];
      const snapshot = host.getScriptSnapshot('/project/root/src/app.ts');
      expect(snapshot).toBeDefined();
      expect(snapshot?.getText()).toBe(content);

      const version = host.getScriptVersion('/project/root/src/app.ts');
      expect(version).toBe('1');

      service.updateFile('file:///project/root/src/app.ts', 'new content\n');
      const newVersion = host.getScriptVersion('/project/root/src/app.ts');
      expect(newVersion).toBe('2');
    });
  });

  describe('cleanup', () => {
    it('should clear all caches and references', () => {
      service.initialize();
      service.updateFile('file:///src/test.ts', 'content\n');

      service.cleanup();

      expect(mockLogger.info).toHaveBeenCalledWith('LSP: Service cleaned up');

      (ts.createLanguageService as jest.Mock).mockClear();
      service.initialize();
      expect(ts.createLanguageService).toHaveBeenCalled();
    });
  });

  describe('URI and position helpers', () => {
    beforeEach(() => {
      service.initialize();
    });

    it('should correctly convert URIs to file names', async () => {
      const testContent = 'content\n';

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(testContent);

      mockLanguageService.getSyntacticDiagnostics.mockReturnValue([]);
      mockLanguageService.getSemanticDiagnostics.mockReturnValue([]);
      mockLanguageService.getQuickInfoAtPosition.mockReturnValue(undefined);

      await service.handleRequest({
        method: 'hover',
        uri: 'file:///project/root/src/app.ts',
        position: { line: 0, character: 0 },
        content: testContent
      });

      expect(mockLanguageService.getQuickInfoAtPosition).toHaveBeenCalledWith(
        '/project/root/src/app.ts',
        expect.any(Number)
      );
    });

    it('should correctly convert positions to offsets', async () => {
      const content = 'line1\nline2\nline3';

      service.updateFile('file:///project/root/test.ts', content);

      mockLanguageService.getCompletionsAtPosition.mockReturnValue(undefined);

      await service.handleRequest({
        method: 'completion',
        uri: 'file:///project/root/test.ts',
        position: { line: 2, character: 3 }
      });

      expect(mockLanguageService.getCompletionsAtPosition).toHaveBeenCalledWith(
        '/project/root/test.ts',
        15,
        {
          includeCompletionsForModuleExports: true,
          includeCompletionsWithInsertText: true,
          includeAutomaticOptionalChainCompletions: true,
          includeCompletionsForImportStatements: true,
          includeCompletionsWithClassMemberSnippets: true,
          includeCompletionsWithObjectLiteralMethodSnippets: true
        }
      );
    });
  });
});