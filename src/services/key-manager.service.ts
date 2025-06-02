import { injectable, inject } from 'tsyringe';
import { Logger } from './logger.service';
import { ConfigService } from './config.service';

export interface KeyData {
  publicKey: string
  expirationTime: string
  uuid: string
}

@injectable()
export class KeyManager {
  private currentKey: KeyData | null = null;
  private expirationTimer: NodeJS.Timeout | null = null;

  constructor (
    @inject(Logger) private readonly logger: Logger,
    @inject(ConfigService) private readonly config: ConfigService
  ) {}

  setKey (keyData: KeyData): boolean {
    const expirationTime = new Date(keyData.expirationTime);
    const now = new Date();

    if (expirationTime <= now) {
      this.logger.warn(`Key ${keyData.uuid} is already expired, not setting`);
      return false;
    }

    if (this.expirationTimer) {
      clearTimeout(this.expirationTimer);
    }

    this.currentKey = keyData;
    this.logger.success(`Key ${keyData.uuid} set successfully`);

    const timeUntilExpiration = expirationTime.getTime() - now.getTime();
    this.expirationTimer = setTimeout(() => {
      this.expireKey();
    }, timeUntilExpiration);

    this.logger.debug(`Key will expire in ${Math.round(timeUntilExpiration / 1000)} seconds`);

    return true;
  }

  expireKey (): void {
    if (this.currentKey) {
      this.logger.info(`Key ${this.currentKey.uuid} has expired`);
      this.currentKey = null;
    }

    if (this.expirationTimer) {
      clearTimeout(this.expirationTimer);
      this.expirationTimer = null;
    }
  }

  getCurrentKey (): KeyData | null {
    return this.currentKey;
  }

  hasValidKey (): boolean {
    if (!this.currentKey) {
      return false;
    }

    const expirationTime = new Date(this.currentKey.expirationTime);
    const now = new Date();

    if (expirationTime <= now) {
      this.expireKey();
      return false;
    }

    return true;
  }

  cleanup (): void {
    if (this.expirationTimer) {
      clearTimeout(this.expirationTimer);
      this.expirationTimer = null;
    }
    this.currentKey = null;
  }
}
