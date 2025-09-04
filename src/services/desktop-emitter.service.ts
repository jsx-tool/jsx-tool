import { injectable, singleton, inject } from 'tsyringe';
import { JSXToolDesktopSocketService } from './jsx-tool-desktop-socket.service';
import type { WebSocketInboundEvent } from './websocket.service';
import { ConfigService } from './config.service';
import type { KeyData } from './key-manager.service';
import { KeyManager } from './key-manager.service';

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
    @inject(JSXToolDesktopSocketService) private readonly socketService: JSXToolDesktopSocketService,
    @inject(KeyManager) private readonly keyManager: KeyManager
  ) {
    this.keyManager.setListener((keyData: KeyData) => {
      this.registerUuid(keyData.uuid, keyData.expirationTime);
    });
  }

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
