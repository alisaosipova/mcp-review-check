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

export const INCONCLUSIVE = 'inconclusive (network)';

