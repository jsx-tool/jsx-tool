import 'reflect-metadata';
import { injectable, singleton, inject } from 'tsyringe';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { resolve, join, relative, extname } from 'path';
import * as path from 'path';
import { ConfigService } from './config.service';

export interface FileInfo {
  name: string
  path: string
  isDirectory: boolean
  size: number
  modifiedTime: Date
}

export interface ReadFileResult {
  success: boolean
  data?: string
  error?: string
}

export interface WriteFileResult {
  success: boolean
  error?: string
}

export interface ExistsResult {
  exists: boolean
  isFile?: boolean
  isDirectory?: boolean
}

export interface LsResult {
  success: boolean
  files?: FileInfo[]
  error?: string
}

export interface TreeResult {
  success: boolean
  files?: string[]
  error?: string
}

@singleton()
@injectable()
export class FileSystemApiService {
  private readonly allowedExtensions = new Set([
    '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
    '.json', '.xml', '.html', '.htm',
    '.css', '.scss', '.sass', '.less',
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico',
    '.woff', '.woff2', '.ttf', '.otf', '.eot',
    '.mp4', '.webm', '.ogg', '.mp3', '.wav',
    '.txt', '.md', '.yml', '.yaml',
    '.map', '.d.ts'
  ]);

  constructor (
    @inject(ConfigService) private readonly configService: ConfigService
  ) {}

  private isPathSafe (filePath: string): { safe: boolean, reason?: string } {
    const absolutePath = resolve(filePath);
    const workingDir = this.configService.getConfig().workingDirectory;

    const relativePath = relative(workingDir, absolutePath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      return {
        safe: false,
        reason: `Path must be within working directory: ${workingDir}`
      };
    }

    if (statSync(absolutePath).isDirectory()) {
      return { safe: true };
    }

    const ext = extname(absolutePath).toLowerCase();
    if (!this.allowedExtensions.has(ext)) {
      return {
        safe: false,
        reason: `File type '${ext}' is not allowed. Only web assets are permitted.`
      };
    }

    return { safe: true };
  }

  readFile (filePath: string, encoding: BufferEncoding = 'utf8'): ReadFileResult {
    try {
      const absolutePath = resolve(filePath);

      if (!existsSync(absolutePath)) {
        return {
          success: false,
          error: `File not found: ${absolutePath}`
        };
      }

      if (!statSync(absolutePath).isFile()) {
        return {
          success: false,
          error: `Path is not a file: ${absolutePath}`
        };
      }

      const safetyCheck = this.isPathSafe(absolutePath);
      if (!safetyCheck.safe) {
        return {
          success: false,
          error: safetyCheck.reason
        };
      }

      const data = readFileSync(absolutePath, encoding);
      return {
        success: true,
        data
      };
    } catch (error) {
      return {
        success: false,
        error: `Error reading file: ${(error as Error).message}`
      };
    }
  }

  writeToFile (filePath: string, content: string, encoding: BufferEncoding = 'utf8'): WriteFileResult {
    try {
      const absolutePath = resolve(filePath);

      const safetyCheck = this.isPathSafe(absolutePath);
      if (!safetyCheck.safe) {
        return {
          success: false,
          error: safetyCheck.reason
        };
      }

      writeFileSync(absolutePath, content, encoding);

      return {
        success: true
      };
    } catch (error) {
      return {
        success: false,
        error: `Error writing file: ${(error as Error).message}`
      };
    }
  }

  exists (path: string): ExistsResult {
    try {
      const absolutePath = resolve(path);

      if (!existsSync(absolutePath)) {
        return { exists: false };
      }

      const stats = statSync(absolutePath);
      const isDirectory = stats.isDirectory();

      if (!isDirectory) {
        const safetyCheck = this.isPathSafe(absolutePath);
        if (!safetyCheck.safe) {
          return { exists: false };
        }
      }

      return {
        exists: true,
        isFile: stats.isFile(),
        isDirectory
      };
    } catch (error) {
      return { exists: false };
    }
  }

