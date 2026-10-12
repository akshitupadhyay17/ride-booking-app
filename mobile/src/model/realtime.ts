import { WS_URL } from './config';
import type { ServerEvent } from './types';

type Handler = (e: ServerEvent) => void;

/** MODEL: WebSocket connection with auto-reconnect. Used for ride events (rider+driver) and driver telemetry. */
export class RealtimeClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private token: string | null = null;
  private retry = 0;
  private closed = true;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  onStatus: (connected: boolean) => void = () => {};

  on(h: Handler) { this.handlers.add(h); return () => { this.handlers.delete(h); }; }

  connect(token: string) {
    this.token = token; this.closed = false; this.open();
  }
  private open() {
    if (this.closed || !this.token) return;
    try { this.ws?.close(); } catch {}
    const ws = new WebSocket(`${WS_URL}?token=${this.token}`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0; this.onStatus(true);
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.send({ type: 'ping' }), 25000);
    };
    ws.onmessage = (m) => {
      try { const ev = JSON.parse(String(m.data)) as ServerEvent; this.handlers.forEach((h) => h(ev)); } catch {}
    };
    ws.onclose = () => {
      this.onStatus(false);
      if (this.pingTimer) clearInterval(this.pingTimer);
      if (!this.closed) {
        const delay = Math.min(10000, 500 * 2 ** this.retry++);
        this.timer = setTimeout(() => this.open(), delay);
      }
    };
    ws.onerror = () => {};
  }
  send(msg: object) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
  get connected() { return !!this.ws && this.ws.readyState === WebSocket.OPEN; }
  close() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    try { this.ws?.close(); } catch {}
    this.ws = null;
  }
}
