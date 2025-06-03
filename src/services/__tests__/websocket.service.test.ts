import 'reflect-metadata';
import { container } from 'tsyringe';
import { WebSocketService }           from '../websocket.service';
import { ConfigService }              from '../config.service';
import { Logger }                     from '../logger.service';
import { KeyFetcher }                 from '../key-fetcher.service';
import { KeyManager }                 from '../key-manager.service';
import { SignatureVerifierService }   from '../signature-verifier.service';
import WebSocket                      from 'ws';

jest.setTimeout(10_000);

class MockKeyFetcher {
  startFetching = jest.fn();
  cleanup       = jest.fn();
  getCurrentUuid = jest.fn().mockReturnValue(null);
}

class MockKeyManager {
  getCurrentKey  = jest.fn().mockReturnValue(null);
  hasValidKey    = jest.fn().mockReturnValue(false);
  cleanup        = jest.fn();
  getCurrentUuid = jest.fn().mockReturnValue(null);

  private listener?: (data: any) => void;

  setListener = jest.fn((cb: (data: any) => void) => {
    this.listener = cb;
  });

  _emit(keyData: any) {
    this.listener?.(keyData);
  }
}

class MockSigVerifier {
  verify = jest.fn().mockReturnValue(true);
}

describe('WebSocketService', () => {
  let wsService: WebSocketService;
  let logger:    Logger;

  beforeEach(() => {
    container.clearInstances();

    ['info', 'success', 'error', 'warn', 'debug'].forEach(method => {
      jest.spyOn(Logger.prototype as any, method).mockImplementation(() => {});
    });

    const cfg = container.resolve(ConfigService);
    cfg.setFromCliOptions({ wsPort: 9999 });
    container.registerInstance(ConfigService, cfg);

    logger = new Logger();
    ['info', 'success', 'error', 'warn', 'debug'].forEach(method => {
      jest.spyOn(logger as any, method).mockImplementation(() => {});
    });
    container.registerInstance(Logger, logger);

    container.registerInstance(
      KeyFetcher,
      new MockKeyFetcher() as unknown as KeyFetcher,
    );
    container.registerInstance(
      KeyManager,
      new MockKeyManager() as unknown as KeyManager,
    );
    container.registerInstance(
      SignatureVerifierService,
      new MockSigVerifier() as unknown as SignatureVerifierService,
    );

    wsService = container.resolve(WebSocketService);
  });

  afterEach(async () => {
    await wsService.stop();
  });

  it('starts WebSocket server', async () => {
    await wsService.start();
    expect(logger.success).toHaveBeenCalledWith(
      expect.stringContaining('WebSocket server listening'),
    );
  });

  it('handles client connections', done => {
    wsService.start().then(() => {
      const client = new WebSocket('ws://localhost:9999');

      client.on('open', () => {
        expect(wsService.getClientCount()).toBe(1);
        client.close();
      });

      client.on('close', () => {
        setTimeout(() => {
          expect(wsService.getClientCount()).toBe(0);
          done();
        }, 100);
      });
    });
  });

  it('broadcasts to all clients', done => {
    wsService.start().then(() => {
      const clients = [
        new WebSocket('ws://localhost:9999'),
        new WebSocket('ws://localhost:9999'),
      ];

      let opened = 0;
      let received = 0;

      clients.forEach(c => {
        c.on('open', () => {
          if (++opened === clients.length) wsService.broadcast('test message');
        });

        c.on('message', data => {
          if (data.toString().includes('test message') && ++received === clients.length) {
            clients.forEach(cl => cl.close());
            done();
          }
        });
      });
    });
  });
});