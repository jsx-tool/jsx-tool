import { injectable, singleton, inject } from 'tsyringe';
import { FilemapDesktopSocketService } from './filemap-desktop-socket.service';
import { ConfigService } from './config.service';

interface RegisterUuidEvent {
  event: 'register_uuid'
  referrer: string
  data: {
    uuid: string
    expirationTime: string
  }
}

@singleton()
@injectable()
export class DesktopEmitterService {
  constructor (
    @inject(FilemapDesktopSocketService) private readonly socketService: FilemapDesktopSocketService,
    @inject(ConfigService) private readonly config: ConfigService
  ) {}

  public registerUuid (uuid: string, expirationTime: string): void {
    const { wsHost, wsPort, wsProtocol } = this.config.getConfig();
    const event: RegisterUuidEvent = {
      event: 'register_uuid',
      referrer: `${wsProtocol}://${wsHost}:${wsPort}`,
      data: {
        uuid,
        expirationTime
      }
    };

    const message = JSON.stringify(event);
    this.socketService.broadcast(message);
  }
}
