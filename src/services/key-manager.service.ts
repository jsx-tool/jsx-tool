import { injectable, inject, singleton } from 'tsyringe';
import { Logger } from './logger.service';

export interface KeyData {
  publicKey: string
  expirationTime: string
  uuid: string
}

export interface UuidData {
  expirationTime: string
  uuid: string
}

@injectable()
@singleton()
export class KeyManager {
  private currentKey: KeyData | null = null;
  private expirationTimer: NodeJS.Timeout | null = null;
  private readonly keySetListeners: Array<(keyData: KeyData) => void> = [];

  constructor (
    @inject(Logger) private readonly logger: Logger
  ) {}

  setListener (listener: (keyData: KeyData) => void): void {
    this.keySetListeners.push(listener);
  }

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
    this.keySetListeners.forEach(listener => { listener(keyData); });

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

  getCurrentUuid (): UuidData | null {
    if (!this.currentKey?.uuid) {
      return null;
    }
    return {
      uuid: this.currentKey.uuid,
      expirationTime: this.currentKey.expirationTime
    };
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
