// Transport wrapper that records JSON-RPC traffic seen by the SDK client.
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { ObservedError } from '../snapshot.js';
import { isObj } from '../rules/util/access.js';

export class RecordingTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  readonly pending = new Map<unknown, string>(); // id -> method
  readonly errors: ObservedError[] = [];
  readonly transportErrors: Error[] = [];
  initializeRaw?: unknown;

  constructor(readonly inner: Transport, private onStart?: () => void) {}

  get sessionId(): string | undefined {
    return this.inner.sessionId;
  }

  async start(): Promise<void> {
    this.inner.onmessage = (m) => { this.record(m); this.onmessage?.(m); };
    this.inner.onerror = (e) => { this.transportErrors.push(e); this.onerror?.(e); };
    this.inner.onclose = () => this.onclose?.();
    await this.inner.start();
    this.onStart?.();
  }

  async send(message: JSONRPCMessage, options?: Parameters<Transport['send']>[1]): Promise<void> {
    const m = message as unknown as Record<string, unknown>;
    if (typeof m.method === 'string' && m.id !== undefined) this.pending.set(m.id, m.method);
    return this.inner.send(message, options);
  }

  async close(): Promise<void> {
    return this.inner.close();
  }

  setProtocolVersion(version: string): void {
    this.inner.setProtocolVersion?.(version);
  }

  private record(message: JSONRPCMessage): void {
    const m = message as unknown as Record<string, unknown>;
    if (m.method !== undefined) return; // server request or notification
    const method = this.pending.get(m.id);
    if (method === 'initialize' && 'result' in m) this.initializeRaw = m.result;
    if (isObj(m.error)) {
      this.errors.push({ source: method ?? 'response', requestId: method ? m.id : undefined, responseId: m.id, code: m.error.code, message: m.error.message });
    }
  }
}
