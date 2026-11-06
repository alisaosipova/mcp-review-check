// Transport wrapper that records JSON-RPC traffic seen by the SDK client.
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { ObservedError } from '../snapshot.js';
import { isObj } from '../rules/util/access.js';

export const TRANSPORT_ERRORS_KEPT = 20;
/** Unsolicited responses (an id that answers no pending request): ids kept in the summary, and error entries kept
 *  for the SPEC-016 code checks. The count is exact; a flood adds nothing else (C-02). */
export const UNSOLICITED_IDS_KEPT = 5;

export class RecordingTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  readonly pending = new Map<unknown, string>(); // id -> method, until the response arrives
  /** When each pending request was sent. */
  private readonly sentAt = new Map<unknown, number>();
  /** Time from send(id) to the result with that id, per method. On legacy HTTP+SSE the POST only gets 202 and the
   *  result arrives on the GET stream, so this is the latency the tracer cannot see (SRV-010). Errors are not sampled. */
  readonly latencies: Record<string, number[]> = {};
  /** The clock for `latencies` (tests inject one). */
  now: () => number = () => performance.now();
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
    if (typeof m.method === 'string' && m.id !== undefined) { this.pending.set(m.id, m.method); this.sentAt.set(m.id, this.now()); }
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

  /** The summary entry in `errors` for responses that answered no pending request; created on the first one. */
  private unsolicited?: { count: number; ids: unknown[] };

  private record(message: JSONRPCMessage): void {
    const m = message as unknown as Record<string, unknown>;
    if (m.method !== undefined) return; // server request or notification
    // A response whose id no request of ours is waiting for: never sent, or answered before (C-02). An error with id
    // null or no id is not counted: JSON-RPC and the transport page allow it when the request id is unknown (C-01).
    if (!this.pending.has(m.id) && m.id !== null && m.id !== undefined) {
      if (!this.unsolicited) {
        this.unsolicited = { count: 0, ids: [] };
        this.errors.push({ source: 'unsolicited responses', unsolicited: this.unsolicited });
      }
      const u = this.unsolicited;
      u.count++;
      if (u.ids.length < UNSOLICITED_IDS_KEPT) {
        u.ids.push(typeof m.id === 'string' ? m.id.slice(0, 64) : m.id);
        if (isObj(m.error)) this.errors.push({ source: 'unsolicited response', responseId: m.id, code: m.error.code, message: m.error.message });
      }
      return;
    }
    const method = this.pending.get(m.id);
    const sent = this.sentAt.get(m.id);
    this.pending.delete(m.id);
    this.sentAt.delete(m.id);
    if (method && sent !== undefined && 'result' in m) (this.latencies[method] ??= []).push(this.now() - sent);
    if (method === 'initialize' && 'result' in m) this.initializeRaw = m.result;
    if (isObj(m.error)) {
      this.errors.push({ source: method ?? 'response', requestId: method ? m.id : undefined, responseId: m.id, code: m.error.code, message: m.error.message });
    }
  }
}
