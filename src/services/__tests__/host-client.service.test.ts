import 'reflect-metadata';
import { container } from 'tsyringe';
import { HostClientService } from '../host-client.service';
import { Logger } from '../logger.service';
import { LocalKeyService } from '../local-key.service';
import { ConfigService } from '../config.service';
import { FileSystemApiService } from '../file-system-api.service';

describe('HostClientService - Path Translation', () => {
    let service: HostClientService;
    let mockLogger: jest.Mocked<Logger>;
    let mockLocalKeyService: jest.Mocked<LocalKeyService>;
    let mockConfigService: jest.Mocked<ConfigService>;
    let mockFileSystemApi: jest.Mocked<FileSystemApiService>;

    beforeEach(() => {
        container.clearInstances();

        mockLogger = {
            info: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
            debug: jest.fn(),
            success: jest.fn()
        } as any;

        mockLocalKeyService = {
            getPrivateKey: jest.fn(),
            getPublicKey: jest.fn()
        } as any;

        mockConfigService = {
            getConfig: jest.fn().mockReturnValue({
                workingDirectory: '/Users/jamie/jsx-tool/web',
                wsPort: 3000,
                wsHost: 'localhost',
                wsProtocol: 'ws'
            })
        } as any;

        mockFileSystemApi = {
            gitStatus: jest.fn(),
            copyToClipboard: jest.fn(),
            importItems: jest.fn()
        } as any;

        container.registerInstance(Logger, mockLogger);
        container.registerInstance(LocalKeyService, mockLocalKeyService);
        container.registerInstance(ConfigService, mockConfigService);
        container.registerInstance(FileSystemApiService, mockFileSystemApi);

        service = container.resolve(HostClientService);
    });

    describe('translatePathToHost', () => {
        const devServerWorkingDir = '/app/web';
        const hostWorkingDir = '/Users/jamie/jsx-tool/web';

        it('should translate dev server paths to host paths correctly', () => {
            expect(
                (service as any).translatePathToHost(
                    '/app/web/apps/extension/src/apps/devtools/components/file_explorer/FileExplorer.tsx',
                    devServerWorkingDir,
                    hostWorkingDir
                )
            ).toBe('/Users/jamie/jsx-tool/web/apps/extension/src/apps/devtools/components/file_explorer/FileExplorer.tsx');

            expect(
                (service as any).translatePathToHost(
                    '/app/web/package.json',
                    devServerWorkingDir,
                    hostWorkingDir
                )
            ).toBe('/Users/jamie/jsx-tool/web/package.json');

            expect(
                (service as any).translatePathToHost(
                    '/app/web/apps/web/vite.config.ts',
                    devServerWorkingDir,
                    hostWorkingDir
                )
            ).toBe('/Users/jamie/jsx-tool/web/apps/web/vite.config.ts');

            expect(
                (service as any).translatePathToHost(
                    '/app/web/apps/web/.jsxtool/.gitignore',
                    devServerWorkingDir,
                    hostWorkingDir
                )
            ).toBe('/Users/jamie/jsx-tool/web/apps/web/.jsxtool/.gitignore');
        });

        it('should handle paths outside the working directory', () => {
            expect(
                (service as any).translatePathToHost(
                    '/etc/passwd',
                    devServerWorkingDir,
                    hostWorkingDir
                )
            ).toBe('/etc/passwd');

            expect(
                (service as any).translatePathToHost(
                    '/app/other/file.txt',
                    devServerWorkingDir,
                    hostWorkingDir
                )
            ).toBe('/app/other/file.txt');
        });

        it('should handle edge cases', () => {
            expect(
                (service as any).translatePathToHost(
                    '/app/web',
                    devServerWorkingDir,
                    hostWorkingDir
                )
            ).toBe('/Users/jamie/jsx-tool/web');

            expect(
                (service as any).translatePathToHost(
                    '/app/web/README.md',
                    devServerWorkingDir,
                    hostWorkingDir
                )
            ).toBe('/Users/jamie/jsx-tool/web/README.md');

            expect(
                (service as any).translatePathToHost(
                    '/app/web/a/b/c/d/e/f/file.ts',
                    devServerWorkingDir,
                    hostWorkingDir
                )
            ).toBe('/Users/jamie/jsx-tool/web/a/b/c/d/e/f/file.ts');
        });
    });

    describe('translatePathToDevServer', () => {
        const devServerWorkingDir = '/app/web';
        const hostWorkingDir = '/Users/jamie/jsx-tool/web';

        it('should translate host paths to dev server paths correctly', () => {
            expect(
                (service as any).translatePathToDevServer(
                    '/Users/jamie/jsx-tool/web/apps/extension/src/apps/devtools/components/file_explorer/FileExplorer.tsx',
                    devServerWorkingDir,
                    hostWorkingDir
                )
            ).toBe('/app/web/apps/extension/src/apps/devtools/components/file_explorer/FileExplorer.tsx');

            expect(
                (service as any).translatePathToDevServer(
                    '/Users/jamie/jsx-tool/web/package.json',
                    devServerWorkingDir,
                    hostWorkingDir
                )
            ).toBe('/app/web/package.json');

            expect(
                (service as any).translatePathToDevServer(
                    '/Users/jamie/jsx-tool/web/apps/web/vite.config.ts',
                    devServerWorkingDir,
                    hostWorkingDir
                )
            ).toBe('/app/web/apps/web/vite.config.ts');

            expect(
                (service as any).translatePathToDevServer(
                    '/Users/jamie/jsx-tool/web/apps/web/.jsxtool/.gitignore',
                    devServerWorkingDir,
                    hostWorkingDir
                )
            ).toBe('/app/web/apps/web/.jsxtool/.gitignore');
        });

        it('should handle paths outside the working directory', () => {
            expect(
                (service as any).translatePathToDevServer(
                    '/etc/passwd',
                    devServerWorkingDir,
                    hostWorkingDir
                )
            ).toBe('/etc/passwd');

            expect(
                (service as any).translatePathToDevServer(
                    '/Users/jamie/other-project/file.txt',
                    devServerWorkingDir,
                    hostWorkingDir
                )
            ).toBe('/Users/jamie/other-project/file.txt');
        });

        it('should handle edge cases', () => {
            expect(
                (service as any).translatePathToDevServer(
                    '/Users/jamie/jsx-tool/web',
                    devServerWorkingDir,
                    hostWorkingDir
                )
            ).toBe('/app/web');

            expect(
                (service as any).translatePathToDevServer(
                    '/Users/jamie/jsx-tool/web/README.md',
                    devServerWorkingDir,
                    hostWorkingDir
                )
            ).toBe('/app/web/README.md');

            expect(
                (service as any).translatePathToDevServer(
                    '/Users/jamie/jsx-tool/web/a/b/c/d/e/f/file.ts',
                    devServerWorkingDir,
                    hostWorkingDir
                )
            ).toBe('/app/web/a/b/c/d/e/f/file.ts');
        });
    });

    describe('bidirectional translation', () => {
        it('should be reversible', () => {
            const devServerWorkingDir = '/app/web';
            const hostWorkingDir = '/Users/jamie/jsx-tool/web';

            const originalDevPath = '/app/web/apps/extension/src/components/Button.tsx';

            const hostPath = (service as any).translatePathToHost(
                originalDevPath,
                devServerWorkingDir,
                hostWorkingDir
            );

            const backToDevPath = (service as any).translatePathToDevServer(
                hostPath,
                devServerWorkingDir,
                hostWorkingDir
            );

            expect(backToDevPath).toBe(originalDevPath);
        });

        it('should be reversible starting from host path', () => {
            const devServerWorkingDir = '/app/web';
            const hostWorkingDir = '/Users/jamie/jsx-tool/web';

            const originalHostPath = '/Users/jamie/jsx-tool/web/src/utils/helper.ts';

            const devPath = (service as any).translatePathToDevServer(
                originalHostPath,
                devServerWorkingDir,
                hostWorkingDir
            );

            const backToHostPath = (service as any).translatePathToHost(
                devPath,
                devServerWorkingDir,
                hostWorkingDir
            );

            expect(backToHostPath).toBe(originalHostPath);
        });
    });

    describe('real-world git status scenario', () => {
        it('should correctly translate git status file paths', () => {
            const devServerWorkingDir = '/app/web';
            const hostWorkingDir = '/Users/jamie/jsx-tool/web';

            const gitStatusFiles = [
                {
                    absolutePath: '/Users/jamie/jsx-tool/web/apps/extension/src/apps/devtools/components/file_explorer/FileExplorer.tsx',
                    staged: false,
                    status: 'M'
                },
                {
                    absolutePath: '/Users/jamie/jsx-tool/web/apps/extension/src/apps/devtools/components/file_explorer/FileNode.tsx',
                    staged: false,
                    status: 'M'
                },
                {
                    absolutePath: '/Users/jamie/jsx-tool/web/apps/web/package-lock.json',
                    staged: false,
                    status: 'M'
                },
                {
                    absolutePath: '/Users/jamie/jsx-tool/web/apps/web/package.json',
                    staged: false,
                    status: 'M'
                },
                {
                    absolutePath: '/Users/jamie/jsx-tool/web/apps/web/vite.config.ts',
                    staged: false,
                    status: 'M'
                },
                {
                    absolutePath: '/Users/jamie/jsx-tool/web/apps/web/.jsxtool/.gitignore',
                    staged: false,
                    status: '??'
                }
            ];

            const translatedFiles = gitStatusFiles.map(file => ({
                ...file,
                absolutePath: (service as any).translatePathToDevServer(
                    file.absolutePath,
                    devServerWorkingDir,
                    hostWorkingDir
                )
            }));

            expect(translatedFiles[0].absolutePath).toBe('/app/web/apps/extension/src/apps/devtools/components/file_explorer/FileExplorer.tsx');
            expect(translatedFiles[1].absolutePath).toBe('/app/web/apps/extension/src/apps/devtools/components/file_explorer/FileNode.tsx');
            expect(translatedFiles[2].absolutePath).toBe('/app/web/apps/web/package-lock.json');
            expect(translatedFiles[3].absolutePath).toBe('/app/web/apps/web/package.json');
            expect(translatedFiles[4].absolutePath).toBe('/app/web/apps/web/vite.config.ts');
            expect(translatedFiles[5].absolutePath).toBe('/app/web/apps/web/.jsxtool/.gitignore');
        });
    });

    describe('different working directory configurations', () => {
        it('should handle trailing slashes', () => {
            const devServerWorkingDir = '/app/web/';
            const hostWorkingDir = '/Users/jamie/jsx-tool/web/';

            expect(
                (service as any).translatePathToHost(
                    '/app/web/src/app.tsx',
                    devServerWorkingDir,
                    hostWorkingDir
                )
            ).toBe('/Users/jamie/jsx-tool/web/src/app.tsx');
        });

        it('should handle relative parent references in the middle', () => {
            const devServerWorkingDir = '/app/web';
            const hostWorkingDir = '/Users/jamie/jsx-tool/web';

            expect(
                (service as any).translatePathToHost(
                    '/app/web/src/../package.json',
                    devServerWorkingDir,
                    hostWorkingDir
                )
            ).toBe('/Users/jamie/jsx-tool/web/package.json');
        });
    });
});