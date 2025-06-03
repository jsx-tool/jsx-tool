import "reflect-metadata";
import { generateKeyPairSync, createSign } from 'crypto';
import { SignatureVerifierService } from '../signature-verifier.service';
import type { KeyManager } from '../key-manager.service';
import type { Logger } from '../logger.service';

describe('SignatureVerifierService', () => {
    let privateKeyPem: string;
    let publicKeyDerB64: string;

    beforeAll(() => {
        const { publicKey, privateKey } = generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'spki', format: 'der' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        });

        privateKeyPem = privateKey;
        publicKeyDerB64 = publicKey.toString('base64');
    });

    const mkLogger = (): jest.Mocked<Logger> =>
    ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        success: jest.fn(),
    } as any);

    const mkKeyMgr = (key?: string): jest.Mocked<KeyManager> =>
    ({
        getCurrentKey: jest.fn().mockReturnValue(
            key ? { publicKey: key } : undefined,
        ),
    } as any);

    it('returns true when the signature matches', () => {
        const payload = { foo: 'bar' };
        const dataBuf = Buffer.from(JSON.stringify(payload));
        const signature = createSign('sha256').update(dataBuf).end().sign(privateKeyPem, 'base64');

        const logger = mkLogger();
        const keyMgr = mkKeyMgr(publicKeyDerB64);
        const service = new SignatureVerifierService(keyMgr, logger);

        expect(service.verify(payload, signature)).toBe(true);
        expect(logger.warn).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
    });

    it('returns false and logs a warning when no public key is available', () => {
        const logger = mkLogger();
        const keyMgr = mkKeyMgr();
        const service = new SignatureVerifierService(keyMgr, logger);

        expect(service.verify({ whatever: 1 }, 'irrelevant')).toBe(false);
        expect(logger.warn).toHaveBeenCalledWith(
            'No public key available - cannot verify signature',
        );
    });

    it('returns false and logs a warning when the signature is invalid', () => {
        const payload = { foo: 'bar' };
        const badSigB64 = Buffer.from('totallybad==').toString('base64');

        const logger = mkLogger();
        const keyMgr = mkKeyMgr(publicKeyDerB64);
        const service = new SignatureVerifierService(keyMgr, logger);

        expect(service.verify(payload, badSigB64)).toBe(false);
        expect(logger.warn).toHaveBeenCalledWith('Signature verification failed');
    });
});