import type { ClientMsg, ServerMsg } from '../../../shared/protocol';

export class NetClient {
  private ws: WebSocket | null = null;
  connected = false;
  onMessage: ((msg: ServerMsg) => void) | null = null;
  onDisconnect: (() => void) | null = null;

  connect(name: string, house: number): Promise<boolean> {
    return new Promise((resolve) => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${window.location.host}/ws`;
      let settled = false;
      try {
        const ws = new WebSocket(url);
        this.ws = ws;
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            ws.close();
            resolve(false);
          }
        }, 2500);

        ws.onopen = () => {
          clearTimeout(timer);
          this.connected = true;
          this.send({ t: 'hello', name, house });
          if (!settled) {
            settled = true;
            resolve(true);
          }
        };

        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(String(ev.data)) as ServerMsg;
            this.onMessage?.(msg);
          } catch {
            /* ignore malformed payload */
          }
        };

        ws.onerror = () => {
          clearTimeout(timer);
          if (!settled) {
            settled = true;
            resolve(false);
          }
        };

        ws.onclose = () => {
          this.connected = false;
          this.onDisconnect?.();
          if (!settled) {
            settled = true;
            resolve(false);
          }
        };
      } catch {
        resolve(false);
      }
    });
  }

  send(msg: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }
}

