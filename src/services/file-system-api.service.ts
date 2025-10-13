import 'reflect-metadata';
import { injectable, singleton, inject } from 'tsyringe';
import type { FSWatcher, Stats } from 'fs';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, watch, mkdirSync, unlinkSync } from 'fs';
import { resolve, join, relative, extname, dirname } from 'path';
import * as path from 'path';
import { ConfigService } from './config.service';

export interface ProjectInfo {
  projectRoot: string
  files: string[]
  additionalDirRoots: string[]
}

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

export interface ReadFileArgs {
  filePath: string
  encoding?: BufferEncoding
}

export interface WriteFileArgs {
  filePath: string
  content: string
  encoding?: BufferEncoding
}

export interface LsArgs {
  dirPath: string
  options?: { recursive?: boolean, filesOnly?: boolean, directoriesOnly?: boolean }
}

export interface RmResult {
  success: boolean
  error?: string
}

export interface RmArgs {
  path: string
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
    '.map', '.d.ts', '.md'
  ]);

  private readonly watchers: FSWatcher[] = [];
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();
  private readonly fileChangeListener: Array<() => void> = [];

  setListener (listener: () => void): void {
    this.fileChangeListener.push(listener);
  }

  constructor (
    @inject(ConfigService) private readonly configService: ConfigService
  ) {
  }

  public startFileWatchers () {
    this.watchDirs(
      this.configService.getConfig().workingDirectory,
      [
        this.configService.getConfig().workingDirectory
      ],
      (this.configService.getConfig()?.additionalDirectories ?? [])
    );
  }

  private watchDirs (cwd: string, roots: string[], additionalDirectories: string[]): void {
    for (const root of this.dedupeRoots(cwd, roots, additionalDirectories)) {
      const w = watch(root, { recursive: true }, () => {
        const existing = this.debounceTimers.get(root);
        if (existing) clearTimeout(existing);

        const t = setTimeout(() => {
          this.fileChangeListener.forEach(listener => { listener(); });
          this.debounceTimers.delete(root);
        }, 100);

        this.debounceTimers.set(root, t);
      });

      this.watchers.push(w);
    }
  }

  public projectInfo (): ProjectInfo {
    const config = this.configService.getConfig();
    const additionalDirs = config.additionalDirectories ?? [];

    const mainFiles = this.tree(config.workingDirectory).files ?? [];
    const additionalFiles = additionalDirs.flatMap(dir => {
      const resolvedDir = resolve(config.workingDirectory, dir);
      return this.tree(resolvedDir).files ?? [];
    });

    return {
      projectRoot: config.workingDirectory,
      files: [...mainFiles, ...additionalFiles],
      additionalDirRoots: additionalDirs.map((dir) => resolve(config.workingDirectory, dir))
    };
  }

  private isPathSafe (
    filePath: string,
    stats?: Stats
  ): { safe: boolean, reason?: string } {
    const absolutePath = resolve(filePath);
    const config = this.configService.getConfig();
    const workingDir = config.workingDirectory;
    const nodeModulesDir = config.nodeModulesDir ? resolve(config.nodeModulesDir) : null;
    const additionalDirs = (config.additionalDirectories ?? []).map(dir => resolve(workingDir, dir));

    const relativeToWorking = relative(workingDir, absolutePath);
    const isInWorkingDir = !relativeToWorking.startsWith('..') && !path.isAbsolute(relativeToWorking);

    let isInNodeModulesDir = false;
    if (nodeModulesDir) {
      const relativeToNodeModules = relative(nodeModulesDir, absolutePath);
      isInNodeModulesDir = !relativeToNodeModules.startsWith('..') && !path.isAbsolute(relativeToNodeModules);
    }

    let isInAdditionalDir = false;
    for (const additionalDir of additionalDirs) {
      const relativeToAdditional = relative(additionalDir, absolutePath);
      if (!relativeToAdditional.startsWith('..') && !path.isAbsolute(relativeToAdditional)) {
        isInAdditionalDir = true;
        break;
      }
    }

    if (!isInWorkingDir && !isInNodeModulesDir && !isInAdditionalDir) {
      return {
        safe: false,
        reason: `Path must be within working directory or additional directories: ${workingDir}`
      };
    }

    if (stats ? stats.isDirectory() : (existsSync(absolutePath) && statSync(absolutePath).isDirectory())) {
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

      const stats = statSync(absolutePath);
      if (!stats.isFile()) {
        return { success: false, error: `Path is not a file: ${absolutePath}` };
      }

      const safe = this.isPathSafe(absolutePath, stats);
      if (!safe.safe) {
        return { success: false, error: safe.reason };
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

  readFileMany (args: ReadFileArgs[]): ReadFileResult[] {
    return args.map(({ filePath, encoding = 'utf8' }) =>
      this.readFile(filePath, encoding)
    );
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

      const dir = dirname(absolutePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
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

  writeToFileMany (args: WriteFileArgs[]): WriteFileResult[] {
    return args.map(({ filePath, content, encoding = 'utf8' }) =>
      this.writeToFile(filePath, content, encoding)
    );
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
        const safe = this.isPathSafe(absolutePath, stats);
        if (!safe.safe) return { exists: false };
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

  existsMany (paths: string[]): ExistsResult[] {
    return paths.map(path => this.exists(path));
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

      const config = this.configService.getConfig();
      const workingDir = config.workingDirectory;
      const nodeModulesDir = config.nodeModulesDir ? resolve(config.nodeModulesDir) : null;

      const relativeToWorking = relative(workingDir, absolutePath);
      const isInWorkingDir = !relativeToWorking.startsWith('..') && !path.isAbsolute(relativeToWorking);

      let isInNodeModulesDir = false;
      if (nodeModulesDir) {
        const relativeToNodeModules = relative(nodeModulesDir, absolutePath);
        isInNodeModulesDir = !relativeToNodeModules.startsWith('..') && !path.isAbsolute(relativeToNodeModules);
      }

      if (!isInWorkingDir && !isInNodeModulesDir) {
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

  lsMany (args: LsArgs[]): LsResult[] {
    return args.map(({ dirPath, options }) => this.ls(dirPath, options));
  }

  rm (filePath: string): RmResult {
    try {
      const absolutePath = resolve(filePath);

      if (!existsSync(absolutePath)) {
        return {
          success: false,
          error: `File not found: ${absolutePath}`
        };
      }

      const stats = statSync(absolutePath);
      if (!stats.isFile()) {
        return {
          success: false,
          error: `Path is not a file: ${absolutePath}`
        };
      }

      const safetyCheck = this.isPathSafe(absolutePath, stats);
      if (!safetyCheck.safe) {
        return {
          success: false,
          error: safetyCheck.reason
        };
      }

      unlinkSync(absolutePath);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Error removing file: ${(error as Error).message}`
      };
    }
  }

  rmMany (args: RmArgs[]): RmResult[] {
    return args.map(({ path }) => this.rm(path));
  }

  tree (dirStr: string): TreeResult {
    try {
      const workingDir = resolve(dirStr);
      const config = this.configService.getConfig();
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

      const nodeModulesBase = config.nodeModulesDir ? resolve(config.nodeModulesDir) : workingDir;

      this.treeWalk(workingDir, files, workingDir, installedPackages, nodeModulesBase);
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

  treeMany (dirPaths: string[]): TreeResult[] {
    return dirPaths.map(dirPath => this.tree(dirPath));
  }

  private treeWalk (
    currentPath: string,
    files: string[],
    rootPath: string,
    installedPackages: Set<string>,
    nodeModulesBase?: string
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
                  this.addPackageMainFiles(packagePath, files);
                }
              }

              if (nodeModulesBase && nodeModulesBase !== rootPath) {
                const alternateNodeModules = join(nodeModulesBase, 'node_modules');
                if (existsSync(alternateNodeModules)) {
                  for (const packageName of installedPackages) {
                    const packagePath = join(alternateNodeModules, packageName);
                    if (existsSync(packagePath) && statSync(packagePath).isDirectory()) {
                      this.addPackageMainFiles(packagePath, files);
                    }
                  }
                }
              }
            } else if (!relativePath.includes('node_modules')) {
              this.treeWalk(entryPath, files, rootPath, installedPackages, nodeModulesBase);
            }
          } else {
            const ext = extname(entry).toLowerCase();
            if (this.allowedExtensions.has(ext)) {
              files.push(entryPath);
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

  private addPackageMainFiles (packagePath: string, files: string[]): void {
    try {
      const packageJsonPath = join(packagePath, 'package.json');
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

      files.push(packageJsonPath);

      const mainFields = ['main', 'module', 'browser', 'types', 'typings'];
      const addedFiles = new Set<string>();

      for (const field of mainFields) {
        if (packageJson[field]) {
          const filePath = join(packagePath, packageJson[field]);
          if (existsSync(filePath) && !addedFiles.has(filePath)) {
            files.push(filePath);
            addedFiles.add(filePath);
          }
        }
      }

      if (packageJson.exports) {
        this.addExportedFiles(packageJson.exports, packagePath, files, addedFiles);
      }

      if (addedFiles.size === 0) {
        const commonDefaults = ['index.js', 'index.d.ts', 'index.mjs', 'index.cjs'];
        for (const defaultFile of commonDefaults) {
          const filePath = join(packagePath, defaultFile);
          if (existsSync(filePath)) {
            files.push(filePath);
            break;
          }
        }
      }
      const readmePath = join(packagePath, 'README.md');
      if (existsSync(readmePath)) {
        files.push(readmePath);
      }
    } catch (error) {
      files.push(packagePath);
    }
  }

  private addExportedFiles (
    exports: any,
    packagePath: string,
    files: string[],
    addedFiles: Set<string>
  ): void {
    if (typeof exports === 'string') {
      const filePath = join(packagePath, exports);
      if (existsSync(filePath) && !addedFiles.has(filePath)) {
        files.push(filePath);
        addedFiles.add(filePath);
      }
    } else if (typeof exports === 'object' && exports !== null) {
      for (const value of Object.values(exports)) {
        this.addExportedFiles(value, packagePath, files, addedFiles);
      }
    }
  }

  private dedupeRoots (cwd: string, rawRoots: string[], additionalDirectories: string[]): string[] {
    const roots = [...rawRoots, ...additionalDirectories.map(addDir => resolve(cwd, addDir))]
      .map(r => resolve(r))
      .sort((a, b) => a.localeCompare(b));

    const result: string[] = [];
    for (const r of roots) {
      if (!result.some(top => r.startsWith(top + path.sep))) {
        result.push(r);
      }
    }
    return result;
  }

  public cleanup (): void {
    for (const w of this.watchers) w?.close?.();
    this.watchers.length = 0;
    this.debounceTimers.forEach(t => { clearTimeout(t); });
    this.debounceTimers.clear();
  }
}
