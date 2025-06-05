jest.mock('fs');

jest.mock('path', () => ({
  ...jest.requireActual('path'),
  resolve: jest.fn(),
  relative: jest.fn(),
  join: jest.fn(),
  extname: jest.fn(),
  isAbsolute: jest.fn(),
  watch: jest.fn(() => ({ close: jest.fn() })),
}));

import 'reflect-metadata';
import { container } from 'tsyringe';
import { FileSystemApiService } from '../file-system-api.service';
import { ConfigService } from '../config.service';
import * as fs from 'fs';
import * as path from 'path';

function setupMockFileSystem(files: Record<string, string>) {
  const mockStats = (path: string) => ({
    isFile: () => !path.endsWith('/') && files[path] !== undefined,
    isDirectory: () => path.endsWith('/') || Object.keys(files).some(f => f.startsWith(path + '/')),
    size: files[path]?.length || 0,
    mtime: new Date('2024-01-01T00:00:00.000Z')
  });

  jest.spyOn(require('fs'), 'readFileSync').mockImplementation((path) => {
    const pathStr = (path as fs.PathLike).toString();
    if (files[pathStr]) {
      return files[pathStr];
    }
    throw new Error(`ENOENT: no such file or directory, open '${pathStr}'`);
  });

  jest.spyOn(require('fs'), 'existsSync').mockImplementation((path) => {
    const pathStr = (path as fs.PathLike).toString();
    return files[pathStr] !== undefined ||
      Object.keys(files).some(f => f.startsWith(pathStr + '/'));
  });

  jest.spyOn(require('fs'), 'statSync').mockImplementation((path) => {
    const pathStr = (path as fs.PathLike).toString();
    if (!files[pathStr] && !Object.keys(files).some(f => f.startsWith(pathStr + '/'))) {
      throw new Error(`ENOENT: no such file or directory, stat '${pathStr}'`);
    }
    return mockStats(pathStr);
  });

  jest.spyOn(require('fs'), 'readdirSync').mockImplementation((path) => {
    const pathStr = (path as fs.PathLike).toString();
    const prefix = pathStr.endsWith('/') ? pathStr : pathStr + '/';

    const entries = new Set<string>();
    Object.keys(files).forEach(filePath => {
      if (filePath.startsWith(prefix)) {
        const remainder = filePath.substring(prefix.length);
        const nextSlash = remainder.indexOf('/');
        const entry = nextSlash === -1 ? remainder : remainder.substring(0, nextSlash);
        if (entry) entries.add(entry);
      }
    });

    return Array.from(entries);
  });
}


