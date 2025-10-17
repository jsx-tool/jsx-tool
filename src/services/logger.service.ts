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
  private silence = false;

  setDebug (enabled: boolean): void {
    this.debugEnabled = enabled;
  }

  setSilence (silence: boolean): void {
    this.silence = silence;
  }

  info (message: string): void {
    if (this.silence) {
      return;
    }
    console.log(pc.blue('[jsx-tool]'), message);
  }

  error (message: string): void {
    if (this.silence) {
      return;
    }
    console.error(pc.red('[jsx-tool]'), message);
  }

  warn (message: string): void {
    if (this.silence) {
      return;
    }
    console.warn(pc.yellow('[jsx-tool]'), message);
  }

  success (message: string): void {
    if (this.silence) {
      return;
    }
    console.log(pc.green('[jsx-tool]'), message);
  }

  debug (message: string): void {
    if (this.silence) {
      return;
    }
    if (this.debugEnabled) {
      console.log(pc.gray('[jsx-tool]'), pc.gray(message));
    }
  }
}
