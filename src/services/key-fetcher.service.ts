import { injectable, inject } from 'tsyringe';
import { Logger } from './logger.service';
import { KeyManager, type KeyData } from './key-manager.service';
import { DesktopEmitterService } from './desktop-emitter.service';

interface KeyResponse {
  publicKey: string
  expirationTime: string
}

interface FetchState {
  uuid: string
  retryTimer: NodeJS.Timeout | null
  abortController: AbortController
}

@injectable()
export class KeyFetcher {
  private readonly activeFetches = new Map<string, FetchState>();
  private readonly RETRY_INTERVAL = 5000;

  constructor (
    @inject(Logger) private readonly logger: Logger,
    @inject(KeyManager) private readonly keyManager: KeyManager,
    @inject(DesktopEmitterService) private readonly desktopEmitterService: DesktopEmitterService
  ) {}

  async startFetching (uuid: string): Promise<void> {
    this.logger.info(`Starting key fetch for UUID: ${uuid}`);

    if (this.activeFetches.has(uuid)) {
      this.logger.debug(`Already fetching UUID: ${uuid}, skipping duplicate request`);
      return;
    }

    const fetchState: FetchState = {
      uuid,
      retryTimer: null,
      abortController: new AbortController()
    };

    this.activeFetches.set(uuid, fetchState);
    await this.attemptFetch(uuid);
  }

  getCurrentUuids (): string[] {
    return Array.from(this.activeFetches.keys());
  }

  cleanup (): void {
    for (const [uuid] of this.activeFetches) {
      this.stopFetching(uuid);
    }
    this.activeFetches.clear();
  }

  private async attemptFetch (uuid: string): Promise<void> {
    const fetchState = this.activeFetches.get(uuid);
    if (!fetchState) {
      return;
    }

    try {
      this.logger.debug(`Attempting to fetch key for UUID: ${uuid}`);

      const backendUrl = this.getBackendUrl();
      const response = await fetch(`${backendUrl}/api/fetch-key/${uuid}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: fetchState.abortController.signal
      });

      if (!this.activeFetches.has(uuid)) {
        this.logger.debug(`UUID ${uuid} was cancelled during fetch`);
        return;
      }

      if (!response.ok) {
        if (response.status === 500) {
          this.logger.debug(`Server down for UUID: ${uuid}, will retry`);
          this.scheduleRetry(uuid);
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
        this.stopFetching(uuid);
        return;
      }

      const keyDataWithUuid: KeyData = { ...keyData, uuid };
      const success = this.keyManager.setKey(keyDataWithUuid);

      if (success) {
        this.logger.success(`Successfully fetched and set key for UUID: ${uuid}`);
        this.desktopEmitterService.registerUuid(uuid, keyData.expirationTime);
        this.stopFetching(uuid);
      } else {
        this.logger.error(`Failed to set key for UUID: ${uuid}`);
        this.stopFetching(uuid);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        this.logger.debug(`Fetch aborted for UUID: ${uuid}`);
        return;
      }

      if (this.activeFetches.has(uuid)) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        this.logger.error(`Failed to fetch key for UUID: ${uuid}: ${msg}`);
        this.scheduleRetry(uuid);
      }
    }
  }

  private scheduleRetry (uuid: string): void {
    const fetchState = this.activeFetches.get(uuid);
    if (!fetchState) {
      return;
    }

    this.logger.debug(`Scheduling retry for UUID ${uuid} in ${this.RETRY_INTERVAL / 1000} seconds`);

    fetchState.retryTimer = setTimeout(() => {
      this.attemptFetch(uuid);
    }, this.RETRY_INTERVAL);
  }

  private stopFetching (uuid: string): void {
    const fetchState = this.activeFetches.get(uuid);
    if (!fetchState) {
      return;
    }

    if (fetchState.retryTimer) {
      clearTimeout(fetchState.retryTimer);
    }

    fetchState.abortController.abort();

    this.activeFetches.delete(uuid);
    this.logger.debug(`Stopped fetching UUID: ${uuid}`);
  }

  private getBackendUrl (): string {
    return 'https://jsxtool.com';
  }
}
