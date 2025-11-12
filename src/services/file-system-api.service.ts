import 'reflect-metadata';
import { injectable, singleton, inject } from 'tsyringe';
import type { FSWatcher, Stats } from 'fs';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, watch, mkdirSync, unlinkSync, copyFileSync, renameSync, rmdirSync } from 'fs';
import { resolve, join, relative, extname, dirname } from 'path';
import * as path from 'path';
import { ConfigService } from './config.service';
import { execSync } from 'child_process';

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

export interface GitFileStatus {
  absolutePath: string
  staged: boolean
  status: string // e.g., 'M' (modified), 'A' (added), 'D' (deleted), 'R' (renamed), '??' (untracked)
}

export interface GitStatusResult {
  isGitRepo: boolean
  statusInfo: {
    branch: string | null
    headCommit: string | null
    headCommitMessage: string | null
    files: GitFileStatus[]
  } | null
  error?: string
}

export interface FileChangeEvent {
  type: 'added' | 'removed' | 'changed'
  absolutePath: string
}

export interface MoveItemsArgs {
  sourcePaths: string[]
  targetDirectory: string
}

export interface MoveItemsResult {
  success: boolean
  movedPaths?: Array<{ from: string, to: string }>
  errors?: string[]
}

export interface CopyToClipboardArgs {
  paths: string[]
}

export interface CopyToClipboardResult {
  success: boolean
  error?: string
}

export interface ImportItemsArgs {
  sourcePaths: string[]
  targetDirectory: string
}

