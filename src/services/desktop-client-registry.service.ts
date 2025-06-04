import { injectable, singleton } from 'tsyringe';
import type { Socket } from 'net';

export type AvailableApis = 'onOpenFile' | 'onOpenElement';

@singleton()
@injectable()
export class DesktopClientRegistryService {
  private readonly activeSocketsWithUtilizedApis = new Map<Socket, AvailableApis[]>();

  private readonly onUnixClientsChangedListeners: Array<() => void> = [];

  addUnixClientsChangedListener (listener: () => void) {
    this.onUnixClientsChangedListeners.push(listener);
  }

  add (socket: Socket): void {
    this.activeSocketsWithUtilizedApis.set(socket, []);
    this.onUnixClientsChangedListeners.forEach(listener => { listener(); });
  }

  addApis (socket: Socket, apis: AvailableApis[]): void {
    const existingApis = this.activeSocketsWithUtilizedApis.get(socket) ?? [];
    for (const newApi of apis) {
      if (!existingApis.includes(newApi)) {
        existingApis.push(newApi);
      }
    }
    this.onUnixClientsChangedListeners.forEach(listener => { listener(); });
  }

  remove (socket: Socket): void {
    this.activeSocketsWithUtilizedApis.delete(socket);
    this.onUnixClientsChangedListeners.forEach(listener => { listener(); });
  }

  count (): number {
    return this.activeSocketsWithUtilizedApis.size;
  }

  utilizedApis (): AvailableApis[] {
    return Array.from(
      new Set(
        Array.from(this.activeSocketsWithUtilizedApis.values()).flatMap(v => v)
      )
    ).sort();
  }
}