describe('FileSystemApiService', () => {
  let service: FileSystemApiService;
  let mockConfigService: jest.Mocked<ConfigService>;
  const mockWorkingDir = '/project/root';

  beforeEach(() => {
    container.clearInstances();

    mockConfigService = {
      getConfig: jest.fn().mockReturnValue({ workingDirectory: mockWorkingDir }),
      setWorkingDirectory: jest.fn(),
      loadFromFile: jest.fn(),
      setFromCliOptions: jest.fn(),
      validate: jest.fn()
    } as any;

    container.registerInstance(ConfigService, mockConfigService);
    service = container.resolve(FileSystemApiService);

    jest.clearAllMocks();
  });

  afterAll(() => {
    service.cleanup();
  })

  describe('readFile', () => {
    const mockPath = '/project/root/src/app.tsx';
    const mockContent = 'export const App = () => <div>Hello</div>;';

    beforeEach(() => {
      const pathMock = path as jest.Mocked<typeof path>;
      pathMock.resolve.mockImplementation((p) =>
        p.startsWith('/') ? p : `/project/root/${p}`
      );
      pathMock.relative.mockImplementation((from, to) => {
        if (to.startsWith(from)) {
          return to.slice(from.length + 1);
        }
        return '..' + to;
      });
      pathMock.extname.mockImplementation((p) => {
        const parts = p.split('.');
        return parts.length > 1 ? `.${parts[parts.length - 1]}` : '';
      });
      pathMock.isAbsolute.mockImplementation((p) => p.startsWith('/'));
    });

    it('should read allowed file successfully', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockReturnValue({
        isFile: () => true,
        isDirectory: () => false
      });
      (fs.readFileSync as jest.Mock).mockReturnValue(mockContent);

      const result = service.readFile('src/app.tsx');

      expect(result.success).toBe(true);
      expect(result.data).toBe(mockContent);
      expect(fs.readFileSync).toHaveBeenCalledWith(mockPath, 'utf8');
    });

    it('should fail when file does not exist', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const result = service.readFile('src/missing.tsx');

      expect(result.success).toBe(false);
      expect(result.error).toContain('File not found');
    });

    it('should fail when path is a directory', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockReturnValue({
        isFile: () => false,
        isDirectory: () => true
      });

      const result = service.readFile('src');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Path is not a file');
    });

    it('should fail for disallowed file extensions', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockReturnValue({
        isFile: () => true,
        isDirectory: () => false
      });

      const result = service.readFile('src/app.exe');

      expect(result.success).toBe(false);
      expect(result.error).toContain("File type '.exe' is not allowed");
    });

    it('should fail for paths outside working directory', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockReturnValue({
        isFile: () => true,
        isDirectory: () => false
      });
      (path.relative as jest.Mock).mockReturnValue('../outside/file.js');

      const result = service.readFile('/etc/passwd');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Path must be within working directory');
    });

    it('should handle read errors gracefully', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockReturnValue({
        isFile: () => true,
        isDirectory: () => false
      });
      (fs.readFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const result = service.readFile('src/app.tsx');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Error reading file: Permission denied');
    });

    it('should support different encodings', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockReturnValue({
        isFile: () => true,
        isDirectory: () => false
      });
      (fs.readFileSync as jest.Mock).mockReturnValue(Buffer.from(mockContent));

      const result = service.readFile('src/app.tsx', 'base64');

      expect(result.success).toBe(true);
      expect(fs.readFileSync).toHaveBeenCalledWith(mockPath, 'base64');
    });
  });

  describe('writeToFile', () => {
    const mockContent = 'console.log("Hello World");';

    beforeEach(() => {
      const pathMock = path as jest.Mocked<typeof path>;
      pathMock.resolve.mockImplementation((p) =>
        p.startsWith('/') ? p : `/project/root/${p}`
      );
      pathMock.relative.mockImplementation((from, to) => {
        if (to.startsWith(from)) {
          return to.slice(from.length + 1);
        }
        return '..' + to;
      });
      pathMock.extname.mockImplementation((p) => {
        const parts = p.split('.');
        return parts.length > 1 ? `.${parts[parts.length - 1]}` : '';
      });
      pathMock.isAbsolute.mockImplementation((p) => p.startsWith('/'));

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockReturnValue({
        isFile: () => true,
        isDirectory: () => false
      });
    });

    it('should write to allowed file successfully', () => {
      (fs.writeFileSync as jest.Mock).mockImplementation(() => { });

      const result = service.writeToFile('src/new-file.js', mockContent);

      expect(result.success).toBe(true);
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        '/project/root/src/new-file.js',
        mockContent,
        'utf8'
      );
    });

    it('should fail for disallowed file extensions', () => {
      const result = service.writeToFile('src/malware.exe', mockContent);

      expect(result.success).toBe(false);
      expect(result.error).toContain("File type '.exe' is not allowed");
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should fail for paths outside working directory', () => {
      (path.relative as jest.Mock).mockReturnValue('../../../etc/passwd');

      const result = service.writeToFile('/etc/passwd', mockContent);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Path must be within working directory');
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should handle write errors gracefully', () => {
      (fs.writeFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('Disk full');
      });

      const result = service.writeToFile('src/app.js', mockContent);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Error writing file: Disk full');
    });

    it('should create new files', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      (fs.writeFileSync as jest.Mock).mockImplementation(() => { });

      const result = service.writeToFile('src/new-component.tsx', mockContent);

      expect(result.success).toBe(true);
      expect(fs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe('exists', () => {
    beforeEach(() => {
      const pathMock = path as jest.Mocked<typeof path>;
      pathMock.resolve.mockImplementation((p) =>
        p.startsWith('/') ? p : `/project/root/${p}`
      );
      pathMock.relative.mockImplementation((from, to) => {
        if (to.startsWith(from)) {
          return to.slice(from.length + 1);
        }
        return '..' + to;
      });
      pathMock.extname.mockImplementation((p) => {
        const parts = p.split('.');
        return parts.length > 1 ? `.${parts[parts.length - 1]}` : '';
      });
    });

    it('should return true for existing allowed files', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockReturnValue({
        isFile: () => true,
        isDirectory: () => false
      });

      const result = service.exists('src/app.tsx');

      expect(result.exists).toBe(true);
      expect(result.isFile).toBe(true);
      expect(result.isDirectory).toBe(false);
    });

    it('should return true for directories', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockReturnValue({
        isFile: () => false,
        isDirectory: () => true
      });

      const result = service.exists('src');

      expect(result.exists).toBe(true);
      expect(result.isFile).toBe(false);
      expect(result.isDirectory).toBe(true);
    });

    it('should return false for non-existent paths', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const result = service.exists('src/missing.tsx');

      expect(result.exists).toBe(false);
    });

    it('should return false for disallowed file types', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockReturnValue({
        isFile: () => true,
        isDirectory: () => false
      });

      const result = service.exists('src/binary.exe');

      expect(result.exists).toBe(false);
    });

    it('should handle stat errors gracefully', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const result = service.exists('src/protected.tsx');

      expect(result.exists).toBe(false);
    });
  });

  describe('ls', () => {
    beforeEach(() => {
      const pathMock = path as jest.Mocked<typeof path>;
      pathMock.resolve.mockImplementation((p) =>
        p.startsWith('/') ? p : `/project/root/${p}`
      );
      pathMock.relative.mockImplementation((from, to) => {
        if (to.startsWith(from)) {
          return to.slice(from.length + 1);
        }
        return '..' + to;
      });
      pathMock.extname.mockImplementation((p) => {
        const parts = p.split('.');
        return parts.length > 1 ? `.${parts[parts.length - 1]}` : '';
      });
      pathMock.join.mockImplementation((...args) => args.join('/'));
      pathMock.isAbsolute.mockImplementation((p) => {
        return p.startsWith('/');
      });
    });

    it('should list directory contents', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockImplementation((p) => ({
        isFile: () => !p.endsWith('components'),
        isDirectory: () => p.endsWith('components') || p === '/project/root/src',
        size: 1024,
        mtime: new Date('2024-01-01')
      }));
      (fs.readdirSync as jest.Mock).mockReturnValue(['app.tsx', 'app.css', 'components']);

      const result = service.ls('src');

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(3);
      expect(result.files).toContainEqual(expect.objectContaining({
        name: 'app.tsx',
        isDirectory: false
      }));
    });

    it('should filter files by extension', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockImplementation((p) => ({
        isFile: () => !p.endsWith('/project/root/src'),
        isDirectory: () => p.endsWith('/project/root/src'),
        size: 1024,
        mtime: new Date('2024-01-01')
      }));
      (fs.readdirSync as jest.Mock).mockReturnValue(['app.tsx', 'binary.exe', 'style.css']);

      const result = service.ls('src');

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(2);
      expect(result.files?.map(f => f.name)).toEqual(['app.tsx', 'style.css']);
    });

    it('should support filesOnly option', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockImplementation((p) => ({
        isFile: () => !p.endsWith('components') && p !== '/project/root/src',
        isDirectory: () => p.endsWith('components') || p === '/project/root/src',
        size: 1024,
        mtime: new Date('2024-01-01')
      }));
      (fs.readdirSync as jest.Mock).mockReturnValue(['app.tsx', 'components']);

      const result = service.ls('src', { filesOnly: true });

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(1);
      expect(result.files?.[0].name).toBe('app.tsx');
    });

    it('should support directoriesOnly option', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockImplementation((p) => ({
        isFile: () => !p.endsWith('components') && p !== '/project/root/src',
        isDirectory: () => p.endsWith('components') || p === '/project/root/src',
        size: 0,
        mtime: new Date('2024-01-01')
      }));
      (fs.readdirSync as jest.Mock).mockReturnValue(['app.tsx', 'components']);

      const result = service.ls('src', { directoriesOnly: true });

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(1);
      expect(result.files?.[0].name).toBe('components');
    });

    it('should support recursive listing', () => {
      (fs.readdirSync as jest.Mock)
        .mockReturnValueOnce(['app.tsx', 'components'])
        .mockReturnValueOnce(['Button.tsx']);

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockImplementation((p) => ({
        isFile: () => p.includes('.tsx'),
        isDirectory: () => p.endsWith('components') || p === '/project/root/src',
        size: p.includes('.tsx') ? 1024 : 0,
        mtime: new Date('2024-01-01')
      }));

      const result = service.ls('src', { recursive: true });

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(3);
      expect(fs.readdirSync).toHaveBeenCalledTimes(2);
    });

    it('should fail for non-existent directory', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const result = service.ls('missing');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Directory not found');
    });

    it('should fail when path is not a directory', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockReturnValue({
        isFile: () => true,
        isDirectory: () => false
      });

      const result = service.ls('src/app.tsx');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Path is not a directory');
    });

    it('should fail for paths outside working directory', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockReturnValue({
        isFile: () => false,
        isDirectory: () => true
      });
      (path.relative as jest.Mock).mockReturnValue('../outside');

      const result = service.ls('/etc');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Directory must be within working directory');
    });
  });

  describe('tree', () => {
    it('should generate tree of all allowed files', async () => {
      const mockFiles = {
        '/project/root/package.json': JSON.stringify({
          dependencies: { react: '^18.0.0', typescript: '^4.0.0' },
          devDependencies: {}
        }),
        '/project/root/src/app.tsx': 'export default App',
        '/project/root/src/index.css': 'body { margin: 0; }',
        '/project/root/node_modules/react/package.json': JSON.stringify({
          main: 'index.js'
        }),
        '/project/root/node_modules/react/index.js': 'module.exports = React',
        '/project/root/node_modules/react/README.md': '# React',
        '/project/root/node_modules/typescript/package.json': JSON.stringify({
          main: 'index.js',
          types: 'index.d.ts'
        }),
        '/project/root/node_modules/typescript/index.js': 'module.exports = TypeScript',
        '/project/root/node_modules/typescript/index.d.ts': 'declare module typescript',
        '/project/root/node_modules/typescript/README.md': '# TypeScript'
      };

      setupMockFileSystem(mockFiles);

      const result = service.tree('/project/root');

      expect(result.success).toBe(true);
      expect(result.files).toContain('/project/root/src/app.tsx');
      expect(result.files).toContain('/project/root/src/index.css');
      expect(result.files).toContain('/project/root/package.json');

      expect(result.files).toContain('/project/root/node_modules/react/package.json');
      expect(result.files).toContain('/project/root/node_modules/react/index.js');
      expect(result.files).toContain('/project/root/node_modules/react/README.md');

      expect(result.files).toContain('/project/root/node_modules/typescript/package.json');
      expect(result.files).toContain('/project/root/node_modules/typescript/index.js');
      expect(result.files).toContain('/project/root/node_modules/typescript/index.d.ts');
      expect(result.files).toContain('/project/root/node_modules/typescript/README.md');

      expect(result.files).not.toContain('/project/root/node_modules/other-package/index.js');
    });

    it('should skip hidden files and directories', async () => {
      const mockFiles = {
        '/project/root/package.json': JSON.stringify({ dependencies: {}, devDependencies: {} }),
        '/project/root/app.tsx': 'export default App',
        '/project/root/.git/config': 'git config',
      };

      setupMockFileSystem(mockFiles);

      const result = service.tree('/project/root');

      expect(result.success).toBe(true);
      expect(result.files).toContain('/project/root/app.tsx');
      expect(result.files).toContain('/project/root/package.json');

      expect(result.files).not.toContain('/project/root/.git/config');
    });

    it('should return sorted file list', async () => {
      const mockFiles = {
        '/project/root/package.json': JSON.stringify({ dependencies: {}, devDependencies: {} }),
        '/project/root/z.ts': 'export const z = true',
        '/project/root/a.ts': 'export const a = true',
        '/project/root/m.ts': 'export const m = true'
      };

      setupMockFileSystem(mockFiles);

      const result = service.tree('/project/root');

      expect(result.success).toBe(true);
      const expectedFiles = [
        '/project/root/a.ts',
        '/project/root/m.ts',
        '/project/root/package.json',
        '/project/root/z.ts'
      ];
      expect(result.files).toEqual(expectedFiles);
    });
  });

  describe('Batch Methods', () => {
    beforeEach(() => {
      const pathMock = path as jest.Mocked<typeof path>;
      pathMock.resolve.mockImplementation((p) =>
        p.startsWith('/') ? p : `/project/root/${p}`
      );
      pathMock.relative.mockImplementation((from, to) => {
        if (to.startsWith(from)) {
          return to.slice(from.length + 1);
        }
        return '..' + to;
      });
      pathMock.extname.mockImplementation((p) => {
        const parts = p.split('.');
        return parts.length > 1 ? `.${parts[parts.length - 1]}` : '';
      });
      pathMock.join.mockImplementation((...args) => args.join('/'));
      pathMock.isAbsolute.mockImplementation((p) => p.startsWith('/'));
    });

    describe('readFileMany', () => {
      it('should read multiple files successfully', () => {
        (fs.existsSync as jest.Mock).mockReturnValue(true);
        (fs.statSync as jest.Mock).mockReturnValue({
          isFile: () => true,
          isDirectory: () => false
        });
        (fs.readFileSync as jest.Mock)
          .mockReturnValueOnce('const app = "hello";')
          .mockReturnValueOnce('export const utils = {};');

        const results = service.readFileMany([
          { filePath: 'src/app.ts' },
          { filePath: 'src/utils.ts', encoding: 'utf8' }
        ]);

        expect(results).toHaveLength(2);
        expect(results[0].success).toBe(true);
        expect(results[0].data).toBe('const app = "hello";');
        expect(results[1].success).toBe(true);
        expect(results[1].data).toBe('export const utils = {};');
      });

      it('should handle mixed success and failure results', () => {
        (fs.existsSync as jest.Mock)
          .mockReturnValueOnce(true)
          .mockReturnValueOnce(false);
        (fs.statSync as jest.Mock).mockReturnValue({
          isFile: () => true,
          isDirectory: () => false
        });
        (fs.readFileSync as jest.Mock).mockReturnValue('file content');

        const results = service.readFileMany([
          { filePath: 'src/exists.ts' },
          { filePath: 'src/missing.ts' }
        ]);

        expect(results).toHaveLength(2);
        expect(results[0].success).toBe(true);
        expect(results[1].success).toBe(false);
        expect(results[1].error).toContain('File not found');
      });
    });

    describe('writeToFileMany', () => {
      it('should write to multiple files successfully', () => {
        (fs.writeFileSync as jest.Mock).mockImplementation(() => { });

        const results = service.writeToFileMany([
          { filePath: 'src/new1.ts', content: 'export const one = 1;' },
          { filePath: 'src/new2.js', content: 'console.log("two");', encoding: 'utf8' }
        ]);

        expect(results).toHaveLength(2);
        expect(results[0].success).toBe(true);
        expect(results[1].success).toBe(true);
        expect(fs.writeFileSync).toHaveBeenCalledTimes(2);
        expect(fs.writeFileSync).toHaveBeenCalledWith(
          '/project/root/src/new1.ts',
          'export const one = 1;',
          'utf8'
        );
      });

      it('should handle write failures', () => {
        (fs.writeFileSync as jest.Mock)
          .mockImplementationOnce(() => { })
          .mockImplementationOnce(() => {
            throw new Error('Permission denied');
          });

        const results = service.writeToFileMany([
          { filePath: 'src/success.ts', content: 'success' },
          { filePath: 'src/fail.ts', content: 'fail' }
        ]);

        expect(results).toHaveLength(2);
        expect(results[0].success).toBe(true);
        expect(results[1].success).toBe(false);
        expect(results[1].error).toContain('Permission denied');
      });
    });

    describe('existsMany', () => {
      it('should check existence of multiple paths', () => {
        (fs.existsSync as jest.Mock)
          .mockReturnValueOnce(true)
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(true);
        (fs.statSync as jest.Mock)
          .mockReturnValueOnce({ isFile: () => true, isDirectory: () => false })
          .mockReturnValueOnce({ isFile: () => false, isDirectory: () => true });

        const results = service.existsMany([
          'src/app.ts',
          'src/missing.ts',
          'src/components'
        ]);

        expect(results).toHaveLength(3);
        expect(results[0].exists).toBe(true);
        expect(results[0].isFile).toBe(true);
        expect(results[1].exists).toBe(false);
        expect(results[2].exists).toBe(true);
        expect(results[2].isDirectory).toBe(true);
      });
    });

    describe('lsMany', () => {
      it('should list multiple directories', async () => {
        const mockFiles = {
          '/project/root/src/app.ts': 'export default app',
          '/project/root/src/utils.ts': 'export const utils = true',
          '/project/root/dist/app.ts': 'compiled app',
          '/project/root/dist/utils.ts': 'compiled utils'
        };

        setupMockFileSystem(mockFiles);

        const results = service.lsMany([
          { dirPath: '/project/root/src' },
          { dirPath: '/project/root/dist' }
        ]);

        expect(results).toHaveLength(2);
        expect(results[0].success).toBe(true);
        expect(results[0].files!.length).toBeGreaterThan(0);
        expect(results[1].success).toBe(true);
        expect(results[1].files).toHaveLength(2);
      });
    });

    describe('treeMany', () => {
      it('should generate trees for multiple directories', async () => {
        const mockFiles = {
          '/project/root/package.json': JSON.stringify({ dependencies: {}, devDependencies: {} }),
          '/project/root/app.ts': 'export default app',
          '/project/build/package.json': JSON.stringify({ dependencies: {}, devDependencies: {} }),
          '/project/build/bundle.js': 'bundled code'
        };

        setupMockFileSystem(mockFiles);

        const results = service.treeMany(['/project/root', '/project/build']);

        expect(results).toHaveLength(2);
        expect(results[0].success).toBe(true);
        expect(results[0].files).toContain('/project/root/app.ts');
        expect(results[1].success).toBe(true);
        expect(results[1].files).toContain('/project/build/bundle.js');
      });
    });
  });
});
