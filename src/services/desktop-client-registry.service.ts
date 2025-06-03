import { injectable, singleton } from 'tsyringe';
import type { Socket } from 'net';

@singleton()
@injectable()
export class DesktopClientRegistryService {
  private readonly active = new Set<Socket>();

  private readonly onUnixClientsChangedListeners: Array<(count: number) => void> = [];

  addUnixClientsChangedListener (listener: (count: number) => void) {
    this.onUnixClientsChangedListeners.push(listener);
  }

  add (socket: Socket): void {
    this.active.add(socket);
    this.onUnixClientsChangedListeners.forEach(listener => { listener(this.active.size); });
  }

  remove (socket: Socket): void {
    this.active.delete(socket);
    this.onUnixClientsChangedListeners.forEach(listener => { listener(this.active.size); });
  }

  get count (): number {
    return this.active.size;
  }
}
