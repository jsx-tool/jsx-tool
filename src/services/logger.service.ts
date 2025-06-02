import { injectable, singleton } from 'tsyringe';
import pc from 'picocolors';

export interface ILogger {
  info: (message: string) => void
  error: (message: string) => void
  warn: (message: string) => void
  debug: (message: string) => void
  success: (message: string) => void
}

@singleton()
@injectable()
export class Logger implements ILogger {
  private debugEnabled = false;

  setDebug (enabled: boolean): void {
    this.debugEnabled = enabled;
  }

  info (message: string): void {
    console.log(pc.blue('[filemap]'), message);
  }

  error (message: string): void {
    console.error(pc.red('[filemap]'), message);
  }

  warn (message: string): void {
    console.warn(pc.yellow('[filemap]'), message);
  }

  success (message: string): void {
    console.log(pc.green('[filemap]'), message);
  }

  debug (message: string): void {
    if (this.debugEnabled) {
      console.log(pc.gray('[filemap]'), pc.gray(message));
    }
  }
}
