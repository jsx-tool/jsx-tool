import 'reflect-metadata';
import { FilemapDesktopSocketService } from '../filemap-desktop-socket.service';

import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';

import { Socket } from 'net';
import { Logger } from '../logger.service';

export class DesktopReceiverStub {
  setHandler(): void {/* noop */}
  _emit(_msg: any, _sock: Socket): void {/* noop */}
}

jest.setTimeout(10000);

function tempSocketPath(): string {
  return os.platform() === 'win32'
    ? `\\\\.\\pipe\\filemap-desktop-sock-test-${Date.now()}`
    : path.join(os.tmpdir(), `filemap-desktop-test-${Math.random()}.sock`);
}

describe('FilemapDesktopSocketService', () => {
  let socketPath: string;
  let svc: FilemapDesktopSocketService;
  let extServer: net.Server | null = null;

  function createSvc(): FilemapDesktopSocketService {
    const receiver = new DesktopReceiverStub() as any;
    const logger = new Logger() as any;
    const s       = new FilemapDesktopSocketService(receiver, logger);
    (s as any).socketPath = socketPath;
    (s as any).init();
    return s;
  }

  beforeEach(() => {
    socketPath = tempSocketPath();
  });

  afterEach(async () => {
    if (svc) {
      await svc.close();
      svc = undefined as any;
    }
    if (extServer) {
      await new Promise<void>(res => {
        extServer!.close(() => res());
        setTimeout(res, 100);
      });
      extServer = null;
    }
    await new Promise(res => setTimeout(res, 50));
    try { if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath); } catch {}
  });

  it('starts as server when no socket exists, broadcasts to clients', (done) => {
    svc = createSvc();

    setTimeout(() => {
      const client = net.connect(socketPath);
      let data = '';

      client.on('data', chunk => {
        data += chunk.toString();
        if (data.includes('hello')) {
          client.end();
          done();
        }
      });

      client.on('connect', () => {
        setTimeout(() => svc.broadcast('hello'), 50);
      });

      client.on('error', () => {
        client.destroy();
        done(new Error('Client connection failed'));
      });
    }, 200);
  });

  it('acts as a client if socket exists and server is alive', (done) => {
    extServer = net.createServer(sock => {
      sock.on('data', chunk => {
        expect(chunk.toString()).toContain('world');
        sock.end();
        done();
      });
    });

    extServer.listen(socketPath, () => {
      svc = createSvc();
      setTimeout(() => svc.broadcast('world'), 200);
    });

    extServer.on('error', done);
  });

  it('removes stale socket and becomes server if connect fails', (done) => {
    fs.writeFileSync(socketPath, '');

    svc = createSvc();

    setTimeout(() => {
      expect((svc as any).isServer).toBe(true);
      done();
    }, 500);
  });

  it('broadcast does nothing if not connected', () => {
    const receiver = new DesktopReceiverStub() as any;
    const logger = new Logger() as any;
    svc = new FilemapDesktopSocketService(receiver, logger);
    (svc as any).socketPath  = socketPath;
    (svc as any).client      = null;
    (svc as any)._initialized = true;
    expect(() => svc.broadcast('noop')).not.toThrow();
  });

  it('cleans up on close', (done) => {
    svc = createSvc();

    setTimeout(async () => {
      await svc.close();
      expect(fs.existsSync(socketPath)).toBe(false);
      done();
    }, 200);
  });
});