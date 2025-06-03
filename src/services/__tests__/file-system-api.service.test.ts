jest.mock('fs');

jest.mock('path', () => ({
  ...jest.requireActual('path'),
  resolve: jest.fn(),
  relative: jest.fn(),
  join: jest.fn(),
  extname: jest.fn(),
  isAbsolute: jest.fn()
}));

import 'reflect-metadata';
import { container } from 'tsyringe';
import { FileSystemApiService } from '../file-system-api.service';
import { ConfigService } from '../config.service';
import * as fs from 'fs';
import * as path from 'path';

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
      (fs.writeFileSync as jest.Mock).mockImplementation(() => {});

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
      (fs.writeFileSync as jest.Mock).mockImplementation(() => {});

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
    beforeEach(() => {
      const pathMock = path as jest.Mocked<typeof path>;
      pathMock.join.mockImplementation((...args) => args.join('/'));
      pathMock.relative.mockImplementation((from, to) => {
        if (to.startsWith(from + '/')) {
          return to.slice(from.length + 1);
        }
        return to;
      });
      pathMock.extname.mockImplementation((p) => {
        const parts = p.split('.');
        return parts.length > 1 ? `.${parts[parts.length - 1]}` : '';
      });
    });

    it('should generate tree of all allowed files', () => {
      const packageJson = {
        dependencies: { react: '^18.0.0' },
        devDependencies: { typescript: '^5.0.0' },
      };

      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(packageJson));
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      (fs.statSync as jest.Mock).mockImplementation((p: string) => ({
        isFile: () => p.includes('.'),
        isDirectory: () => !p.includes('.'),
      }));

      (fs.readdirSync as jest.Mock).mockImplementation((p: string) => {
        switch (p) {
          case '/project/root':
            return ['src', 'package.json', 'node_modules'];

          case '/project/root/src':
            return ['app.tsx', 'index.css'];

          case '/project/root/node_modules':
            return ['react', 'typescript', 'other-package'];

          case '/project/root/node_modules/react':
            return ['index.js', 'package.json'];

          case '/project/root/node_modules/typescript':
            return ['index.d.ts', 'lib'];

          case '/project/root/node_modules/typescript/lib':
            return [];

          default:
            return [];
        }
      });

      const result = service.tree('/project/root');

      expect(result.success).toBe(true);
      expect(result.files).toContain('src/app.tsx');
      expect(result.files).toContain('src/index.css');
      expect(result.files).toContain('package.json');
      expect(result.files).toContain('node_modules/react/index.js');
      expect(result.files).toContain('node_modules/react/package.json');
      expect(result.files).toContain('node_modules/typescript/index.d.ts');
      expect(result.files).not.toContain('node_modules/other-package/index.js');
    });

    it('should skip hidden files and directories', () => {
      const packageJson = { dependencies: {} };
      
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(packageJson));
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockImplementation((p) => ({
        isFile: () => p.includes('.tsx') || p.includes('.git') || p === '/project/root/package.json',
        isDirectory: () => !p.includes('.') && p !== '/project/root/package.json'
      }));
      (fs.readdirSync as jest.Mock).mockReturnValue(['.git', '.env', 'app.tsx', 'package.json']);

      const result = service.tree('/project/root');

      expect(result.success).toBe(true);
      expect(result.files).toContain('app.tsx');
      expect(result.files).toContain('package.json');
      expect(result.files).not.toContain('.git');
      expect(result.files).not.toContain('.env');
    });

    it('should handle missing package.json', () => {
      (fs.readFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('ENOENT: no such file');
      });

      const result = service.tree('/project/root');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Could not read package.json');
    });

    it('should handle read errors gracefully', () => {
      const packageJson = { 
        dependencies: {
          'some-package': '^1.0.0'
        } 
      };
      
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(packageJson));
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      (fs.readdirSync as jest.Mock)
        .mockImplementationOnce(() => {
          throw new Error('Permission denied');
        });

      const result = service.tree('/project/root');

      expect(result.success).toBe(true);
      expect(result.files).toEqual([]);
    });

    it('should handle scoped packages in node_modules', () => {
      const packageJson = {
        dependencies: { 
          '@types/node': '^20.0.0',
          '@babel/core': '^7.0.0'
        }
      };
      
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(packageJson));
      (fs.existsSync as jest.Mock).mockImplementation((p) => {
        return p === '/project/root/node_modules/@types/node' || 
               p === '/project/root/node_modules/@babel/core';
      });
      (fs.statSync as jest.Mock).mockImplementation((p) => ({
        isFile: () => p.includes('.'),
        isDirectory: () => !p.includes('.')
      }));
      
      (fs.readdirSync as jest.Mock)
        .mockReturnValueOnce(['node_modules', 'package.json'])
        .mockReturnValueOnce(['index.d.ts'])
        .mockReturnValueOnce(['index.js']);

      const result = service.tree('/project/root');

      expect(result.success).toBe(true);
      expect(fs.existsSync).toHaveBeenCalledWith('/project/root/node_modules/@types/node');
      expect(fs.existsSync).toHaveBeenCalledWith('/project/root/node_modules/@babel/core');
    });

    it('should return sorted file list', () => {
      const packageJson = { dependencies: {} };
      
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(packageJson));
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockImplementation((p) => ({
        isFile: () => p.includes('.'),
        isDirectory: () => !p.includes('.')
      }));
      (fs.readdirSync as jest.Mock).mockReturnValue(['z.ts', 'a.ts', 'm.ts']);

      const result = service.tree('/project/root');

      expect(result.success).toBe(true);
      expect(result.files).toEqual(['a.ts', 'm.ts', 'z.ts']);
    });
  });
});