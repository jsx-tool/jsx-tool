import { injectable, singleton, inject } from 'tsyringe';
import { FilemapDesktopSocketService } from './filemap-desktop-socket.service';

interface RegisterUuidEvent {
  event: 'register_uuid'
  data: {
    uuid: string
    expirationTime: string
  }
}

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
}
