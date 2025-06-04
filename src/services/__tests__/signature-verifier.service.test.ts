import 'reflect-metadata';
import { generateKeyPairSync, createSign, randomBytes } from 'crypto';
import { SignatureVerifierService } from '../signature-verifier.service';
import { derToIeeeP1363 } from '../../utils/signature-format-converter';
import type { KeyManager } from '../key-manager.service';
import type { Logger } from '../logger.service';

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
    getCurrentKey: jest.fn().mockReturnValue(key ? { publicKey: key } : undefined),
} as any);

describe('SignatureVerifierService', () => {
    let privateKeyPem: string;
    let publicKeyDerB64: string;

    beforeAll(() => {
        const { publicKey, privateKey } = generateKeyPairSync('ec', {
            namedCurve: 'prime256v1',
            publicKeyEncoding: { type: 'spki', format: 'der' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        });

        publicKeyDerB64 = publicKey.toString('base64');
        privateKeyPem = privateKey;
    });

    it('returns true when the signature matches', () => {
        const payload = { foo: 'bar' };
        const dataBuf = Buffer.from(JSON.stringify(payload));

        const ieeeSigB64 = createSign('sha256')
            .update(dataBuf)
            .end()
            .sign(
                {
                    key: privateKeyPem,
                    dsaEncoding: 'ieee-p1363',
                },
                'base64',
            );

        const logger = mkLogger();
        const keyMgr = mkKeyMgr(publicKeyDerB64);
        const service = new SignatureVerifierService(keyMgr, logger);

        expect(service.verify(payload, ieeeSigB64)).toBe(true);
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
        const badSigB64 = randomBytes(64).toString('base64');

        const logger = mkLogger();
        const keyMgr = mkKeyMgr(publicKeyDerB64);
        const service = new SignatureVerifierService(keyMgr, logger);

        expect(service.verify(payload, badSigB64)).toBe(false);
        expect(logger.warn).toHaveBeenCalledWith('Signature verification failed');
    });
});