export interface ImportItemsResult {
  success: boolean
  importedPaths?: string[]
  errors?: string[]
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
    '.map', '.d.ts', '.md',
    '.gitignore', '.env', '.prettierrc', '.eslintrc',
    '.babelrc', '.npmrc', '.editorconfig'
  ]);

  private readonly watchers: FSWatcher[] = [];
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();
  private readonly fileChangeListener: Array<(changes: FileChangeEvent[]) => void> = [];

  constructor (
    @inject(ConfigService) private readonly configService: ConfigService
  ) {
  }

  setListener (listener: (changes: FileChangeEvent[]) => void): void {
    this.fileChangeListener.push(listener);
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
    const pendingChanges = new Map<string, FileChangeEvent>();
    let debounceTimer: NodeJS.Timeout | null = null;

    for (const root of this.dedupeRoots(cwd, roots, additionalDirectories)) {
      if (!existsSync(root)) {
        continue;
      }

      const w = watch(root, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        const absolutePath = join(root, filename);
        const fileExists = existsSync(absolutePath);

        if (eventType === 'rename') {
          if (fileExists) {
            pendingChanges.set(absolutePath, { type: 'added', absolutePath });
          } else {
            pendingChanges.set(absolutePath, { type: 'removed', absolutePath });
          }
        } else if (eventType === 'change' && fileExists) {
          pendingChanges.set(absolutePath, { type: 'changed', absolutePath });
        }

        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          const changes = Array.from(pendingChanges.values());
          if (changes.length > 0) {
            this.fileChangeListener.forEach(listener => { listener(changes); });
            pendingChanges.clear();
          }
          debounceTimer = null;
        }, 100);
      });

      w.on('error', (error: NodeJS.ErrnoException) => {
        console.error(`File watcher error for ${root}:`, error.message);
        w.close();
        const index = this.watchers.indexOf(w);
        if (index > -1) {
          this.watchers.splice(index, 1);
        }
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

  public isPathSafe (
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
    const fileName = absolutePath.split(path.sep).pop() || '';
    const isDotFile = fileName.startsWith('.');

    if (!this.allowedExtensions.has(ext) && !isDotFile) {
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
            const isDotFile = entry.startsWith('.');

            if (this.allowedExtensions.has(ext) || isDotFile) {
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

  public gitStatus (): GitStatusResult {
    try {
      const config = this.configService.getConfig();
      const workingDir = config.workingDirectory;
      const additionalDirs = (config.additionalDirectories ?? []).map(dir =>
        resolve(workingDir, dir)
      );
      const allRoots = [workingDir, ...additionalDirs];

      try {
        execSync('git --version', {
          stdio: 'pipe',
          windowsHide: true
        });
      } catch {
        return {
          isGitRepo: false,
          statusInfo: null,
          error: 'Git is not installed or not in PATH'
        };
      }

      let gitRoot: string;
      try {
        gitRoot = execSync('git rev-parse --show-toplevel', {
          cwd: workingDir,
          encoding: 'utf8',
          stdio: 'pipe',
          windowsHide: true
        }).trim();
      } catch {
        return {
          isGitRepo: false,
          statusInfo: null
        };
      }

      let branch: string | null = null;
      try {
        branch = execSync('git rev-parse --abbrev-ref HEAD', {
          cwd: workingDir,
          encoding: 'utf8',
          stdio: 'pipe',
          windowsHide: true
        }).trim();
      } catch {
        branch = null;
      }

      let headCommit: string | null = null;
      try {
        headCommit = execSync('git rev-parse HEAD', {
          cwd: workingDir,
          encoding: 'utf8',
          stdio: 'pipe',
          windowsHide: true
        }).trim();
      } catch {
        headCommit = null;
      }

      let headCommitMessage: string | null = null;
      try {
        headCommitMessage = execSync('git log -1 --pretty=%B', {
          cwd: workingDir,
          encoding: 'utf8',
          stdio: 'pipe',
          windowsHide: true
        }).trim();
      } catch {
        headCommitMessage = null;
      }

      const statusOutput = execSync('git status --porcelain', {
        cwd: workingDir,
        encoding: 'utf8',
        stdio: 'pipe',
        windowsHide: true
      });

      const files: GitFileStatus[] = [];
      const lines = statusOutput.split('\n').filter(line => line.trim());

      for (const line of lines) {
        if (line.length < 4) continue;

        const indexStatus = line[0];
        const workTreeStatus = line[1];
        const filePath = line.substring(3).trim();

        let actualPath = filePath;
        if (filePath.includes(' -> ')) {
          actualPath = filePath.split(' -> ')[1];
        }

        if (actualPath.startsWith('"') && actualPath.endsWith('"')) {
          actualPath = actualPath.slice(1, -1);
        }

        const absolutePath = resolve(gitRoot, actualPath);

        const isInAllowedRoot = allRoots.some(root => {
          const rel = relative(root, absolutePath);
          return !rel.startsWith('..') && !path.isAbsolute(rel);
        });

        if (!isInAllowedRoot) {
          continue;
        }

        const staged = indexStatus !== ' ' && indexStatus !== '?';
        let status: string;
        if (indexStatus === '?' && workTreeStatus === '?') {
          status = '??';
        } else if (staged && workTreeStatus !== ' ') {
          status = `${indexStatus}${workTreeStatus}`;
        } else if (staged) {
          status = indexStatus;
        } else {
          status = workTreeStatus;
        }

        files.push({
          absolutePath,
          staged,
          status
        });
      }

      return {
        isGitRepo: true,
        statusInfo: {
          branch,
          headCommit,
          headCommitMessage,
          files
        }
      };
    } catch (error) {
      return {
        isGitRepo: false,
        statusInfo: null,
        error: `Error reading git status: ${(error as Error).message}`
      };
    }
  }

  moveItems (sourcePaths: string[], targetDirectory: string): MoveItemsResult {
    try {
      const absTarget = resolve(targetDirectory);

      const targetCheck = this.isPathSafe(absTarget);
      if (!targetCheck.safe) {
        return { success: false, errors: targetCheck.reason ? [targetCheck.reason] : [] };
      }

      if (!existsSync(absTarget) || !statSync(absTarget).isDirectory()) {
        return { success: false, errors: ['Target must be an existing directory'] };
      }

      const movedPaths: Array<{ from: string, to: string }> = [];
      const errors: string[] = [];

      for (const sourcePath of sourcePaths) {
        const absSource = resolve(sourcePath);

        if (!existsSync(absSource)) {
          errors.push(`Source not found: ${absSource}`);
          continue;
        }

        const sourceCheck = this.isPathSafe(absSource);
        if (!sourceCheck.safe) {
          errors.push(`Cannot move ${absSource}: ${sourceCheck.reason}`);
          continue;
        }

        const itemName = absSource.split(path.sep).pop()!;
        const targetPath = join(absTarget, itemName);

        if (existsSync(targetPath)) {
          errors.push(`Target already exists: ${targetPath}`);
          continue;
        }

        const targetPathCheck = this.isPathSafe(targetPath);
        if (!targetPathCheck.safe) {
          errors.push(`Cannot move to ${targetPath}: ${targetPathCheck.reason}`);
          continue;
        }

        try {
          renameSync(absSource, targetPath);
          movedPaths.push({ from: absSource, to: targetPath });
        } catch (error) {
          const errorMsg = (error as Error).message;

          if (errorMsg.includes('EXDEV') || errorMsg.includes('cross-device')) {
            try {
              const stats = statSync(absSource);

              if (stats.isDirectory()) {
                this.copyDirectoryRecursive(absSource, targetPath);
                this.removeDirectoryRecursive(absSource);
              } else {
                copyFileSync(absSource, targetPath);
                unlinkSync(absSource);
              }

              movedPaths.push({ from: absSource, to: targetPath });
            } catch (fallbackError) {
              errors.push(`Failed to move ${itemName}: ${(fallbackError as Error).message}`);
            }
          } else {
            errors.push(`Failed to move ${itemName}: ${errorMsg}`);
          }
        }
      }

      return {
        success: errors.length === 0,
        movedPaths: movedPaths.length > 0 ? movedPaths : undefined,
        errors: errors.length > 0 ? errors : undefined
      };
    } catch (error) {
      return {
        success: false,
        errors: [`Move failed: ${(error as Error).message}`]
      };
    }
  }

  moveItemsMany (args: MoveItemsArgs[]): MoveItemsResult[] {
    return args.map(({ sourcePaths, targetDirectory }) =>
      this.moveItems(sourcePaths, targetDirectory)
    );
  }

  private removeDirectoryRecursive (dirPath: string): void {
    if (!existsSync(dirPath)) return;

    const entries = readdirSync(dirPath);

    for (const entry of entries) {
      const entryPath = join(dirPath, entry);
      const stats = statSync(entryPath);

      if (stats.isDirectory()) {
        this.removeDirectoryRecursive(entryPath);
      } else {
        unlinkSync(entryPath);
      }
    }

    rmdirSync(dirPath);
  }

  copyToClipboard (paths: string[]): CopyToClipboardResult {
    try {
      for (const path of paths) {
        const absolutePath = resolve(path);
        if (!existsSync(absolutePath)) {
          return { success: false, error: `Path not found: ${absolutePath}` };
        }

        const check = this.isPathSafe(absolutePath);
        if (!check.safe) {
          return { success: false, error: check.reason };
        }
      }

      const absolutePaths = paths.map(p => resolve(p));

      if (process.platform === 'darwin') {
        this.copyFilesToClipboardMacOS(absolutePaths);
      } else if (process.platform === 'win32') {
        this.copyFilesToClipboardWindows(absolutePaths);
      } else if (process.platform === 'linux') {
        this.copyFilesToClipboardLinux(absolutePaths);
      } else {
        return {
          success: false,
          error: `File clipboard not supported on platform: ${process.platform}`
        };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Error copying to clipboard: ${(error as Error).message}`
      };
    }
  }

  copyToClipboardMany (args: CopyToClipboardArgs[]): CopyToClipboardResult[] {
    return args.map(({ paths }) => this.copyToClipboard(paths));
  }

  private copyFilesToClipboardMacOS (paths: string[]): void {
    const escapedPaths = paths.map(p =>
      p.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    );

    const posixPaths = escapedPaths
      .map(p => `POSIX file "${p}"`)
      .join(', ');

    const script = `set the clipboard to {${posixPaths}}`;

    execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
      stdio: 'pipe',
      windowsHide: true
    });
  }

  private copyFilesToClipboardWindows (paths: string[]): void {
    const escapedPaths = paths.map(p =>
      p.replace(/\\/g, '\\\\').replace(/"/g, '`"')
    );

    const pathList = escapedPaths.map(p => `"${p}"`).join(',');

    const script = `
    Add-Type -AssemblyName System.Windows.Forms
    $files = New-Object System.Collections.Specialized.StringCollection
    @(${pathList}) | ForEach-Object { $files.Add($_) | Out-Null }
    [System.Windows.Forms.Clipboard]::SetFileDropList($files)
  `;

    execSync(`powershell -NoProfile -Command "${script.replace(/"/g, '\\"')}"`, {
      stdio: 'pipe',
      windowsHide: true,
      shell: 'powershell.exe'
    });
  }

  private copyFilesToClipboardLinux (paths: string[]): void {
    const fileUris = paths.map(p => `file://${encodeURI(p)}`).join('\n');

    try {
      execSync('which xclip', { stdio: 'pipe' });

      const script = `printf '%s' '${fileUris.replace(/'/g, "'\\''")}' | xclip -selection clipboard -t text/uri-list`;
      execSync(script, {
        shell: '/bin/bash',
        stdio: 'pipe'
      });
    } catch {
      try {
        execSync('which xsel', { stdio: 'pipe' });

        const script = `printf '%s' '${fileUris.replace(/'/g, "'\\''")}' | xsel --clipboard --input`;
        execSync(script, {
          shell: '/bin/bash',
          stdio: 'pipe'
        });
      } catch {
        throw new Error('xclip or xsel required for clipboard on Linux');
      }
    }
  }

  importItems (sourcePaths: string[], targetDirectory: string): ImportItemsResult {
    try {
      const absTarget = resolve(targetDirectory);

      const targetCheck = this.isPathSafe(absTarget);
      if (!targetCheck.safe) {
        return { success: false, errors: targetCheck.reason ? [targetCheck.reason] : [] };
      }

      if (!existsSync(absTarget) || !statSync(absTarget).isDirectory()) {
        return { success: false, errors: ['Target must be an existing directory'] };
      }

      const importedPaths: string[] = [];
      const errors: string[] = [];

      for (const sourcePath of sourcePaths) {
        const absSource = resolve(sourcePath);

        if (!existsSync(absSource)) {
          errors.push(`Source not found: ${absSource}`);
          continue;
        }

        const stats = statSync(absSource);
        const itemName = absSource.split(path.sep).pop()!;
        const targetPath = join(absTarget, itemName);

        try {
          if (stats.isDirectory()) {
            this.copyDirectoryRecursive(absSource, targetPath);
          } else {
            const ext = extname(itemName).toLowerCase();
            if (!this.allowedExtensions.has(ext) && !itemName.startsWith('.')) {
              errors.push(`File type not allowed: ${itemName}`);
              continue;
            }

            copyFileSync(absSource, targetPath);
          }

          importedPaths.push(targetPath);
        } catch (error) {
          errors.push(`Failed to import ${itemName}: ${(error as Error).message}`);
        }
      }

      return {
        success: errors.length === 0,
        importedPaths,
        errors: errors.length > 0 ? errors : undefined
      };
    } catch (error) {
      return {
        success: false,
        errors: [`Import failed: ${(error as Error).message}`]
      };
    }
  }

  private copyDirectoryRecursive (source: string, target: string): void {
    if (!existsSync(target)) {
      mkdirSync(target, { recursive: true });
    }

    const entries = readdirSync(source);

    for (const entry of entries) {
      const sourcePath = join(source, entry);
      const targetPath = join(target, entry);

      try {
        const stats = statSync(sourcePath);

        if (stats.isDirectory()) {
          this.copyDirectoryRecursive(sourcePath, targetPath);
        } else {
          const ext = extname(entry).toLowerCase();
          if (this.allowedExtensions.has(ext) || entry.startsWith('.')) {
            copyFileSync(sourcePath, targetPath);
          }
        }
      } catch (error) {
        continue;
      }
    }
  }

  public cleanup (): void {
    for (const w of this.watchers) w?.close?.();
    this.watchers.length = 0;
    this.debounceTimers.forEach(t => { clearTimeout(t); });
    this.debounceTimers.clear();
  }
}
