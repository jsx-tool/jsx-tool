import { injectable, inject } from 'tsyringe';
import * as http from 'http';
import { createProxyServer } from 'http-proxy';
import type HttpProxy from 'http-proxy';
import type { ServerResponse } from 'http';
import * as zlib from 'zlib';
import { ConfigService } from './config.service';
import { Logger } from './logger.service';
import { HtmlInjector } from './html-injector.service';
import type { Socket } from 'net';
import type Stream from 'stream';

@injectable()
export class ProxyService {
  private proxy?: HttpProxy;
  private server?: http.Server;

  constructor (
    @inject(ConfigService) private readonly config: ConfigService,
    @inject(Logger) private readonly logger: Logger,
    @inject(HtmlInjector) private readonly htmlInjector: HtmlInjector
  ) { }

  async start (): Promise<void> {
    const config = this.config.getConfig();
    const target = `${config.serverProtocol}://${config.serverHost}:${config.serverPort}`;

    this.proxy = createProxyServer({
      target,
      changeOrigin: true,
      selfHandleResponse: true,
      ws: true
    });

    this.proxy.on('proxyRes', (proxyRes, req, res: ServerResponse) => {
      this.handleProxyResponse(proxyRes, req, res);
    });

    this.proxy.on(
      'error',
      (
        err: Error,
        _req: http.IncomingMessage,
        res: http.ServerResponse<http.IncomingMessage> | Socket
      ) => {
        this.logger.error(`Proxy error: ${err.message}`);
        if ('writeHead' in res && !res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          (res).end('Proxy error occurred');
        } else if ('destroy' in res) {
          (res as Socket).destroy();
        }
      }
    );

    this.server = http.createServer((req, res) => {
      this.proxy!.web(req, res);
    });

    this.server.on('upgrade', (req, socket: Socket, head: Buffer) => {
      if (!this.proxy) return socket.destroy();

      socket.on('error', (e) => {
        this.logger.warn(`WS socket error: ${e.message}`);
        socket.destroy();
      });

      this.proxy.ws(req, socket, head, { target, changeOrigin: true });
    });

    await new Promise<void>((resolve) => {
      this.server!.listen(config.proxyPort, config.proxyHost, () => {
        this.logger.success(
          `Proxy server running at ${config.proxyProtocol}://${config.proxyHost}:${config.proxyPort}`
        );
        this.logger.info(`Forwarding to ${target}`);
        resolve();
      });
    });
  }

  private handleProxyResponse (
    proxyRes: http.IncomingMessage,
    _req: http.IncomingMessage,
    res: ServerResponse
  ): void {
    const contentType = proxyRes.headers['content-type'] || '';

    if (contentType.includes('text/html')) {
      this.handleHtmlResponse(proxyRes, res);
    } else {
      res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
      proxyRes.pipe(res);
    }
  }

  private handleHtmlResponse (
    proxyRes: http.IncomingMessage,
    res: ServerResponse
  ): void {
    const encoding = proxyRes.headers['content-encoding'];
    let body = '';

    let stream: Stream = proxyRes;
    if (encoding === 'gzip') stream = proxyRes.pipe(zlib.createGunzip());
    else if (encoding === 'deflate') stream = proxyRes.pipe(zlib.createInflate());
    else if (encoding === 'br') stream = proxyRes.pipe(zlib.createBrotliDecompress());

    stream.on('data', (chunk: Buffer) => (body += chunk.toString()));
    stream.on('end', () => {
      const modifiedBody = this.htmlInjector.inject(body);

      const headers = { ...proxyRes.headers };
      delete headers['content-encoding'];
      delete headers['content-length'];

      res.writeHead(proxyRes.statusCode || 200, headers);
      res.end(modifiedBody);
    });
    stream.on('error', (err: Error) => {
      this.logger.error(`Decompression error: ${err.message}`);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Decompression error occurred');
    });
  }

  async stop (): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => { resolve(); }));
      this.logger.info('Proxy server stopped');
    }
    this.proxy?.close();
  }
}
