import 'reflect-metadata';
import { container } from 'tsyringe';
import { WebSocketService } from '../websocket.service';
import { ConfigService } from '../config.service';
import { Logger } from '../logger.service';
import WebSocket from 'ws';

describe('WebSocketService', () => {
  let wsService: WebSocketService;
  let logger: Logger;

  beforeEach(() => {
    container.clearInstances();

    jest.spyOn(Logger.prototype, 'info').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'success').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

    const cfg = container.resolve(ConfigService);
    cfg.setFromCliOptions({ wsPort: 9999 });
    container.registerInstance(ConfigService, cfg);

    logger = new Logger();
    jest.spyOn(logger, 'info').mockImplementation(() => {});
    jest.spyOn(logger, 'success').mockImplementation(() => {});
    jest.spyOn(logger, 'error').mockImplementation(() => {});

    container.registerInstance(Logger, logger);

    wsService = container.resolve(WebSocketService);
  });

  afterEach(async () => {
    await wsService.stop();
  });

  it('should start WebSocket server', async () => {
    await wsService.start();
    expect(logger!.success).toHaveBeenCalledWith(
      expect.stringContaining('WebSocket server listening')
    );
  });

  it('should handle client connections', (done) => {
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

  it('should broadcast to all clients', (done) => {
    wsService.start().then(() => {
      const clients = [
        new WebSocket('ws://localhost:9999'),
        new WebSocket('ws://localhost:9999')
      ];
      
      let connectedCount = 0;
      let messageCount = 0;
      
      clients.forEach(client => {
        client.on('open', () => {
          connectedCount++;
          if (connectedCount === 2) {
            wsService.broadcast('test message');
          }
        });
        
        client.on('message', (data) => {
          const message = data.toString();
          if (message.includes('test message')) {
            messageCount++;
            if (messageCount === 2) {
              clients.forEach(c => c.close());
              done();
            }
          }
        });
      });
    });
  });
});