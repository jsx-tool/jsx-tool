import { injectable, inject } from 'tsyringe';
import { Logger } from './logger.service';
import { KeyManager, type KeyData } from './key-manager.service';

interface KeyResponse {
  publicKey: string
  expirationTime: string
}

@injectable()
export class KeyFetcher {
  private currentUuid: string | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private readonly RETRY_INTERVAL = 5000;

  constructor (
    @inject(Logger) private readonly logger: Logger,
    @inject(KeyManager) private readonly keyManager: KeyManager
  ) {}

  async startFetching (uuid: string): Promise<void> {
    this.logger.info(`Starting key fetch for UUID: ${uuid}`);

    if (this.currentUuid && this.currentUuid !== uuid) {
      this.logger.debug(`Canceling fetch for old UUID: ${this.currentUuid}`);
      this.stopFetching();
    }

    this.currentUuid = uuid;
    await this.attemptFetch();
  }

  private async attemptFetch (): Promise<void> {
    if (!this.currentUuid) {
      return;
    }

    const uuid = this.currentUuid;

    try {
      this.logger.debug(`Attempting to fetch key for UUID: ${uuid}`);

      const backendUrl = this.getBackendUrl();

      const response = await fetch(`${backendUrl}/api/fetch-key/${uuid}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (this.currentUuid !== uuid) {
        this.logger.debug(`Ignoring response for old UUID: ${uuid}`);
        return;
      }

      if (!response.ok) {
        if (response.status === 404) {
          this.logger.debug(`Key not ready yet for UUID: ${uuid}, will retry`);
          this.scheduleRetry();
          return;
        }

        const errorData = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const keyData = await response.json() as KeyResponse;

      const expirationTime = new Date(keyData.expirationTime);
      const now = new Date();

      if (expirationTime <= now) {
        this.logger.warn(`Received expired key for UUID: ${uuid}, stopping fetch`);
        this.stopFetching();
        return;
      }

      const keyDataWithUuid: KeyData = {
        ...keyData,
        uuid
      };

      const success = this.keyManager.setKey(keyDataWithUuid);

      if (success) {
        this.logger.success(`Successfully fetched and set key for UUID: ${uuid}`);
        this.stopFetching();
      } else {
        this.logger.error(`Failed to set key for UUID: ${uuid}`);
        this.stopFetching();
      }
    } catch (error) {
      if (this.currentUuid === uuid) {
        this.logger.error(`Failed to fetch key for UUID: ${uuid}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        this.scheduleRetry();
      }
    }
  }

  private scheduleRetry (): void {
    if (!this.currentUuid) {
      return;
    }

    this.logger.debug(`Scheduling retry in ${this.RETRY_INTERVAL / 1000} seconds`);

    this.retryTimer = setTimeout(async (): Promise<void> => {
      await this.attemptFetch();
    }, this.RETRY_INTERVAL);
  }

  private stopFetching (): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.currentUuid = null;
  }

  private getBackendUrl (): string {
    // Jamie take a look at this
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:3000';
    return backendUrl;
  }

  getCurrentUuid (): string | null {
    return this.currentUuid;
  }

  cleanup (): void {
    this.stopFetching();
  }
}
