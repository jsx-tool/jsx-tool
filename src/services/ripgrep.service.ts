import { injectable, inject, singleton } from 'tsyringe';
import { spawn } from 'child_process';
import { resolve as resolvePath } from 'path';
import { ConfigService } from './config.service';
import { Logger } from './logger.service';
import * as path from 'path';
import * as rg from '@vscode/ripgrep';
import { FileSystemApiService } from './file-system-api.service';

interface RipGrepJsonMatch {
  type: 'match'
  data: {
    path: {
      text: string
    }
    lines: {
      text: string
    }
    line_number: number
    absolute_offset: number
    submatches: Array<{
      match: {
        text: string
      }
      start: number
      end: number
    }>
  }
}

export interface RipGrepMatch {
  absolutePath: string
  lineNumber: number
  columnNumber: number
  line: string
  matchText: string
}

export interface RipGrepSearchOptions {
  caseInsensitive?: boolean
  hidden?: boolean
  followSymlinks?: boolean
  fileTypes?: string[]
  includeGlobs?: string[]
  excludeGlobs?: string[]
  maxResults?: number
  contextBefore?: number
  contextAfter?: number
  regex?: boolean
  wordBoundary?: boolean
  fixedStrings?: boolean
  maxDepth?: number
}

export interface RipGrepSearchResult {
  success: boolean
  matches: RipGrepMatch[]
  error?: string
  truncated?: boolean
}

@singleton()
@injectable()
export class RipGrepService {
  constructor (
    @inject(ConfigService) private readonly configService: ConfigService,
    @inject(FileSystemApiService) private readonly fileSystemApiService: FileSystemApiService,
    @inject(Logger) private readonly logger: Logger
  ) {}

  async search (
    pattern: string,
    options: RipGrepSearchOptions = {}
  ): Promise<RipGrepSearchResult> {
    try {
      if (pattern.includes('..') || path.isAbsolute(pattern)) {
        return {
          success: false,
          matches: [],
          error: 'Search pattern cannot contain path traversal (..) or absolute paths'
        };
      }

      const config = this.configService.getConfig();
      const workingDir = config.workingDirectory;
      const additionalDirs = (config.additionalDirectories ?? []).map(dir =>
        resolvePath(workingDir, dir)
      );
      const searchRoots = [workingDir, ...additionalDirs];

      for (const root of searchRoots) {
        const safetyCheck = this.fileSystemApiService.isPathSafe(root);
        if (!safetyCheck.safe) {
          return {
            success: false,
            matches: [],
            error: safetyCheck.reason
          };
        }
      }

      const matches: RipGrepMatch[] = [];
      let truncated = false;

      for (const root of searchRoots) {
        const rootMatches = await this.searchInDirectory(root, pattern, options);
        matches.push(...rootMatches);

        if (options.maxResults && matches.length >= options.maxResults) {
          truncated = true;
          matches.splice(options.maxResults);
          break;
        }
      }

      return {
        success: true,
        matches,
        truncated
      };
    } catch (error) {
      this.logger.error(`RipGrep search failed: ${(error as Error).message}`);
      return {
        success: false,
        matches: [],
        error: `Search failed: ${(error as Error).message}`
      };
    }
  }

  private async searchInDirectory (
    directory: string,
    pattern: string,
    options: RipGrepSearchOptions
  ): Promise<RipGrepMatch[]> {
    return await new Promise<RipGrepMatch[]>((resolve, reject) => {
      const args = this.buildRipGrepArgs(pattern, options);
      const matches: RipGrepMatch[] = [];

      this.logger.debug(`Running ripgrep in ${directory}: ${args.join(' ')}`);

      const child = spawn(rg.rgPath, args, {
        cwd: directory,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code === 2) {
          reject(new Error(stderr || 'RipGrep encountered an error'));
          return;
        }

        try {
          const lines = stdout.split('\n').filter(line => line.trim());
          for (const line of lines) {
            const parsed = JSON.parse(line) as RipGrepJsonMatch;

            if (parsed.type === 'match') {
              const data = parsed.data;
              const submatches = data.submatches || [];

              for (const submatch of submatches) {
                matches.push({
                  absolutePath: resolvePath(directory, data.path.text),
                  lineNumber: data.line_number,
                  columnNumber: submatch.start + 1,
                  line: data.lines.text.trimEnd(),
                  matchText: submatch.match.text
                });
              }
            }
          }

          resolve(matches);
        } catch (error) {
          reject(new Error(`Failed to parse ripgrep output: ${(error as Error).message}`));
        }
      });

      child.on('error', (error) => {
        reject(new Error(`Failed to spawn ripgrep: ${error.message}`));
      });
    });
  }

  private buildRipGrepArgs (
    pattern: string,
    options: RipGrepSearchOptions
  ): string[] {
    const args: string[] = [
      '--json',
      '--no-heading',
      '--no-messages',
      '--with-filename',
      '--line-number',
      '--column'
    ];

    if (options.caseInsensitive) {
      args.push('--ignore-case');
    }

    if (options.hidden) {
      args.push('--hidden');
    }

    if (options.followSymlinks) {
      args.push('--follow');
    }

    if (options.fixedStrings) {
      args.push('--fixed-strings');
    } else if (!options.regex) {
      args.push('--fixed-strings');
    }

    if (options.wordBoundary) {
      args.push('--word-regexp');
    }

    if (options.contextBefore) {
      args.push('--before-context', options.contextBefore.toString());
    }
    if (options.contextAfter) {
      args.push('--after-context', options.contextAfter.toString());
    }

    if (options.maxDepth !== undefined) {
      args.push('--max-depth', options.maxDepth.toString());
    }

    if (options.fileTypes && options.fileTypes.length > 0) {
      for (const type of options.fileTypes) {
        args.push('--type', type);
      }
    }

    if (options.includeGlobs && options.includeGlobs.length > 0) {
      for (const glob of options.includeGlobs) {
        args.push('--glob', glob);
      }
    }

    if (options.excludeGlobs && options.excludeGlobs.length > 0) {
      for (const glob of options.excludeGlobs) {
        args.push('--glob', `!${glob}`);
      }
    }

    if (options.maxResults) {
      args.push('--max-count', Math.ceil(options.maxResults / 10).toString());
    }

    args.push('--glob', '!node_modules/**');
    args.push('--glob', '!.git/**');

    args.push(pattern);

    return args;
  }

  async getFileTypes (): Promise<string[]> {
    return await new Promise<string[]>((resolve, reject) => {
      const child = spawn(rg.rgPath, ['--type-list'], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error('Failed to get file types'));
          return;
        }

        const types = stdout
          .split('\n')
          .filter(line => line.trim())
          .map(line => line.split(':')[0].trim())
          .filter(Boolean);

        resolve(types);
      });

      child.on('error', (error) => {
        reject(error);
      });
    });
  }
}
