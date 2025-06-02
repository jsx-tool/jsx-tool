import "reflect-metadata";
import { KeyManager, KeyData } from '../key-manager.service';
import { Logger } from '../logger.service';

describe('KeyManager', () => {
    let keyManager: KeyManager;
    let mockLogger: jest.Mocked<Logger>;

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

        keyManager = new KeyManager(mockLogger);
    });

    afterEach(() => {
        keyManager.cleanup();
        jest.useRealTimers();
    });

    describe('setKey', () => {
        it('should set a valid key successfully', () => {
            const keyData: KeyData = {
                publicKey: 'test-public-key',
                expirationTime: new Date(Date.now() + 3600000).toISOString(),
                uuid: 'test-uuid',
            };

            const result = keyManager.setKey(keyData);

            expect(result).toBe(true);
            expect(mockLogger.success).toHaveBeenCalledWith(`Key ${keyData.uuid} set successfully`);
            expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('Key will expire in'));
            expect(keyManager.getCurrentKey()).toEqual(keyData);
        });

        it('should reject expired keys', () => {
            const keyData: KeyData = {
                publicKey: 'expired-key',
                expirationTime: new Date(Date.now() - 3600000).toISOString(),
                uuid: 'expired-uuid',
            };

            const result = keyManager.setKey(keyData);

            expect(result).toBe(false);
            expect(mockLogger.warn).toHaveBeenCalledWith(`Key ${keyData.uuid} is already expired, not setting`);
            expect(keyManager.getCurrentKey()).toBeNull();
        });

        it('should replace existing key and clear old timer', () => {
            const keyData1: KeyData = {
                publicKey: 'key-1',
                expirationTime: new Date(Date.now() + 3600000).toISOString(),
                uuid: 'uuid-1',
            };

            const keyData2: KeyData = {
                publicKey: 'key-2',
                expirationTime: new Date(Date.now() + 7200000).toISOString(),
                uuid: 'uuid-2',
            };

            keyManager.setKey(keyData1);
            expect(keyManager.getCurrentKey()).toEqual(keyData1);

            keyManager.setKey(keyData2);
            expect(keyManager.getCurrentKey()).toEqual(keyData2);
            expect(mockLogger.success).toHaveBeenCalledWith(`Key ${keyData2.uuid} set successfully`);

            jest.advanceTimersByTime(3600001);
            
            expect(keyManager.getCurrentKey()).toEqual(keyData2);
        });

        it('should automatically expire key after timeout', () => {
            const expirationMs = 5000;
            const keyData: KeyData = {
                publicKey: 'auto-expire-key',
                expirationTime: new Date(Date.now() + expirationMs).toISOString(),
                uuid: 'auto-expire-uuid',
            };

            keyManager.setKey(keyData);
            expect(keyManager.getCurrentKey()).toEqual(keyData);

            jest.advanceTimersByTime(expirationMs - 1);
            expect(keyManager.getCurrentKey()).toEqual(keyData);

            jest.advanceTimersByTime(2);
            expect(mockLogger.info).toHaveBeenCalledWith(`Key ${keyData.uuid} has expired`);
            expect(keyManager.getCurrentKey()).toBeNull();
        });
    });

    describe('expireKey', () => {
        it('should expire current key', () => {
            const keyData: KeyData = {
                publicKey: 'test-key',
                expirationTime: new Date(Date.now() + 3600000).toISOString(),
                uuid: 'test-uuid',
            };

            keyManager.setKey(keyData);
            expect(keyManager.getCurrentKey()).toEqual(keyData);

            keyManager.expireKey();

            expect(mockLogger.info).toHaveBeenCalledWith(`Key ${keyData.uuid} has expired`);
            expect(keyManager.getCurrentKey()).toBeNull();
        });

        it('should do nothing if no key is set', () => {
            keyManager.expireKey();
            
            expect(mockLogger.info).not.toHaveBeenCalled();
            expect(keyManager.getCurrentKey()).toBeNull();
        });

        it('should clear expiration timer', () => {
            const keyData: KeyData = {
                publicKey: 'test-key',
                expirationTime: new Date(Date.now() + 3600000).toISOString(),
                uuid: 'test-uuid',
            };

            keyManager.setKey(keyData);
            keyManager.expireKey();

            jest.advanceTimersByTime(3600001);
            
            expect(mockLogger.info).toHaveBeenCalledTimes(1);
        });
    });

    describe('getCurrentKey', () => {
        it('should return null initially', () => {
            expect(keyManager.getCurrentKey()).toBeNull();
        });

        it('should return current key when set', () => {
            const keyData: KeyData = {
                publicKey: 'test-key',
                expirationTime: new Date(Date.now() + 3600000).toISOString(),
                uuid: 'test-uuid',
            };

            keyManager.setKey(keyData);
            expect(keyManager.getCurrentKey()).toEqual(keyData);
        });
    });

    describe('hasValidKey', () => {
        it('should return false when no key is set', () => {
            expect(keyManager.hasValidKey()).toBe(false);
        });

        it('should return true for valid key', () => {
            const keyData: KeyData = {
                publicKey: 'valid-key',
                expirationTime: new Date(Date.now() + 3600000).toISOString(),
                uuid: 'valid-uuid',
            };

            keyManager.setKey(keyData);
            expect(keyManager.hasValidKey()).toBe(true);
        });

        it('should return false and expire key if expired', () => {
            const keyData: KeyData = {
                publicKey: 'soon-expired-key',
                expirationTime: new Date(Date.now() + 1000).toISOString(),
                uuid: 'soon-expired-uuid',
            };

            keyManager.setKey(keyData);
            expect(keyManager.hasValidKey()).toBe(true);

            jest.advanceTimersByTime(1001);

            expect(keyManager.hasValidKey()).toBe(false);
            expect(mockLogger.info).toHaveBeenCalledWith(`Key ${keyData.uuid} has expired`);
            expect(keyManager.getCurrentKey()).toBeNull();
        });

        it('should handle edge case of exact expiration time', () => {
            const now = Date.now();
            const keyData: KeyData = {
                publicKey: 'edge-case-key',
                expirationTime: new Date(now).toISOString(),
                uuid: 'edge-case-uuid',
            };

            jest.spyOn(Date, 'now').mockReturnValue(now);

            keyManager.setKey(keyData);
            
            expect(keyManager.getCurrentKey()).toBeNull();
            expect(keyManager.hasValidKey()).toBe(false);

            (Date.now as jest.Mock).mockRestore();
        });
    });

    describe('cleanup', () => {
        it('should clear key and timer', () => {
            const keyData: KeyData = {
                publicKey: 'cleanup-key',
                expirationTime: new Date(Date.now() + 3600000).toISOString(),
                uuid: 'cleanup-uuid',
            };

            keyManager.setKey(keyData);
            expect(keyManager.getCurrentKey()).toEqual(keyData);

            keyManager.cleanup();

            expect(keyManager.getCurrentKey()).toBeNull();

            jest.advanceTimersByTime(3600001);
            
            expect(mockLogger.info).not.toHaveBeenCalled();
        });

        it('should handle cleanup when no key is set', () => {
            expect(() => keyManager.cleanup()).not.toThrow();
            expect(keyManager.getCurrentKey()).toBeNull();
        });
    });

    describe('timer precision', () => {
        it('should handle very short expiration times', () => {
            const keyData: KeyData = {
                publicKey: 'short-timer-key',
                expirationTime: new Date(Date.now() + 10).toISOString(),
                uuid: 'short-timer-uuid',
            };

            keyManager.setKey(keyData);
            expect(mockLogger.debug).toHaveBeenCalledWith('Key will expire in 0 seconds');

            jest.advanceTimersByTime(11);
            expect(keyManager.getCurrentKey()).toBeNull();
        });

        it('should handle very long expiration times', () => {
            const keyData: KeyData = {
                publicKey: 'long-timer-key',
                expirationTime: new Date(Date.now() + 86400000 * 365).toISOString(), // 1 year
                uuid: 'long-timer-uuid',
            };

            keyManager.setKey(keyData);
            expect(mockLogger.debug).toHaveBeenCalledWith('Key will expire in 31536000 seconds');
        });
    });
});