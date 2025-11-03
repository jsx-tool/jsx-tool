import "reflect-metadata";
import { DiagnosticCheckerService } from '../diagnostic-checker.service';
import { Logger } from '../logger.service';
import { DiagnosticSeverity } from 'vscode-languageserver-types';
import type { Diagnostic } from 'vscode-languageserver-types';
import type { DiagnosticResponse } from '../lsp.service';

describe('DiagnosticCheckerService', () => {
  let service: DiagnosticCheckerService;
  let mockLspService: {
    fileNameToUri: jest.Mock;
    handleRequest: jest.Mock;
  };
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      success: jest.fn()
    } as any;

    mockLspService = {
      fileNameToUri: jest.fn((filePath: string) => `file://${filePath}`),
      handleRequest: jest.fn()
    };

    service = new DiagnosticCheckerService(
      mockLspService as any,
      mockLogger as Logger
    );
  });

  const createMockDiagnostic = (
    severity: DiagnosticSeverity,
    message: string,
    line = 0,
    character = 0
  ): Diagnostic => ({
    severity,
    range: {
      start: { line, character },
      end: { line, character: character + 10 }
    },
    message,
    source: 'TypeScript',
    code: 2304
  });

  describe('checkFiles', () => {
    it('should return empty result for no files', async () => {
      const result = await service.checkFiles([]);

      expect(result).toEqual({
        files: [],
        totalErrors: 0,
        totalWarnings: 0,
        filesWithIssues: 0
      });
    });

    it('should handle files with no diagnostics', async () => {
      mockLspService.handleRequest.mockResolvedValue({
        success: true,
        data: []
      } as DiagnosticResponse);

      const result = await service.checkFiles(['/path/to/file1.ts']);

      expect(result).toEqual({
        files: [{
          filePath: '/path/to/file1.ts',
          uri: 'file:///path/to/file1.ts',
          diagnostics: [],
          hasErrors: false,
          hasWarnings: false,
          errorCount: 0,
          warningCount: 0
        }],
        totalErrors: 0,
        totalWarnings: 0,
        filesWithIssues: 0
      });
    });

    it('should count errors correctly', async () => {
      const mockDiagnostics: Diagnostic[] = [
        createMockDiagnostic(DiagnosticSeverity.Error, 'Type error', 10, 5),
        createMockDiagnostic(DiagnosticSeverity.Error, 'Another error', 15, 0),
        createMockDiagnostic(DiagnosticSeverity.Warning, 'Warning message', 20, 0)
      ];

      mockLspService.handleRequest.mockResolvedValue({
        success: true,
        data: mockDiagnostics
      } as DiagnosticResponse);

      const result = await service.checkFiles(['/path/to/file1.ts']);

      expect(result.totalErrors).toBe(2);
      expect(result.totalWarnings).toBe(1);
      expect(result.filesWithIssues).toBe(1);
      expect(result.files[0].errorCount).toBe(2);
      expect(result.files[0].warningCount).toBe(1);
      expect(result.files[0].hasErrors).toBe(true);
      expect(result.files[0].hasWarnings).toBe(true);
    });

    it('should handle multiple files with mixed diagnostics', async () => {
      const file1Diagnostics: Diagnostic[] = [
        createMockDiagnostic(DiagnosticSeverity.Error, 'Error in file1')
      ];

      const file2Diagnostics: Diagnostic[] = [
        createMockDiagnostic(DiagnosticSeverity.Warning, 'Warning in file2')
      ];

      const file3Diagnostics: Diagnostic[] = [];

      mockLspService.handleRequest
        .mockResolvedValueOnce({
          success: true,
          data: file1Diagnostics
        } as DiagnosticResponse)
        .mockResolvedValueOnce({
          success: true,
          data: file2Diagnostics
        } as DiagnosticResponse)
        .mockResolvedValueOnce({
          success: true,
          data: file3Diagnostics
        } as DiagnosticResponse);

      const result = await service.checkFiles([
        '/path/to/file1.ts',
        '/path/to/file2.ts',
        '/path/to/file3.ts'
      ]);

      expect(result.totalErrors).toBe(1);
      expect(result.totalWarnings).toBe(1);
      expect(result.filesWithIssues).toBe(2);
      expect(result.files).toHaveLength(3);
    });

    it('should handle failed LSP requests gracefully', async () => {
      mockLspService.handleRequest
        .mockResolvedValueOnce({
          success: true,
          data: [createMockDiagnostic(DiagnosticSeverity.Error, 'Error')]
        } as DiagnosticResponse)
        .mockResolvedValueOnce({
          success: false,
          error: 'LSP service unavailable'
        } as DiagnosticResponse);

      const result = await service.checkFiles([
        '/path/to/file1.ts',
        '/path/to/file2.ts'
      ]);

      expect(result.files).toHaveLength(1);
      expect(result.totalErrors).toBe(1);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to get diagnostics')
      );
    });

    it('should handle exceptions during processing', async () => {
      mockLspService.handleRequest
        .mockRejectedValue(new Error('Network error'));

      const result = await service.checkFiles(['/path/to/file1.ts']);

      expect(result.files).toHaveLength(0);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should distinguish between error and warning severity', async () => {
      const mockDiagnostics: Diagnostic[] = [
        createMockDiagnostic(DiagnosticSeverity.Error, 'Error'),
        createMockDiagnostic(DiagnosticSeverity.Warning, 'Warning'),
        createMockDiagnostic(DiagnosticSeverity.Information, 'Info'),
        createMockDiagnostic(DiagnosticSeverity.Hint, 'Hint')
      ];

      mockLspService.handleRequest.mockResolvedValue({
        success: true,
        data: mockDiagnostics
      } as DiagnosticResponse);

      const result = await service.checkFiles(['/path/to/file1.ts']);

      expect(result.totalErrors).toBe(1);
      expect(result.totalWarnings).toBe(1);
      expect(result.files[0].diagnostics).toHaveLength(4);
    });

    it('should handle buffer content instead of disk files', async () => {
      const mockDiagnostics: Diagnostic[] = [
        createMockDiagnostic(DiagnosticSeverity.Error, 'Type error in buffer')
      ];

      mockLspService.handleRequest.mockResolvedValue({
        success: true,
        data: mockDiagnostics
      } as DiagnosticResponse);

      const result = await service.checkFiles([
        {
          filePath: '/path/to/file1.ts',
          buffer: 'const x: number = "string";'
        }
      ]);

      expect(result.files[0].filePath).toBe('/path/to/file1.ts');
      expect(result.totalErrors).toBe(1);
      expect(mockLspService.handleRequest).toHaveBeenCalledWith({
        method: 'diagnostics',
        uri: 'file:///path/to/file1.ts',
        content: 'const x: number = "string";'
      });
    });

    it('should handle mixed string paths and buffer objects', async () => {
      const file1Diagnostics: Diagnostic[] = [
        createMockDiagnostic(DiagnosticSeverity.Error, 'Error in disk file')
      ];

      const file2Diagnostics: Diagnostic[] = [
        createMockDiagnostic(DiagnosticSeverity.Warning, 'Warning in buffer')
      ];

      mockLspService.handleRequest
        .mockResolvedValueOnce({
          success: true,
          data: file1Diagnostics
        } as DiagnosticResponse)
        .mockResolvedValueOnce({
          success: true,
          data: file2Diagnostics
        } as DiagnosticResponse);

      const result = await service.checkFiles([
        '/path/to/disk-file.ts',
        {
          filePath: '/path/to/buffer-file.ts',
          buffer: 'const y = 123;'
        }
      ]);

      expect(result.files).toHaveLength(2);
      expect(result.totalErrors).toBe(1);
      expect(result.totalWarnings).toBe(1);

      expect(mockLspService.handleRequest).toHaveBeenNthCalledWith(1, {
        method: 'diagnostics',
        uri: 'file:///path/to/disk-file.ts',
        content: undefined
      });

      expect(mockLspService.handleRequest).toHaveBeenNthCalledWith(2, {
        method: 'diagnostics',
        uri: 'file:///path/to/buffer-file.ts',
        content: 'const y = 123;'
      });
    });
  });

  describe('checkFilesWithIssues', () => {
    it('should return only files with errors or warnings', async () => {
      mockLspService.handleRequest
        .mockResolvedValueOnce({
          success: true,
          data: [createMockDiagnostic(DiagnosticSeverity.Error, 'Error')]
        } as DiagnosticResponse)
        .mockResolvedValueOnce({
          success: true,
          data: []
        } as DiagnosticResponse)
        .mockResolvedValueOnce({
          success: true,
          data: [createMockDiagnostic(DiagnosticSeverity.Warning, 'Warning')]
        } as DiagnosticResponse);

      const result = await service.checkFilesWithIssues([
        '/path/to/file1.ts',
        '/path/to/file2.ts',
        '/path/to/file3.ts'
      ]);

      expect(result).toHaveLength(2);
      expect(result[0].filePath).toBe('/path/to/file1.ts');
      expect(result[1].filePath).toBe('/path/to/file3.ts');
    });

    it('should return empty array when no files have issues', async () => {
      mockLspService.handleRequest.mockResolvedValue({
        success: true,
        data: []
      } as DiagnosticResponse);

      const result = await service.checkFilesWithIssues(['/path/to/file1.ts']);

      expect(result).toHaveLength(0);
    });

    it('should work with buffer objects', async () => {
      mockLspService.handleRequest
        .mockResolvedValueOnce({
          success: true,
          data: [createMockDiagnostic(DiagnosticSeverity.Error, 'Error')]
        } as DiagnosticResponse)
        .mockResolvedValueOnce({
          success: true,
          data: []
        } as DiagnosticResponse);

      const result = await service.checkFilesWithIssues([
        { filePath: '/path/to/file1.ts', buffer: 'const bad: number = "str";' },
        { filePath: '/path/to/file2.ts', buffer: 'const good = 123;' }
      ]);

      expect(result).toHaveLength(1);
      expect(result[0].filePath).toBe('/path/to/file1.ts');
    });
  });

  describe('checkFilesWithErrors', () => {
    it('should return only files with errors, not warnings', async () => {
      mockLspService.handleRequest
        .mockResolvedValueOnce({
          success: true,
          data: [createMockDiagnostic(DiagnosticSeverity.Error, 'Error')]
        } as DiagnosticResponse)
        .mockResolvedValueOnce({
          success: true,
          data: [createMockDiagnostic(DiagnosticSeverity.Warning, 'Warning')]
        } as DiagnosticResponse)
        .mockResolvedValueOnce({
          success: true,
          data: []
        } as DiagnosticResponse);

      const result = await service.checkFilesWithErrors([
        '/path/to/file1.ts',
        '/path/to/file2.ts',
        '/path/to/file3.ts'
      ]);

      expect(result).toHaveLength(1);
      expect(result[0].filePath).toBe('/path/to/file1.ts');
      expect(result[0].hasErrors).toBe(true);
    });

    it('should work with buffer objects', async () => {
      mockLspService.handleRequest
        .mockResolvedValueOnce({
          success: true,
          data: [createMockDiagnostic(DiagnosticSeverity.Error, 'Error')]
        } as DiagnosticResponse)
        .mockResolvedValueOnce({
          success: true,
          data: [createMockDiagnostic(DiagnosticSeverity.Warning, 'Warning')]
        } as DiagnosticResponse);

      const result = await service.checkFilesWithErrors([
        { filePath: '/path/to/file1.ts', buffer: 'const x: number = "str";' },
        { filePath: '/path/to/file2.ts', buffer: 'const unused = 123;' }
      ]);

      expect(result).toHaveLength(1);
      expect(result[0].filePath).toBe('/path/to/file1.ts');
    });
  });

  describe('hasAnyIssues', () => {
    it('should return true when files have issues', async () => {
      mockLspService.handleRequest.mockResolvedValue({
        success: true,
        data: [createMockDiagnostic(DiagnosticSeverity.Warning, 'Warning')]
      } as DiagnosticResponse);

      const result = await service.hasAnyIssues(['/path/to/file1.ts']);

      expect(result).toBe(true);
    });

    it('should return false when no files have issues', async () => {
      mockLspService.handleRequest.mockResolvedValue({
        success: true,
        data: []
      } as DiagnosticResponse);

      const result = await service.hasAnyIssues(['/path/to/file1.ts']);

      expect(result).toBe(false);
    });

    it('should return false for empty file list', async () => {
      const result = await service.hasAnyIssues([]);

      expect(result).toBe(false);
    });

    it('should work with buffer objects', async () => {
      mockLspService.handleRequest.mockResolvedValue({
        success: true,
        data: [createMockDiagnostic(DiagnosticSeverity.Error, 'Error')]
      } as DiagnosticResponse);

      const result = await service.hasAnyIssues([
        { filePath: '/path/to/file1.ts', buffer: 'bad code' }
      ]);

      expect(result).toBe(true);
    });
  });

  describe('integration scenarios', () => {
    it('should handle real-world TypeScript errors', async () => {
      const mockDiagnostics: Diagnostic[] = [
        {
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: 10, character: 5 },
            end: { line: 10, character: 15 }
          },
          message: "Property 'foo' does not exist on type 'Bar'.",
          source: 'TypeScript',
          code: 2339
        },
        {
          severity: DiagnosticSeverity.Warning,
          range: {
            start: { line: 15, character: 0 },
            end: { line: 15, character: 10 }
          },
          message: "'unused' is declared but its value is never read.",
          source: 'TypeScript',
          code: 6133
        }
      ];

      mockLspService.handleRequest.mockResolvedValue({
        success: true,
        data: mockDiagnostics
      } as DiagnosticResponse);

      const result = await service.checkFiles(['/src/component.tsx']);

      expect(result.files[0].diagnostics).toEqual(mockDiagnostics);
      expect(result.totalErrors).toBe(1);
      expect(result.totalWarnings).toBe(1);
    });

    it('should handle ESLint diagnostics', async () => {
      const mockDiagnostics: Diagnostic[] = [
        {
          severity: DiagnosticSeverity.Warning,
          range: {
            start: { line: 5, character: 0 },
            end: { line: 5, character: 20 }
          },
          message: 'Missing semicolon.',
          source: 'ESLint',
          code: 'semi'
        }
      ];

      mockLspService.handleRequest.mockResolvedValue({
        success: true,
        data: mockDiagnostics
      } as DiagnosticResponse);

      const result = await service.checkFiles(['/src/app.js']);

      expect(result.files[0].diagnostics[0].source).toBe('ESLint');
      expect(result.totalWarnings).toBe(1);
    });

    it('should handle Prettier diagnostics', async () => {
      const mockDiagnostics: Diagnostic[] = [
        {
          severity: DiagnosticSeverity.Information,
          range: {
            start: { line: 0, character: 0 },
            end: { line: 50, character: 0 }
          },
          message: 'Code is not formatted according to Prettier rules.',
          source: 'Prettier',
          code: 'prettier/format'
        }
      ];

      mockLspService.handleRequest.mockResolvedValue({
        success: true,
        data: mockDiagnostics
      } as DiagnosticResponse);

      const result = await service.checkFiles(['/src/styles.css']);

      expect(result.files[0].diagnostics[0].source).toBe('Prettier');
      expect(result.totalErrors).toBe(0);
      expect(result.totalWarnings).toBe(0);
    });

    it('should check unsaved editor content', async () => {
      const unsavedCode = `
        import React from 'react';
        const Component = () => {
          const x: number = "wrong type";
          return <div>{x}</div>;
        };
      `;

      const mockDiagnostics: Diagnostic[] = [
        createMockDiagnostic(DiagnosticSeverity.Error, 'Type string is not assignable to type number', 3, 10)
      ];

      mockLspService.handleRequest.mockResolvedValue({
        success: true,
        data: mockDiagnostics
      } as DiagnosticResponse);

      const result = await service.checkFiles([
        {
          filePath: '/src/UnsavedComponent.tsx',
          buffer: unsavedCode
        }
      ]);

      expect(result.totalErrors).toBe(1);
      expect(mockLspService.handleRequest).toHaveBeenCalledWith({
        method: 'diagnostics',
        uri: 'file:///src/UnsavedComponent.tsx',
        content: unsavedCode
      });
    });
  });

  describe('edge cases', () => {
    it('should handle files with only information diagnostics', async () => {
      const mockDiagnostics: Diagnostic[] = [
        createMockDiagnostic(DiagnosticSeverity.Information, 'Info message')
      ];

      mockLspService.handleRequest.mockResolvedValue({
        success: true,
        data: mockDiagnostics
      } as DiagnosticResponse);

      const result = await service.checkFiles(['/path/to/file1.ts']);

      expect(result.totalErrors).toBe(0);
      expect(result.totalWarnings).toBe(0);
      expect(result.filesWithIssues).toBe(0);
      expect(result.files[0].diagnostics).toHaveLength(1);
    });

    it('should handle very long file paths', async () => {
      const longPath = '/very/long/path/'.repeat(20) + 'file.ts';

      mockLspService.handleRequest.mockResolvedValue({
        success: true,
        data: []
      } as DiagnosticResponse);

      const result = await service.checkFiles([longPath]);

      expect(result.files[0].filePath).toBe(longPath);
      expect(mockLspService.fileNameToUri).toHaveBeenCalledWith(longPath);
    });

    it('should handle large number of diagnostics in single file', async () => {
      const manyDiagnostics: Diagnostic[] = Array.from({ length: 100 }, (_, i) =>
        createMockDiagnostic(
          i % 2 === 0 ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
          `Diagnostic ${i}`,
          i,
          0
        )
      );

      mockLspService.handleRequest.mockResolvedValue({
        success: true,
        data: manyDiagnostics
      } as DiagnosticResponse);

      const result = await service.checkFiles(['/path/to/file1.ts']);

      expect(result.totalErrors).toBe(50);
      expect(result.totalWarnings).toBe(50);
      expect(result.files[0].diagnostics).toHaveLength(100);
    });

    it('should handle empty buffer string', async () => {
      mockLspService.handleRequest.mockResolvedValue({
        success: true,
        data: []
      } as DiagnosticResponse);

      const result = await service.checkFiles([
        { filePath: '/path/to/file.ts', buffer: '' }
      ]);

      expect(result.files[0].filePath).toBe('/path/to/file.ts');
      expect(mockLspService.handleRequest).toHaveBeenCalledWith({
        method: 'diagnostics',
        uri: 'file:///path/to/file.ts',
        content: ''
      });
    });
  });
});