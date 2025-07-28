import "reflect-metadata";
import { KeyFetcher } from '../key-fetcher.service';
import { Logger } from '../logger.service';
import { KeyManager } from '../key-manager.service';
import { DesktopEmitterService } from "../desktop-emitter.service";

global.fetch = jest.fn();

describe('KeyFetcher', () => {
    let keyFetcher: KeyFetcher;
    let mockLogger: jest.Mocked<Logger>;
    let mockKeyManager: jest.Mocked<KeyManager>;
    let mockDesktopEmitterService: jest.Mocked<DesktopEmitterService>;
    let mockFetch: jest.MockedFunction<typeof fetch>;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();

        mockLogger = {
            info: jest.fn(),
            debug: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            success: jest.fn(),
        } as any;

        mockKeyManager = {
            setKey: jest.fn().mockReturnValue(true),
        } as any;
        mockDesktopEmitterService = {
            registerUuid: jest.fn().mockReturnValue(undefined) 
        } as any;

        mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

        keyFetcher = new KeyFetcher(mockLogger, mockKeyManager, mockDesktopEmitterService);
    });

    afterEach(() => {
        keyFetcher.cleanup();
        jest.useRealTimers();
    });

    describe('startFetching', () => {
        it('should start fetching for a new UUID', async () => {
            const uuid = 'test-uuid-123';
            const mockResponse = {
                ok: true,
                status: 200,
                json: jest.fn().mockResolvedValue({
                    publicKey: 'test-public-key',
                    expirationTime: new Date(Date.now() + 3600000).toISOString(),
                }),
            };
            mockFetch.mockResolvedValue(mockResponse as any);

            await keyFetcher.startFetching(uuid);

            expect(mockLogger.info).toHaveBeenCalledWith(`Starting key fetch for UUID: ${uuid}`);
            expect(mockFetch).toHaveBeenCalledWith(
                `https://filemap.ai/api/fetch-key/${uuid}`,
                {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                }
            );
            expect(mockKeyManager.setKey).toHaveBeenCalledWith({
                publicKey: 'test-public-key',
                expirationTime: expect.any(String),
                uuid,
            });
            expect(mockLogger.success).toHaveBeenCalledWith(`Successfully fetched and set key for UUID: ${uuid}`);
        });

        it('should cancel previous fetch when starting new one', async () => {
            const uuid1 = 'uuid-1';
            const uuid2 = 'uuid-2';

            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 500,
                json: jest.fn().mockResolvedValue({}),
            } as any);

            await keyFetcher.startFetching(uuid1);

            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: jest.fn().mockResolvedValue({
                    publicKey: 'key-2',
                    expirationTime: new Date(Date.now() + 3600000).toISOString(),
                }),
            } as any);

            await keyFetcher.startFetching(uuid2);

            expect(mockLogger.debug).toHaveBeenCalledWith(`Canceling fetch for old UUID: ${uuid1}`);
            expect(keyFetcher.getCurrentUuid()).toBe(uuid2);
        });
    });

    describe('retry logic', () => {
        it('should retry when receiving 500', async () => {
            const uuid = 'retry-uuid';
            
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 500,
                json: jest.fn().mockResolvedValue({}),
            } as any);

            await keyFetcher.startFetching(uuid);

            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: jest.fn().mockResolvedValue({
                    publicKey: 'retry-key',
                    expirationTime: new Date(Date.now() + 3600000).toISOString(),
                }),
            } as any);

            jest.advanceTimersByTime(5000);
            await Promise.resolve();

            expect(mockFetch).toHaveBeenCalledTimes(2);
            expect(mockKeyManager.setKey).toHaveBeenCalled();
        });

        it('should retry on network error', async () => {
            const uuid = 'error-uuid';
            
            mockFetch.mockRejectedValueOnce(new Error('Network error'));

            await keyFetcher.startFetching(uuid);

            expect(mockLogger.error).toHaveBeenCalledWith(
                `Failed to fetch key for UUID: ${uuid}: Network error`
            );
            expect(mockLogger.debug).toHaveBeenCalledWith(`Scheduling retry in 5 seconds`);
        });

        it('should stop retrying when UUID changes', async () => {
            const uuid1 = 'uuid-1';
            const uuid2 = 'uuid-2';

            mockFetch.mockRejectedValueOnce(new Error('Network error'));
            await keyFetcher.startFetching(uuid1);

            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: jest.fn().mockResolvedValue({
                    publicKey: 'key-2',
                    expirationTime: new Date(Date.now() + 3600000).toISOString(),
                }),
            } as any);
            await keyFetcher.startFetching(uuid2);

            jest.advanceTimersByTime(5000);
            await Promise.resolve();

            expect(mockFetch).toHaveBeenCalledTimes(2);
        });
    });

    describe('error handling', () => {
        it('should handle non-500 HTTP errors', async () => {
            const uuid = 'error-uuid';
            
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 403,
                json: jest.fn().mockResolvedValue({ error: 'Internal server error' }),
            } as any);

            await keyFetcher.startFetching(uuid);

            expect(mockLogger.error).toHaveBeenCalledWith(
                `Failed to fetch key for UUID: ${uuid}: Internal server error`
            );
        });

        it('should handle expired keys', async () => {
            const uuid = 'expired-uuid';
            
            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: jest.fn().mockResolvedValue({
                    publicKey: 'expired-key',
                    expirationTime: new Date(Date.now() - 3600000).toISOString(),
                }),
            } as any);

            await keyFetcher.startFetching(uuid);

            expect(mockLogger.warn).toHaveBeenCalledWith(
                `Received expired key for UUID: ${uuid}, stopping fetch`
            );
            expect(mockKeyManager.setKey).not.toHaveBeenCalled();
        });

        it('should handle failed key setting', async () => {
            const uuid = 'fail-set-uuid';
            mockKeyManager.setKey.mockReturnValue(false);
            
            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: jest.fn().mockResolvedValue({
                    publicKey: 'test-key',
                    expirationTime: new Date(Date.now() + 3600000).toISOString(),
                }),
            } as any);

            await keyFetcher.startFetching(uuid);

            expect(mockLogger.error).toHaveBeenCalledWith(
                `Failed to set key for UUID: ${uuid}`
            );
        });

        it('should ignore responses for old UUIDs', async () => {
            const uuid1 = 'uuid-1';
            const uuid2 = 'uuid-2';

            let resolveUuid1: any;
            const uuid1Promise = new Promise((resolve) => {
                resolveUuid1 = resolve;
            });

            mockFetch.mockImplementationOnce(() => uuid1Promise as any);

            const fetch1Promise = keyFetcher.startFetching(uuid1);

            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: jest.fn().mockResolvedValue({
                    publicKey: 'key-2',
                    expirationTime: new Date(Date.now() + 3600000).toISOString(),
                }),
            } as any);

            await keyFetcher.startFetching(uuid2);

            resolveUuid1({
                ok: true,
                status: 200,
                json: jest.fn().mockResolvedValue({
                    publicKey: 'key-1',
                    expirationTime: new Date(Date.now() + 3600000).toISOString(),
                }),
            });

            await fetch1Promise;

            expect(mockKeyManager.setKey).toHaveBeenCalledTimes(1);
            expect(mockKeyManager.setKey).toHaveBeenCalledWith(
                expect.objectContaining({ uuid: uuid2 })
            );
            expect(mockLogger.debug).toHaveBeenCalledWith(
                `Ignoring response for old UUID: ${uuid1}`
            );
        });
    });

    describe('cleanup', () => {
        it('should stop fetching and clear timers on cleanup', async () => {
            const uuid = 'cleanup-uuid';
            
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 500,
                json: jest.fn().mockResolvedValue({}),
            } as any);

            await keyFetcher.startFetching(uuid);
            expect(keyFetcher.getCurrentUuid()).toBe(uuid);

            keyFetcher.cleanup();

            expect(keyFetcher.getCurrentUuid()).toBeNull();

            jest.advanceTimersByTime(5000);
            await Promise.resolve();

            expect(mockFetch).toHaveBeenCalledTimes(1);
        });
    });

    describe('getCurrentUuid', () => {
        it('should return null initially', () => {
            expect(keyFetcher.getCurrentUuid()).toBeNull();
        });

        it('should return current UUID when fetching', async () => {
            const uuid = 'current-uuid';
            
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 500,
                json: jest.fn().mockResolvedValue({}),
            } as any);

            await keyFetcher.startFetching(uuid);
            expect(keyFetcher.getCurrentUuid()).toBe(uuid);
        });
    });
});