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
  private service: string = 'jsx-tool';

  setDebug (enabled: boolean): void {
    this.debugEnabled = enabled;
  }

  setService (service: string): void {
    this.service = service;
  }

  setSilence (silence: boolean): void {
    this.silence = silence;
  }

  info (message: string): void {
    if (this.silence) {
      return;
    }
    console.log(pc.blue(`[${this.service}]`), message);
  }

  error (message: string): void {
    if (this.silence) {
      return;
    }
    console.error(pc.red(`[${this.service}]`), message);
  }

  warn (message: string): void {
    if (this.silence) {
      return;
    }
    console.warn(pc.yellow(`[${this.service}]`), message);
  }

  success (message: string): void {
    if (this.silence) {
      return;
    }
    console.log(pc.green(`[${this.service}]`), message);
  }

  debug (message: string): void {
    if (this.silence) {
      return;
    }
    if (this.debugEnabled) {
      console.log(pc.gray(`[${this.service}]`), pc.gray(message));
    }
  }
}