  ls (dirPath: string, options?: { recursive?: boolean, filesOnly?: boolean, directoriesOnly?: boolean }): LsResult {
    try {
      const absolutePath = resolve(dirPath);

      if (!existsSync(absolutePath)) {
        return {
          success: false,
          error: `Directory not found: ${absolutePath}`
        };
      }

      if (!statSync(absolutePath).isDirectory()) {
        return {
          success: false,
          error: `Path is not a directory: ${absolutePath}`
        };
      }

      const workingDir = this.configService.getConfig().workingDirectory;
      const relativePath = relative(workingDir, absolutePath);
      if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        return {
          success: false,
          error: `Directory must be within working directory: ${workingDir}`
        };
      }

      const files: FileInfo[] = [];

      if (options?.recursive) {
        this.walkDirectory(absolutePath, files, options);
      } else {
        const entries = readdirSync(absolutePath);

        for (const entry of entries) {
          const entryPath = join(absolutePath, entry);
          try {
            const stats = statSync(entryPath);

            if (options?.filesOnly && !stats.isFile()) continue;
            if (options?.directoriesOnly && !stats.isDirectory()) continue;

            if (stats.isFile()) {
              const ext = extname(entry).toLowerCase();
              if (!this.allowedExtensions.has(ext)) continue;
            }

            files.push({
              name: entry,
              path: entryPath,
              isDirectory: stats.isDirectory(),
              size: stats.size,
              modifiedTime: stats.mtime
            });
          } catch (error) {
            continue;
          }
        }
      }

      return {
        success: true,
        files
      };
    } catch (error) {
      return {
        success: false,
        error: `Error listing directory: ${(error as Error).message}`
      };
    }
  }

  tree (dirStr: string): TreeResult {
    try {
      const workingDir = resolve(dirStr);
      const files: string[] = [];

      const packageJsonPath = join(workingDir, 'package.json');
      let installedPackages = new Set<string>();

      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
        const deps = packageJson.dependencies || {};
        const devDeps = packageJson.devDependencies || {};
        installedPackages = new Set([...Object.keys(deps), ...Object.keys(devDeps)]);
      } catch (error) {
        return {
          success: false,
          error: `Could not read package.json: ${(error as Error).message}`
        };
      }

      this.treeWalk(workingDir, files, workingDir, installedPackages);

      files.sort();

      return {
        success: true,
        files
      };
    } catch (error) {
      return {
        success: false,
        error: `Error generating tree: ${(error as Error).message}`
      };
    }
  }

  private treeWalk (
    currentPath: string,
    files: string[],
    rootPath: string,
    installedPackages: Set<string>
  ): void {
    try {
      const entries = readdirSync(currentPath);

      for (const entry of entries) {
        const entryPath = join(currentPath, entry);
        const relativePath = relative(rootPath, entryPath);

        try {
          const stats = statSync(entryPath);

          if (stats.isDirectory()) {
            if (entry === 'node_modules' && currentPath === rootPath) {
              const nodeModulesPath = entryPath;
              for (const packageName of installedPackages) {
                const packagePath = join(nodeModulesPath, packageName);
                if (existsSync(packagePath) && statSync(packagePath).isDirectory()) {
                  this.treeWalk(packagePath, files, rootPath, installedPackages);
                }
              }
            } else if (!relativePath.includes('node_modules')) {
              this.treeWalk(entryPath, files, rootPath, installedPackages);
            } else {
              this.treeWalk(entryPath, files, rootPath, installedPackages);
            }
          } else {
            const ext = extname(entry).toLowerCase();
            if (this.allowedExtensions.has(ext)) {
              files.push(relativePath);
            }
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {

    }
  }

  private walkDirectory (
    dirPath: string,
    files: FileInfo[],
    options?: { filesOnly?: boolean, directoriesOnly?: boolean }
  ): void {
    const entries = readdirSync(dirPath);

    for (const entry of entries) {
      const entryPath = join(dirPath, entry);
      try {
        const stats = statSync(entryPath);

        if (stats.isFile()) {
          const ext = extname(entry).toLowerCase();
          if (!this.allowedExtensions.has(ext)) continue;
        }

        const shouldInclude =
          (!options?.filesOnly || stats.isFile()) &&
          (!options?.directoriesOnly || stats.isDirectory());

        if (shouldInclude) {
          files.push({
            name: entry,
            path: entryPath,
            isDirectory: stats.isDirectory(),
            size: stats.size,
            modifiedTime: stats.mtime
          });
        }

        if (stats.isDirectory()) {
          this.walkDirectory(entryPath, files, options);
        }
      } catch (error) {
        continue;
      }
    }
  }
}
