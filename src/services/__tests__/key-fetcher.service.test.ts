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
                `https://jsxtool.com/api/fetch-key/${uuid}`,
                expect.objectContaining({
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                })
            );
            expect(mockKeyManager.setKey).toHaveBeenCalledWith({
                publicKey: 'test-public-key',
                expirationTime: expect.any(String),
                uuid,
            });
            expect(mockLogger.success).toHaveBeenCalledWith(`Successfully fetched and set key for UUID: ${uuid}`);
        });

        it('should handle multiple concurrent fetches', async () => {
            const uuid1 = 'uuid-1';
            const uuid2 = 'uuid-2';

            let resolve1: any, resolve2: any;
            const promise1 = new Promise(r => resolve1 = r);
            const promise2 = new Promise(r => resolve2 = r);
            
            mockFetch
                .mockReturnValueOnce(promise1 as any)
                .mockReturnValueOnce(promise2 as any);

            keyFetcher.startFetching(uuid1);
            keyFetcher.startFetching(uuid2);

            await Promise.resolve();

            expect(keyFetcher.getCurrentUuids()).toEqual(expect.arrayContaining([uuid1, uuid2]));
            expect(keyFetcher.getCurrentUuids()).toHaveLength(2);

            resolve1({ ok: false, status: 500, json: () => Promise.resolve({}) });
            resolve2({ ok: false, status: 500, json: () => Promise.resolve({}) });
            await Promise.resolve();
        });

        it('should skip duplicate UUID requests', async () => {
            const uuid = 'duplicate-uuid';

            let resolvePromise: any;
            const pendingPromise = new Promise(r => resolvePromise = r);
            mockFetch.mockReturnValueOnce(pendingPromise as any);

            keyFetcher.startFetching(uuid);
            
            keyFetcher.startFetching(uuid);
            
            await Promise.resolve();

            expect(mockLogger.debug).toHaveBeenCalledWith(
                `Already fetching UUID: ${uuid}, skipping duplicate request`
            );
            expect(mockFetch).toHaveBeenCalledTimes(1);
            expect(keyFetcher.getCurrentUuids()).toEqual([uuid]);

            resolvePromise({ ok: false, status: 500, json: () => Promise.resolve({}) });
            await Promise.resolve();
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

            expect(mockLogger.debug).toHaveBeenCalledWith(
                `Scheduling retry for UUID ${uuid} in 5 seconds`
            );

            const successResponse = {
                ok: true,
                status: 200,
                json: jest.fn().mockResolvedValue({
                    publicKey: 'retry-key',
                    expirationTime: new Date(Date.now() + 3600000).toISOString(),
                }),
            };
            mockFetch.mockResolvedValueOnce(successResponse as any);

            jest.advanceTimersByTime(5000);

            for (let i = 0; i < 5; i++) {
                await Promise.resolve();
            }

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
            expect(mockLogger.debug).toHaveBeenCalledWith(
                `Scheduling retry for UUID ${uuid} in 5 seconds`
            );
        });

        it('should handle independent retries for multiple UUIDs', async () => {
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

            expect(keyFetcher.getCurrentUuids()).toContain(uuid1);
            expect(keyFetcher.getCurrentUuids()).not.toContain(uuid2);

            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: jest.fn().mockResolvedValue({
                    publicKey: 'key-1',
                    expirationTime: new Date(Date.now() + 3600000).toISOString(),
                }),
            } as any);
            
            jest.advanceTimersByTime(5000);
            
            // Flush promises
            for (let i = 0; i < 5; i++) {
                await Promise.resolve();
            }

            expect(mockFetch).toHaveBeenCalledTimes(3);
            expect(keyFetcher.getCurrentUuids()).toEqual([]);
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

        it('should handle aborted fetches', async () => {
            const uuid = 'abort-uuid';

            const abortError = new Error('Aborted');
            abortError.name = 'AbortError';
            
            mockFetch.mockRejectedValueOnce(abortError);

            await keyFetcher.startFetching(uuid);
            
            keyFetcher.cleanup();

            expect(mockLogger.debug).toHaveBeenCalledWith(`Fetch aborted for UUID: ${uuid}`);
            expect(mockLogger.error).not.toHaveBeenCalledWith(
                expect.stringContaining('Failed to fetch key')
            );
        });
    });

    describe('cleanup', () => {
        it('should stop all active fetches on cleanup', async () => {
            const uuid1 = 'cleanup-uuid-1';
            const uuid2 = 'cleanup-uuid-2';
            
            let resolve1: any, resolve2: any;
            const promise1 = new Promise(r => resolve1 = r);
            const promise2 = new Promise(r => resolve2 = r);
            
            mockFetch
                .mockReturnValueOnce(promise1 as any)
                .mockReturnValueOnce(promise2 as any);

            keyFetcher.startFetching(uuid1);
            keyFetcher.startFetching(uuid2);
            
            await Promise.resolve();
            
            expect(keyFetcher.getCurrentUuids()).toHaveLength(2);

            keyFetcher.cleanup();

            expect(keyFetcher.getCurrentUuids()).toEqual([]);
            expect(mockLogger.debug).toHaveBeenCalledWith(`Stopped fetching UUID: ${uuid1}`);
            expect(mockLogger.debug).toHaveBeenCalledWith(`Stopped fetching UUID: ${uuid2}`);
            
            resolve1({ ok: false, status: 500, json: () => Promise.resolve({}) });
            resolve2({ ok: false, status: 500, json: () => Promise.resolve({}) });
            await Promise.resolve();
        });

        it('should cancel scheduled retries on cleanup', async () => {
            const uuid = 'cleanup-retry-uuid';
            
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 500,
                json: jest.fn().mockResolvedValue({}),
            } as any);

            await keyFetcher.startFetching(uuid);
            expect(keyFetcher.getCurrentUuids()).toContain(uuid);

            keyFetcher.cleanup();

            expect(keyFetcher.getCurrentUuids()).toEqual([]);

            jest.advanceTimersByTime(5000);
            await Promise.resolve();

            expect(mockFetch).toHaveBeenCalledTimes(1);
        });
    });

    describe('getCurrentUuids', () => {
        it('should return empty array initially', () => {
            expect(keyFetcher.getCurrentUuids()).toEqual([]);
        });

        it('should return all active UUIDs when fetching', async () => {
            const uuid1 = 'current-uuid-1';
            const uuid2 = 'current-uuid-2';
            
            let resolve1: any, resolve2: any;
            const promise1 = new Promise(r => resolve1 = r);
            const promise2 = new Promise(r => resolve2 = r);
            
            mockFetch
                .mockReturnValueOnce(promise1 as any)
                .mockReturnValueOnce(promise2 as any);

            keyFetcher.startFetching(uuid1);
            await Promise.resolve();
            expect(keyFetcher.getCurrentUuids()).toEqual([uuid1]);
            
            keyFetcher.startFetching(uuid2);
            await Promise.resolve();
            expect(keyFetcher.getCurrentUuids()).toEqual([uuid1, uuid2]);
            
            resolve1({ ok: false, status: 500, json: () => Promise.resolve({}) });
            resolve2({ ok: false, status: 500, json: () => Promise.resolve({}) });
            await Promise.resolve();
        });

        it('should remove completed UUIDs from list', async () => {
            const uuid = 'complete-uuid';
            
            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: jest.fn().mockResolvedValue({
                    publicKey: 'test-key',
                    expirationTime: new Date(Date.now() + 3600000).toISOString(),
                }),
            } as any);

            await keyFetcher.startFetching(uuid);
            
            expect(keyFetcher.getCurrentUuids()).toEqual([]);
        });
    });
});