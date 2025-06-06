import { injectable, singleton, inject } from 'tsyringe';
import type { Server, Socket } from 'net';
import { createServer, connect } from 'net';
import { unlinkSync, existsSync, mkdirSync } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { DesktopReceiverService } from './desktop-receiver.service';
import { Logger } from './logger.service';
import { DesktopClientRegistryService } from './desktop-client-registry.service';

@singleton()
@injectable()
export class FilemapDesktopSocketService {
  private readonly socketPath: string;
  private server: Server | null = null;
  private readonly clients = new Set<Socket>();
  private client: Socket | null = null;
  private isServer = false;

  private closing = false;
  private initialized = false;

  private readonly buffers = new Map<Socket, string>();

  constructor (
    @inject(DesktopReceiverService) private readonly receiver: DesktopReceiverService,
    @inject(DesktopClientRegistryService) private readonly registry: DesktopClientRegistryService,
    @inject(Logger) private readonly logger: Logger
  ) {
    this.socketPath = getSocketPath();
    if (!process.env.JEST_WORKER_ID) {
      this.init();
    }
  }

  public broadcast (message: string): void {
    if (this.closing) return;

    const payload = message.endsWith('\n') ? message : message + '\n';

    if (this.isServer) {
      for (const c of this.clients) {
        if (c.writable) c.write(payload);
      }
    } else if (this.client && this.client.writable) {
      this.client.write(payload);
    }
  }

  public async close (): Promise<void> {
    this.closing = true;

    for (const c of this.clients) c.destroy();
    this.clients.clear();

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => {
          this.server = null;
          resolve();
        });
        setTimeout(() => { if (this.server) this.server.close(); resolve(); }, 100);
      });
    }

    if (this.client) {
      this.client.destroy();
      this.client = null;
    }

    try { if (existsSync(this.socketPath)) unlinkSync(this.socketPath); } catch {}
    this.closing = false;
    this.initialized = false;
  }

  private async init (): Promise<void> {
    if (this.initialized || this.closing) return;
    this.initialized = true;

    if (existsSync(this.socketPath)) {
      try {
        this.client = connect(this.socketPath);
        this.client.on('data', (chunk) => { this.handleData(chunk, this.client!); });
        this.client.on('error', (err) => { this.onClientError(err); });
        this.client.on('connect', () => { this.isServer = false; });
      } catch {
        try { unlinkSync(this.socketPath); } catch {}
        this.startServer();
      }
    } else {
      this.startServer();
    }
  }

  private onClientError (err: Error): void {
    if (
      err.message.includes('ECONNREFUSED') ||
      err.message.includes('ENOENT') ||
      err.message.includes('ENOTSOCK') ||
      err.message.includes('EISDIR')
    ) {
      try { unlinkSync(this.socketPath); } catch {}
      this.client?.destroy();
      this.client = null;
      this.startServer();
    }
  }

  private startServer (): void {
    if (this.closing) return;

    this.server = createServer((socket) => {
      this.clients.add(socket);
      this.registry.add(socket);
      socket.on('data', (chunk) => {
        this.handleData(chunk, socket);
      });
      socket.on('close', () => {
        this.clients.delete(socket);
        this.registry.remove(socket);
      });
      socket.on('error', () => {
        this.clients.delete(socket);
        this.registry.remove(socket);
      });
    });

    this.server.listen(this.socketPath, () => { this.isServer = true; });

    this.server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        try { unlinkSync(this.socketPath); } catch {}
        setTimeout(() => { if (!this.closing) this.startServer(); }, 100);
      }
    });
  }

  private handleData (chunk: Buffer, sock: Socket): void {
    const buf = (this.buffers.get(sock) || '') + chunk.toString('utf8');
    let rest = buf; let nl;
    while ((nl = rest.indexOf('\n')) >= 0) {
      const line = rest.slice(0, nl).trim();
      rest = rest.slice(nl + 1);
      if (!line) continue;

      try {
        const obj = JSON.parse(line);
        this.receiver.handleMessage(obj, sock);
      } catch {
        this.logger.warn('Desktop socket: invalid JSON: ' + line);
      }
    }
    this.buffers.set(sock, rest);
  }
}

function getSocketPath (): string {
  if (os.platform() === 'win32') return '\\\\.\\pipe\\filemap-desktop-sock';

  const dir =
    process.env.XDG_RUNTIME_DIR ||
    (process.env.HOME ? path.join(process.env.HOME, '.filemap') : '/tmp');

  if (!existsSync(dir)) {
    try { mkdirSync(dir, { recursive: true }); } catch {}
  }
  return path.join(dir, 'filemap-desktop.sock');
}
