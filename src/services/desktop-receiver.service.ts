import { injectable, singleton, inject } from 'tsyringe';
import type { Socket } from 'net';
import { KeyManager } from './key-manager.service';
import type { AvailableApis } from './desktop-client-registry.service';
import { DesktopClientRegistryService } from './desktop-client-registry.service';

interface UpMessage {
  event: 'jsx-tool-client-up'
  utilized_apis: AvailableApis[]
}

type IncomingUnixMessage = UpMessage;

@singleton()
@injectable()
export class DesktopReceiverService {
  constructor (
    @inject(KeyManager) private readonly keyManager: KeyManager,
    @inject(DesktopClientRegistryService) private readonly desktopClientRegistryService: DesktopClientRegistryService
  ) {}

  public handleMessage (msg: IncomingUnixMessage, socket: Socket): void {
    if (msg?.event === 'jsx-tool-client-up') {
      this.desktopClientRegistryService.addApis(socket, msg.utilized_apis);
      const uuidData = this.keyManager.getCurrentUuid();
      if (uuidData) {
        socket.write(
          JSON.stringify({ event: 'register_uuid', data: uuidData }) + '\n'
        );
      }
    }
  }
}
