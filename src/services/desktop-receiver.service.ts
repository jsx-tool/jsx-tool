import { injectable, singleton, inject } from 'tsyringe';
import type { Socket } from 'net';
import { KeyManager } from './key-manager.service';

@singleton()
@injectable()
export class DesktopReceiverService {
  constructor (
    @inject(KeyManager) private readonly keyManager: KeyManager
  ) {}

  public handleMessage (msg: any, sock: Socket): void {
    if (msg?.event === 'filemap-client-up') {
      const uuidData = this.keyManager.getCurrentUuid();
      if (uuidData) {
        sock.write(
          JSON.stringify({ event: 'register_uuid', data: uuidData }) + '\n'
        );
      }
    }
  }
}
