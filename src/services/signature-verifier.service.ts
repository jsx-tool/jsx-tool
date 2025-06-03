import { injectable, inject, singleton } from 'tsyringe';
import { createPublicKey, createVerify } from 'crypto';
import { KeyManager } from './key-manager.service';
import { Logger } from './logger.service';

@singleton()
@injectable()
export class SignatureVerifierService {
  constructor (
    @inject(KeyManager) private readonly keyManager: KeyManager,
    @inject(Logger) private readonly logger: Logger
  ) {}

  verify (payload: unknown, signatureB64: string): boolean {
    const keyData = this.keyManager.getCurrentKey();

    if (!keyData?.publicKey) {
      this.logger.warn('No public key available - cannot verify signature');
      return false;
    }

    try {
      const spkiDer = Buffer.from(keyData.publicKey, 'base64');

      const publicKey = createPublicKey({
        key: spkiDer,
        format: 'der',
        type: 'spki'
      });

      const data = Buffer.from(JSON.stringify(payload));

      const verifier = createVerify('sha256');
      verifier.update(data);
      verifier.end();

      const ok = verifier.verify(publicKey, signatureB64, 'base64');

      if (!ok) this.logger.warn('Signature verification failed');
      return ok;
    } catch (err) {
      this.logger.error(`Signature verification threw: ${(err as Error).message}`);
      return false;
    }
  }
}
