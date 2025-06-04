import { injectable, singleton, inject } from 'tsyringe';
import { FilemapDesktopSocketService } from './filemap-desktop-socket.service';
import type { WebSocketInboundEvent } from './websocket.service';

interface RegisterUuidEvent {
  event: 'register_uuid'
  data: {
    uuid: string
    expirationTime: string
  }
}

type ForwardedMessage = WebSocketInboundEvent<'open_element'>;

@singleton()
@injectable()
export class DesktopEmitterService {
  constructor (
    @inject(FilemapDesktopSocketService) private readonly socketService: FilemapDesktopSocketService
  ) {}

  public registerUuid (uuid: string, expirationTime: string): void {
    const event: RegisterUuidEvent = {
      event: 'register_uuid',
      data: {
        uuid,
        expirationTime
      }
    };

    const message = JSON.stringify(event);
    this.socketService.broadcast(message);
  }

  public forwardMessage (message: ForwardedMessage) {
    this.socketService.broadcast(JSON.stringify(message));
  }
}
