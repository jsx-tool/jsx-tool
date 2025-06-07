import { injectable, singleton, inject } from 'tsyringe';
import { FilemapDesktopSocketService } from './filemap-desktop-socket.service';
import type { WebSocketInboundEvent } from './websocket.service';
import { ConfigService } from './config.service';

interface RegisterUuidEvent {
  event: 'register_uuid'
  data: {
    uuid: string
    expirationTime: string
    referrer: string
  }
}

type ForwardedMessage =
  WebSocketInboundEvent<'open_element'> |
  WebSocketInboundEvent<'open_file'>;

type ForwardedMessageWithReferrer = ForwardedMessage & {
  referrer: string
};

@singleton()
@injectable()
export class DesktopEmitterService {
  constructor (
    @inject(ConfigService) private readonly configService: ConfigService,
    @inject(FilemapDesktopSocketService) private readonly socketService: FilemapDesktopSocketService
  ) {}

  public registerUuid (uuid: string, expirationTime: string): void {
    const { wsHost, wsPort, wsProtocol } = this.configService.getConfig();
    const referrer = `${wsProtocol}://${wsHost}:${wsPort}`;
    const event: RegisterUuidEvent = {
      event: 'register_uuid',
      data: {
        uuid,
        expirationTime,
        referrer
      }
    };

    const message = JSON.stringify(event);
    this.socketService.broadcast(message);
  }

  private appendReferrerToForwardedMessage (message: ForwardedMessage): ForwardedMessageWithReferrer {
    const { wsHost, wsPort, wsProtocol } = this.configService.getConfig();
    const referrer = `${wsProtocol}://${wsHost}:${wsPort}`;
    return {
      ...message,
      referrer
    };
  }

  public forwardMessage (message: ForwardedMessage) {
    this.socketService.broadcast(
      JSON.stringify(this.appendReferrerToForwardedMessage(message))
    );
  }
}
