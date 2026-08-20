'use client';

import { env } from './env';

export type WsEventHandler = (data: unknown, event: MessageEvent) => void;

export interface WsClientOptions {
  url?: string;
  protocols?: string | string[];
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  heartbeatInterval?: number;
}

export class WsClient {
  private socket: WebSocket | null = null;
  private handlers = new Map<string, Set<WsEventHandler>>();
  private queue: string[] = [];
  private attempts = 0;
  private closedByUser = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private subscriptions = new Map<string, { channel: string; params?: Record<string, unknown> }>();
  private hasConnected = false;

  constructor(private readonly opts: WsClientOptions = {}) {
    this.opts = {
      reconnect: true,
      reconnectInterval: 1000,
      maxReconnectAttempts: 30,
      heartbeatInterval: 25000,
      ...opts,
    };
  }

  connect() {
    if (typeof window === 'undefined') return;
    this.closedByUser = false;
    const url = this.opts.url || env.wsBaseUrl;
    this.socket = new WebSocket(url, this.opts.protocols);

    this.socket.addEventListener('open', () => {
      const reconnecting = this.hasConnected;
      this.hasConnected = true;
      this.attempts = 0;
      this.flushQueue();
      if (reconnecting) this.replaySubscriptions();
      this.startHeartbeat();
    });

    this.socket.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data?.type && this.handlers.has(data.type)) {
          for (const h of this.handlers.get(data.type)!) h(data.payload ?? data, event);
        }
        if (this.handlers.has('*')) {
          for (const h of this.handlers.get('*')!) h(data, event);
        }
      } catch {
        if (this.handlers.has('*')) {
          for (const h of this.handlers.get('*')!) h(event.data, event);
        }
      }
    });

    this.socket.addEventListener('close', () => {
      this.stopHeartbeat();
      if (!this.closedByUser && this.opts.reconnect) this.scheduleReconnect();
    });

    this.socket.addEventListener('error', () => {
      this.socket?.close();
    });
  }

  close() {
    this.closedByUser = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = null;
  }

  on(type: string, handler: WsEventHandler) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
    return () => this.handlers.get(type)?.delete(handler);
  }

  send(data: unknown) {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(payload);
    } else {
      this.queue.push(payload);
    }
  }

  subscribe(channel: string, params?: Record<string, unknown>) {
    const key = `${channel}:${JSON.stringify(params ?? {})}`;
    this.subscriptions.set(key, { channel, params });
    this.send({ type: 'subscribe', channel, params });
  }

  unsubscribe(channel: string) {
    for (const [key, subscription] of this.subscriptions) {
      if (subscription.channel === channel) this.subscriptions.delete(key);
    }
    this.send({ type: 'unsubscribe', channel });
  }

  private flushQueue() {
    while (this.queue.length && this.socket?.readyState === WebSocket.OPEN) {
      const msg = this.queue.shift()!;
      this.socket.send(msg);
    }
  }

  private replaySubscriptions() {
    for (const { channel, params } of this.subscriptions.values()) {
      this.send({ type: 'subscribe', channel, params });
    }
  }

  private startHeartbeat() {
    if (!this.opts.heartbeatInterval) return;
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'ping', t: Date.now() });
    }, this.opts.heartbeatInterval);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private scheduleReconnect() {
    if (this.attempts >= (this.opts.maxReconnectAttempts || 30)) return;
    const delay = Math.min(30000, (this.opts.reconnectInterval || 1000) * Math.pow(1.6, this.attempts));
    this.attempts += 1;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}

let singleton: WsClient | null = null;
export function getWsClient() {
  if (!singleton) {
    singleton = new WsClient();
    singleton.connect();
  }
  return singleton;
}
