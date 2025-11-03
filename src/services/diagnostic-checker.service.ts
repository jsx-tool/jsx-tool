import { injectable, inject, singleton } from 'tsyringe';
import { Logger } from './logger.service';
import { LspService } from './lsp.service';
import type { Diagnostic } from 'vscode-languageserver-types';
import { DiagnosticSeverity } from 'vscode-languageserver-types';

export interface FileDiagnostics {
  filePath: string
  uri: string
  diagnostics: Diagnostic[]
  hasErrors: boolean
  hasWarnings: boolean
  errorCount: number
  warningCount: number
}

export interface DiagnosticCheckResult {
  files: FileDiagnostics[]
  totalErrors: number
  totalWarnings: number
  filesWithIssues: number
}

export interface FileCheckRequest {
  filePath: string
  buffer?: string
}

export interface OpenFileInfo {
  filePath: string
  content: string
  languageId?: string
}

@singleton()
@injectable()
export class DiagnosticCheckerService {
  constructor (
    @inject(LspService) private readonly lspService: LspService,
    @inject(Logger) private readonly logger: Logger
  ) { }

  async initializeOpenFiles (files: OpenFileInfo[]): Promise<void> {
    this.logger.info(`Initializing diagnostics for ${files.length} open files...`);

    for (const file of files) {
      const uri = this.lspService.fileNameToUri(file.filePath);
      try {
        await this.lspService.handleJsonRpc({
          jsonrpc: '2.0',
          method: 'textDocument/didOpen',
          params: {
            textDocument: {
              uri,
              languageId: file.languageId || this.inferLanguageId(file.filePath),
              version: 1,
              text: file.content
            }
          }
        });

        this.logger.debug(`Opened file for diagnostics: ${file.filePath}`);
      } catch (error) {
        this.logger.error(
          `Failed to open file ${file.filePath}: ${(error as Error).message}`
        );
      }
    }

    this.logger.info(`Initialized ${files.length} files for diagnostics`);
  }

  private inferLanguageId (filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescriptreact',
      js: 'javascript',
      jsx: 'javascriptreact',
      json: 'json',
      css: 'css',
      scss: 'scss',
      html: 'html',
      md: 'markdown'
    };
    return languageMap[ext || ''] || 'plaintext';
  }

  async checkFiles (files: Array<string | FileCheckRequest>): Promise<DiagnosticCheckResult> {
    const normalizedFiles = files.map(f =>
      typeof f === 'string' ? { filePath: f } : f
    );

    this.logger.info(`Checking ${normalizedFiles.length} files for diagnostics...`);

    const results: FileDiagnostics[] = [];
    let totalErrors = 0;
    let totalWarnings = 0;
    let filesWithIssues = 0;

    for (const file of normalizedFiles) {
      const uri = this.lspService.fileNameToUri(file.filePath);

      try {
        const response = await this.lspService.handleRequest({
          method: 'diagnostics',
          uri,
          content: file.buffer
        });

        if (!response.success) {
          this.logger.warn(`Failed to get diagnostics for ${file.filePath}: ${response.error}`);
          continue;
        }

        const diagnostics = response.data as Diagnostic[];
        const errors = diagnostics.filter(d => d.severity === DiagnosticSeverity.Error);
        const warnings = diagnostics.filter(d => d.severity === DiagnosticSeverity.Warning);

        const errorCount = errors.length;
        const warningCount = warnings.length;

        if (errorCount > 0 || warningCount > 0) {
          filesWithIssues++;
        }

        totalErrors += errorCount;
        totalWarnings += warningCount;

        results.push({
          filePath: file.filePath,
          uri,
          diagnostics,
          hasErrors: errorCount > 0,
          hasWarnings: warningCount > 0,
          errorCount,
          warningCount
        });

        const bufferNote = file.buffer ? ' (buffer)' : '';
        this.logger.debug(
          `${file.filePath}${bufferNote}: ${errorCount} errors, ${warningCount} warnings`
        );
      } catch (error) {
        this.logger.error(
          `Error checking ${file.filePath}: ${(error as Error).message}`
        );
      }
    }

    const summary: DiagnosticCheckResult = {
      files: results,
      totalErrors,
      totalWarnings,
      filesWithIssues
    };

    this.logger.info(
      `Diagnostic check complete: ${filesWithIssues}/${normalizedFiles.length} files with issues ` +
      `(${totalErrors} errors, ${totalWarnings} warnings)`
    );

    return summary;
  }

  async checkFilesWithIssues (files: Array<string | FileCheckRequest>): Promise<FileDiagnostics[]> {
    const result = await this.checkFiles(files);
    return result.files.filter(f => f.hasErrors || f.hasWarnings);
  }

  async checkFilesWithErrors (files: Array<string | FileCheckRequest>): Promise<FileDiagnostics[]> {
    const result = await this.checkFiles(files);
    return result.files.filter(f => f.hasErrors);
  }

  async hasAnyIssues (files: Array<string | FileCheckRequest>): Promise<boolean> {
    const result = await this.checkFiles(files);
    return result.filesWithIssues > 0;
  }
}
