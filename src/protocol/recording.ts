// Transport wrapper that records JSON-RPC traffic seen by the SDK client.
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { ObservedError } from '../snapshot.js';
import { isObj } from '../rules/util/access.js';

export const TRANSPORT_ERRORS_KEPT = 20;

export class RecordingTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  readonly pending = new Map<unknown, string>(); // id -> method, until the response arrives
  readonly errors: ObservedError[] = [];
  /** The first TRANSPORT_ERRORS_KEPT transport error messages; the SDK reports one per unparsable stdout line,
   *  so a server that logs to stdout would otherwise pile up an Error (with its stack) per line until the heap runs out. */
  readonly transportErrors: string[] = [];
  /** Every transport error, kept or not. */
  transportErrorCount = 0;
  /** The SDK's read buffer overflowed (a stdio message over its maxBufferSize): the transport closed on it. */
  overflow?: string;
  initializeRaw?: unknown;

  constructor(readonly inner: Transport, private onStart?: () => void) {}

  get sessionId(): string | undefined {
    return this.inner.sessionId;
  }

  async start(): Promise<void> {
    this.inner.onmessage = (m) => { this.record(m); this.onmessage?.(m); };
    this.inner.onerror = (e) => { this.noteError(e); this.onerror?.(e); };
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

  private noteError(e: Error): void {
    const message = String(e?.message ?? e);
    if (this.transportErrors.length < TRANSPORT_ERRORS_KEPT) this.transportErrors.push(message.slice(0, 1024));
    this.transportErrorCount++;
    if (/ReadBuffer exceeded/.test(message)) this.overflow ??= message;
  }

  private record(message: JSONRPCMessage): void {
    const m = message as unknown as Record<string, unknown>;
    if (m.method !== undefined) return; // server request or notification
    const method = this.pending.get(m.id);
    this.pending.delete(m.id);
    if (method === 'initialize' && 'result' in m) this.initializeRaw = m.result;
    if (isObj(m.error)) {
      this.errors.push({ source: method ?? 'response', requestId: method ? m.id : undefined, responseId: m.id, code: m.error.code, message: m.error.message });
    }
  }
}
