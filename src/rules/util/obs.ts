// Accessors over recorded HTTP exchanges and JSON-RPC observations.
import type { HttpExchange, JsonRpcObservation, ProbeObservation, Snapshot, WireProbeName } from '../../snapshot.js';
import { isObj } from './access.js';

export function isExchange(o: ProbeObservation | undefined): o is HttpExchange {
  return !!o && (o as JsonRpcObservation).kind !== 'jsonrpc';
}

export function probeExchange(snap: Snapshot, name: WireProbeName): HttpExchange | undefined {
  const o = snap.transport.probes[name];
  return isExchange(o) ? o : undefined;
}

/** Every HTTP exchange the run recorded (SDK traffic, probes, auth probe). */
export function allExchanges(snap: Snapshot): HttpExchange[] {
  const list: HttpExchange[] = [...snap.transport.exchanges];
  if (snap.transport.preflight) list.push(snap.transport.preflight);
  for (const o of Object.values(snap.transport.probes)) if (isExchange(o)) list.push(o);
  const a = snap.authProbe;
  if (a) {
    list.push(...a.prmAttempts);
    for (const as of a.as) list.push(...as.attempts);
    if (a.invalidToken) list.push(a.invalidToken);
  }
  const uniq = new Set<HttpExchange>();
  return list.filter((e) => (uniq.has(e) ? false : (uniq.add(e), true)));
}

export interface RpcView {
  status?: number;
  result?: unknown;
  error?: { code?: unknown; message?: unknown; data?: unknown };
  responseId?: unknown;
  requestId?: unknown;
  transportError?: string;
}

/** Normalize a probe (raw HTTP exchange or SDK observation) into a JSON-RPC view. */
export function rpcView(o: ProbeObservation | undefined): RpcView | undefined {
  if (!o) return undefined;
  if (!isExchange(o)) {
    return { result: o.result, error: o.error, responseId: o.responseId, requestId: o.requestId, transportError: o.transportError };
  }
  const json = Array.isArray(o.json) ? o.json[0] : o.json;
  const view: RpcView = { status: o.status, requestId: isObj(o.requestJson) ? o.requestJson.id : undefined };
  if (isObj(json)) {
    view.responseId = json.id;
    if ('result' in json) view.result = json.result;
    if (isObj(json.error)) view.error = json.error as RpcView['error'];
  }
  if (o.error) view.transportError = o.error.message;
  return view;
}

export function probeRpc(snap: Snapshot, name: WireProbeName): RpcView | undefined {
  return rpcView(snap.transport.probes[name]);
}

// ---------- transient failures (retried probes) ----------

const TRANSIENT_CODES = new Set([
  'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'ECONNABORTED', 'ESOCKETTIMEDOUT',
  'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_CLOSED',
]);
/** A network-level code that says nothing about the server's configuration (timeouts, resets, temporary DNS). */
export function isTransientCode(code: string | number | undefined): boolean {
  return TRANSIENT_CODES.has(String(code ?? ''));
}

export const timedOut = (ex: HttpExchange) => ex.error?.name === 'AbortError' || ex.error?.name === 'TimeoutError' || /timed? ?out/i.test(String(ex.error?.causeCode ?? ''));

/** A failure worth retrying: timeout, reset, 429, or a 5xx other than 501/505. */
export function isTransient(ex: HttpExchange): boolean {
  if (ex.error) return timedOut(ex) || isTransientCode(ex.error.causeCode ?? ex.error.code);
  return ex.status === 429 || (ex.status !== undefined && ex.status >= 500 && ex.status !== 501 && ex.status !== 505);
}

/** "503, 503, ETIMEDOUT": one status (or error code) per attempt. */
export function attemptStatus(ex: HttpExchange): string {
  if (ex.status !== undefined) return String(ex.status);
  if (timedOut(ex)) return 'timeout';
  return String(ex.error?.causeCode ?? ex.error?.code ?? ex.error?.name ?? 'error');
}

/** Attempts grouped by URL in request order (retries of one URL are consecutive). */
export function attemptsByUrl(attempts: HttpExchange[]): Array<{ url: string; attempts: HttpExchange[] }> {
  const out: Array<{ url: string; attempts: HttpExchange[] }> = [];
  for (const e of attempts) {
    const g = out[out.length - 1];
    if (g && g.url === e.url) g.attempts.push(e);
    else out.push({ url: e.url, attempts: [e] });
  }
  return out;
}

/** "https://a/x: 503, 503, timeout; https://a/y: 404". */
export function describeAttempts(attempts: HttpExchange[]): string {
  return attemptsByUrl(attempts).map((g) => `${g.url}: ${g.attempts.map(attemptStatus).join(', ')}`).join('; ');
}

/** Some URL's final attempt failed transiently: its absence is not established. */
export function endedTransient(attempts: HttpExchange[]): boolean {
  return attemptsByUrl(attempts).some((g) => isTransient(g.attempts[g.attempts.length - 1]));
}

export const INCONCLUSIVE = 'inconclusive (network)';

