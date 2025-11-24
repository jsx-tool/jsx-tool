import 'reflect-metadata';
import { container } from 'tsyringe';
import { LocalKeyService } from '../local-key.service';
import { Logger } from '../logger.service';
import { ConfigService } from '../config.service';
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync, unlinkSync } from 'fs';
import { join } from 'path';

jest.mock('fs');

describe('LocalKeyService', () => {
    let service: LocalKeyService;
    let mockLogger: jest.Mocked<Logger>;
    let mockConfig: jest.Mocked<ConfigService>;
    let testWorkingDir: string;

    const getExpectedPaths = (workingDir: string) => ({
        keyDir: join(workingDir, '.jsxtool', 'host-keys'),
        privateKeyPath: join(workingDir, '.jsxtool', 'host-keys', 'private-key.pem'),
        publicKeyPath: join(workingDir, '.jsxtool', 'host-keys', 'public-key.pem'),
        gitignorePath: join(workingDir, '.jsxtool', '.gitignore')
    });

    beforeEach(() => {
        jest.clearAllMocks();
        container.clearInstances();

        testWorkingDir = '/test/working/dir';

        mockLogger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            success: jest.fn(),
            setSilence: jest.fn(),
            setDebug: jest.fn()
        } as any;

        mockConfig = {
            getConfig: jest.fn().mockReturnValue({
                serverPort: 3000,
                serverHost: 'localhost',
                serverProtocol: 'http' as const,
                noProxy: false,
                proxyPort: 4000,
                proxyHost: 'localhost',
                proxyProtocol: 'http' as const,
                wsPort: 12021,
                wsHost: 'localhost',
                wsProtocol: 'ws' as const,
                workingDirectory: testWorkingDir,
                nodeModulesDir: undefined,
                debug: false,
                logging: false,
                injectAt: '</head>'
            }),
            setWorkingDirectory: jest.fn(),
            setNodeModulesDirectory: jest.fn(),
            setFromCliOptions: jest.fn(),
            setFromViteOptions: jest.fn(),
            loadFromFile: jest.fn(),
            getPromptRules: jest.fn(),
            setShouldModifyNextObjectCounter: jest.fn(),
            validate: jest.fn().mockReturnValue({ valid: true, errors: [] }),
            shouldModifyNextObjectCounter: false,
            isViteInstallation: false,
            fullReload: jest.fn(),
            ensureGitIgnore: jest.fn()
        } as any;

        container.registerInstance(Logger, mockLogger);
        container.registerInstance(ConfigService, mockConfig);

        service = container.resolve(LocalKeyService);
    });

    describe('getKeyDir', () => {
        it('should resolve to .jsxtool/host-keys in working directory', () => {
            (existsSync as jest.Mock).mockReturnValue(false);
            (mkdirSync as jest.Mock).mockImplementation(() => { });
            (writeFileSync as jest.Mock).mockImplementation(() => { });

            const paths = service.getKeyPaths();
            const expected = getExpectedPaths(testWorkingDir);

            expect(paths.privateKeyPath).toBe(expected.privateKeyPath);
            expect(paths.publicKeyPath).toBe(expected.publicKeyPath);
        });

        it('should create the directory if it does not exist', () => {
            (existsSync as jest.Mock).mockReturnValue(false);
            (mkdirSync as jest.Mock).mockImplementation(() => { });
            (writeFileSync as jest.Mock).mockImplementation(() => { });

            service.getKeyPaths();
            const expected = getExpectedPaths(testWorkingDir);

            expect(mkdirSync).toHaveBeenCalledWith(
                expected.keyDir,
                { recursive: true }
            );
        });

        it('should call ensureGitIgnore when getting key directory', () => {
            (existsSync as jest.Mock).mockReturnValue(false);
            (mkdirSync as jest.Mock).mockImplementation(() => { });

            service.getKeyPaths();

            expect(mockConfig.ensureGitIgnore).toHaveBeenCalled();
        });

        it('should throw error if working directory is not set', () => {
            mockConfig.getConfig = jest.fn().mockReturnValue({
                serverPort: 3000,
                serverHost: 'localhost',
                serverProtocol: 'http' as const,
                noProxy: false,
                proxyPort: 4000,
                proxyHost: 'localhost',
                proxyProtocol: 'http' as const,
                wsPort: 12021,
                wsHost: 'localhost',
                wsProtocol: 'ws' as const,
                workingDirectory: undefined as any,
                nodeModulesDir: undefined,
                debug: false,
                logging: false,
                injectAt: '</head>'
            });

            expect(() => service.getKeyPaths()).toThrow(
                'Working directory not set. Cannot determine key location.'
            );
        });

        it('should cache the key directory path', () => {
            (existsSync as jest.Mock).mockReturnValue(true);

            service.getKeyPaths();
            service.getKeyPaths();

            expect(mockConfig.getConfig).toHaveBeenCalledTimes(1);
        });
    });

    describe('getPrivateKey', () => {
        it('should return null if private key does not exist', () => {
            (existsSync as jest.Mock).mockReturnValue(false);
            (mkdirSync as jest.Mock).mockImplementation(() => { });
            (writeFileSync as jest.Mock).mockImplementation(() => { });

            const result = service.getPrivateKey();
            const expected = getExpectedPaths(testWorkingDir);

            expect(result).toBeNull();
            expect(mockLogger.warn).toHaveBeenCalledWith(
                `Private key not found at: ${expected.privateKeyPath}`
            );
        });

        it('should read and return private key if it exists', () => {
            const mockPrivateKey = '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----';
            (existsSync as jest.Mock).mockReturnValue(true);
            (readFileSync as jest.Mock).mockReturnValue(mockPrivateKey);

            const result = service.getPrivateKey();
            const expected = getExpectedPaths(testWorkingDir);

            expect(result).toBe(mockPrivateKey);
            expect(readFileSync).toHaveBeenCalledWith(
                expected.privateKeyPath,
                'utf8'
            );
        });

        it('should cache the private key after first read', () => {
            const mockPrivateKey = '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----';
            (existsSync as jest.Mock).mockReturnValue(true);
            (readFileSync as jest.Mock).mockReturnValue(mockPrivateKey);

            service.getPrivateKey();
            service.getPrivateKey();

            expect(readFileSync).toHaveBeenCalledTimes(1);
        });

        it('should handle read errors gracefully', () => {
            (existsSync as jest.Mock).mockReturnValue(true);
            (readFileSync as jest.Mock).mockImplementation(() => {
                throw new Error('Read error');
            });

            const result = service.getPrivateKey();

            expect(result).toBeNull();
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Failed to read private key: Read error'
            );
        });
    });

    describe('getPublicKey', () => {
        it('should return null if public key does not exist', () => {
            (existsSync as jest.Mock).mockReturnValue(false);
            (mkdirSync as jest.Mock).mockImplementation(() => { });
            (writeFileSync as jest.Mock).mockImplementation(() => { });

            const result = service.getPublicKey();
            const expected = getExpectedPaths(testWorkingDir);

            expect(result).toBeNull();
            expect(mockLogger.warn).toHaveBeenCalledWith(
                `Public key not found at: ${expected.publicKeyPath}`
            );
        });

        it('should read and return public key if it exists', () => {
            const mockPublicKey = '-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----';
            (existsSync as jest.Mock).mockReturnValue(true);
            (readFileSync as jest.Mock).mockReturnValue(mockPublicKey);

            const result = service.getPublicKey();
            const expected = getExpectedPaths(testWorkingDir);

            expect(result).toBe(mockPublicKey);
            expect(readFileSync).toHaveBeenCalledWith(
                expected.publicKeyPath,
                'utf8'
            );
        });

        it('should cache the public key after first read', () => {
            const mockPublicKey = '-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----';
            (existsSync as jest.Mock).mockReturnValue(true);
            (readFileSync as jest.Mock).mockReturnValue(mockPublicKey);

            service.getPublicKey();
            service.getPublicKey();

            expect(readFileSync).toHaveBeenCalledTimes(1);
        });
    });

    describe('hasKeys', () => {
        it('should return true if both keys exist', () => {
            (existsSync as jest.Mock).mockReturnValue(true);

            const result = service.hasKeys();

            expect(result).toBe(true);
        });

        it('should return false if keys do not exist', () => {
            (existsSync as jest.Mock).mockReturnValue(false);
            (mkdirSync as jest.Mock).mockImplementation(() => { });
            (writeFileSync as jest.Mock).mockImplementation(() => { });

            const result = service.hasKeys();

            expect(result).toBe(false);
        });

        it('should return false if working directory is not set', () => {
            mockConfig.getConfig = jest.fn().mockReturnValue({
                serverPort: 3000,
                serverHost: 'localhost',
                serverProtocol: 'http' as const,
                noProxy: false,
                proxyPort: 4000,
                proxyHost: 'localhost',
                proxyProtocol: 'http' as const,
                wsPort: 12021,
                wsHost: 'localhost',
                wsProtocol: 'ws' as const,
                workingDirectory: undefined as any,
                nodeModulesDir: undefined,
                debug: false,
                logging: false,
                injectAt: '</head>'
            });

            const result = service.hasKeys();

            expect(result).toBe(false);
        });
    });

    describe('regenerateKeyPair', () => {
        it('should not regenerate if keys exist and force is false', () => {
            (existsSync as jest.Mock).mockReturnValue(true);

            const result = service.regenerateKeyPair(false);

            expect(result).toBe(false);
            expect(mockLogger.warn).toHaveBeenCalledWith(
                'Key pair already exists. Use force=true to overwrite.'
            );
        });

        it('should regenerate keys if force is true', () => {
            (existsSync as jest.Mock).mockReturnValue(true);
            (unlinkSync as jest.Mock).mockImplementation(() => { });
            (writeFileSync as jest.Mock).mockImplementation(() => { });

            const result = service.regenerateKeyPair(true);

            expect(result).toBe(true);
            expect(mockLogger.success).toHaveBeenCalledWith(
                '✓ Key pair generated successfully'
            );
        });

        it('should clear cache after regenerating', () => {
            (existsSync as jest.Mock).mockReturnValue(false);
            (mkdirSync as jest.Mock).mockImplementation(() => { });
            (writeFileSync as jest.Mock).mockImplementation(() => { });

            const clearCacheSpy = jest.spyOn(service, 'clearCache');

            service.regenerateKeyPair(false);

            expect(clearCacheSpy).toHaveBeenCalled();
        });
    });

    describe('getPublicKeyDer', () => {
        it('should convert PEM to DER format', () => {
            const mockPublicKey = '-----BEGIN PUBLIC KEY-----\nABCD1234\n-----END PUBLIC KEY-----';
            (existsSync as jest.Mock).mockReturnValue(true);
            (readFileSync as jest.Mock).mockReturnValue(mockPublicKey);

            const result = service.getPublicKeyDer();

            expect(result).toBe('ABCD1234');
        });

        it('should return null if public key does not exist', () => {
            (existsSync as jest.Mock).mockReturnValue(false);
            (mkdirSync as jest.Mock).mockImplementation(() => { });
            (writeFileSync as jest.Mock).mockImplementation(() => { });

            const result = service.getPublicKeyDer();

            expect(result).toBeNull();
        });
    });

    describe('clearCache', () => {
        it('should clear cached keys', () => {
            const mockPrivateKey = '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----';
            (existsSync as jest.Mock).mockReturnValue(true);
            (readFileSync as jest.Mock).mockReturnValue(mockPrivateKey);

            service.getPrivateKey();
            service.clearCache();
            service.getPrivateKey();

            expect(readFileSync).toHaveBeenCalledTimes(2);
        });
    });
});