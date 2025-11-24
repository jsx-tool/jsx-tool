import { injectable, singleton, inject } from 'tsyringe';
import * as pty from 'node-pty';
import { EventEmitter } from 'events';
import { ConfigService } from './config.service';

export interface TerminalLog {
  id: number
  data: string
}

@singleton()
@injectable()
export class TerminalManagerService extends EventEmitter {
  private readonly sessions = new Map<string, {
    pty: pty.IPty
    logs: TerminalLog[]
    nextLogId: number
  }>();

  constructor (
    @inject(ConfigService) private readonly configService: ConfigService
  ) {
    super();
  }

  createSession (shell: string, args: string[], cols: number, rows: number, env: Record<string, string> = {}): string {
    const sessionId = Math.random().toString(36).substring(2, 15);
    const config = this.configService.getConfig();

    const ptyProcess = pty.spawn(shell, args, {
      name: 'xterm-color',
      cols: cols || 80,
      rows: rows || 24,
      cwd: config.workingDirectory,
      env: { ...process.env, ...env }
    });

    const session: {
      pty: pty.IPty
      logs: TerminalLog[]
      nextLogId: number
    } = {
      pty: ptyProcess,
      logs: [],
      nextLogId: 1
    };

    this.sessions.set(sessionId, session);

    ptyProcess.onData((data) => {
      const logId = session.nextLogId++;
      session.logs.push({ id: logId, data });
      this.emit('data', sessionId);
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      this.emit('exit', sessionId, exitCode, signal);
    });

    this.emit('created', sessionId);

    return sessionId;
  }

  write (sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.pty.write(data);
    }
  }

  kill (sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.pty.kill();
      this.sessions.delete(sessionId);
    }
  }

  getLogs (sessionId: string, afterCursor: number): { logs: TerminalLog[], nextCursor: number } {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { logs: [], nextCursor: afterCursor };
    }

    const newLogs = session.logs.filter(l => l.id > afterCursor);
    const maxId = newLogs.length > 0 ? newLogs[newLogs.length - 1].id : afterCursor;

    return {
      logs: newLogs,
      nextCursor: maxId
    };
  }

  exists (sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  getSessions (): string[] {
    return Array.from(this.sessions.keys());
  }

  async runOneOffCommand (command: string, cwd?: string, env: Record<string, string> = {}): Promise<string> {
    return await new Promise((resolve) => {
      const shell = process.platform === 'win32' ? 'cmd.exe' : process.env.SHELL || '/bin/zsh';
      const args = process.platform === 'win32' ? ['/c', command] : ['-c', command];

      const ptyProcess = pty.spawn(shell, args, {
        name: 'xterm-color',
        cols: 80,
        rows: 24,
        cwd: cwd || this.configService.getConfig().workingDirectory || process.env.HOME || process.cwd(),
        env: { ...process.env, ...env }
      });

      let output = '';

      ptyProcess.onData((data) => {
        output += data;
      });

      ptyProcess.onExit(({ exitCode }) => {
        if (exitCode === 0) {
          resolve(output);
        } else {
          resolve(output);
        }
      });
    });
  }
}
