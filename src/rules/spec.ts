// SPEC: protocol and wire conformance (§2.2).
import type { Snapshot } from '../snapshot.js';
import { defineRule, type RawFinding } from './types.js';
import { isObj, isStr, isStrArray, metaOf, toolName, type Obj } from './util/access.js';
import { allExchanges, probeExchange, probeRpc, type RpcView } from './util/obs.js';

const LIFECYCLE_2025 = 'https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle';
const TRANSPORT_2025 = 'https://modelcontextprotocol.io/specification/2025-11-25/basic/transports';
const SHTTP = 'https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http';
const SCHEMA_TS = 'https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts';

const isModernOnly = (s: Snapshot) => s.era === 'modern';
/** 2026-07-28 header-validation codes (-32020 header mismatch, -32021, -32022 unsupported version). */
const MODERN_HEADER_CODES = [-32020, -32021, -32022];
const isModern = (s: Snapshot) => s.era === 'modern' || s.era === 'dual';

export const SPEC_001 = defineRule(
  {
    id: 'SPEC-001', title: 'initialize result shape', severity: { spec: 'error' }, needs: ['legacy'],
    rationale: 'Clients validate the initialize result before anything else.',
    fix: 'Return { protocolVersion: string, capabilities: object, serverInfo } and a string instructions if any.',
    sources: [LIFECYCLE_2025],
  },
  (snap) => {
    const r = snap.initializeRaw;
    if (r === undefined) return [];
    if (!isObj(r)) return [{ message: 'initialize result is not an object' }];
    const out: RawFinding[] = [];
    if (!isStr(r.protocolVersion)) out.push({ message: 'protocolVersion is not a string' });
    if (!isObj(r.capabilities)) out.push({ message: 'capabilities is not an object' });
    if (r.serverInfo === undefined) out.push({ message: 'serverInfo is missing' });
    if (r.instructions !== undefined && !isStr(r.instructions)) out.push({ message: 'instructions is present but not a string' });
    const supported = new Set<string>();
    if (isObj(snap.discoverRaw) && isStrArray(snap.discoverRaw.supportedVersions)) snap.discoverRaw.supportedVersions.forEach((v) => supported.add(v));
    for (const p of ['badVersion', 'badVersionModern'] as const) {
      const d = probeRpc(snap, p)?.error?.data;
      if (isObj(d) && isStrArray(d.supported)) d.supported.forEach((v) => supported.add(v));
    }
    if (isStr(r.protocolVersion) && r.protocolVersion !== '2025-11-25' && supported.has('2025-11-25')) {
      out.push({ message: `answered ${r.protocolVersion} to a 2025-11-25 request although it supports 2025-11-25` });
    }
    return out;
  },
);

export const SPEC_002 = defineRule(
  {
    id: 'SPEC-002', title: 'Capabilities declared for served primitives', severity: { spec: 'error' }, needs: [],
    rationale: 'Clients only call list methods for declared capabilities.',
    fix: 'Declare tools/resources/prompts capabilities for every primitive you serve.',
    sources: ['https://modelcontextprotocol.io/specification/2026-07-28/server/tools#capabilities'],
  },
  (snap) => {
    const caps = snap.capabilities;
    if (!caps) return [];
    const out: RawFinding[] = [];
    const lists: Array<[string, Obj[]]> = [['tools', snap.tools], ['resources', snap.resources], ['prompts', snap.prompts]];
    for (const [key, items] of lists) {
      if (items.length > 0 && caps[key] === undefined) out.push({ message: `${key}/list returns ${items.length} item(s) but capabilities.${key} is absent` });
      const c = caps[key];
      if (isObj(c) && c.listChanged !== undefined && typeof c.listChanged !== 'boolean') {
        out.push({ severity: 'warning', message: `capabilities.${key}.listChanged is not a boolean` });
      }
    }
    return out;
  },
);

function mediaType(ct: string | undefined): string {
  return (ct ?? '').split(';')[0].trim().toLowerCase();
}

export const SPEC_003 = defineRule(
  {
    id: 'SPEC-003', title: 'Request responses use application/json or text/event-stream', severity: { spec: 'error' }, needs: ['http'],
    rationale: 'Streamable HTTP clients reject any other media type.',
    fix: 'Respond to JSON-RPC requests with application/json or text/event-stream.',
    sources: [SHTTP],
  },
  (snap) => {
    if (snap.transport.kind === 'sse') return []; // legacy SSE answers POSTs with 202 and replies on the stream
    const bad = allExchanges(snap).filter(
      (e) => e.method === 'POST' && isObj(e.requestJson) && e.requestJson.id !== undefined && typeof e.requestJson.method === 'string' &&
        e.status !== undefined && e.status >= 200 && e.status < 300 &&
        !['application/json', 'text/event-stream'].includes(mediaType(e.contentType)),
    );
    const seen = new Set<string>();
    return bad.filter((e) => !seen.has(String(e.contentType)) && seen.add(String(e.contentType))).map((e) => ({
      message: `${e.label}: ${e.status} response with Content-Type "${e.contentType ?? '(none)'}"`,
    }));
  },
);

export const SPEC_004 = defineRule(
  {
    id: 'SPEC-004', title: 'Notification POST returns 202 with no body', severity: { spec: 'error' }, needs: ['http', 'legacy'],
    rationale: 'Notifications have no response; the transport requires 202 Accepted.',
    fix: 'Return 202 with an empty body for notifications.',
    sources: [TRANSPORT_2025],
  },
  (snap) => {
    if (snap.transport.kind !== 'streamable-http') return [];
    const ex = snap.transport.exchanges.find((e) => isObj(e.requestJson) && e.requestJson.method === 'notifications/initialized');
    if (!ex?.status || ex.status < 200 || ex.status >= 300) return [];
    if (ex.status === 202 && !(ex.bodySnippet ?? '').trim()) return [];
    return [{ message: ex.status === 202 ? 'notifications/initialized got 202 with a body' : `notifications/initialized got ${ex.status} instead of 202` }];
  },
);

export const SPEC_005 = defineRule(
  {
    id: 'SPEC-005', title: 'GET on the MCP endpoint', severity: { spec: 'warning' }, needs: ['http'],
    rationale: 'GET must open an SSE stream or return 405.',
    fix: 'Return 405 Method Not Allowed for GET if you do not offer a server-initiated stream.',
    sources: [TRANSPORT_2025],
  },
  (snap) => {
    const ex = probeExchange(snap, 'get');
    if (!ex?.status || ex.status === 401 || snap.transport.kind === 'sse') return [];
    const sse = ex.status === 200 && mediaType(ex.contentType) === 'text/event-stream';
    if (isModernOnly(snap)) return ex.status === 405 ? [] : [{ message: `GET returned ${ex.status}; modern servers must return 405` }];
    if (sse || ex.status === 405 || (ex.status === 400 && !snap.transport.sessionId)) return [];
    return [{ message: `GET returned ${ex.status}${ex.contentType ? ` (${ex.contentType})` : ''}; expected 200 text/event-stream or 405` }];
  },
);

function sessionIds(snap: Snapshot): string[] {
  const ids = new Set<string>();
  if (snap.transport.sessionId) ids.add(snap.transport.sessionId);
  for (const e of allExchanges(snap)) {
    const v = e.headers?.['mcp-session-id'];
    if (v !== undefined) ids.add(v);
  }
  return [...ids];
}

export const SPEC_006 = defineRule(
  {
    id: 'SPEC-006', title: 'Mcp-Session-Id format', severity: { spec: 'error' }, needs: ['http'],
    rationale: 'Session ids must be visible ASCII and should be cryptographically random.',
    fix: 'Use a UUID or another long random visible-ASCII token.',
    sources: [TRANSPORT_2025],
  },
  (snap) => {
    const out: RawFinding[] = [];
    for (const id of sessionIds(snap)) {
      if (!/^[\x21-\x7E]+$/.test(id)) out.push({ message: `session id ${JSON.stringify(id.slice(0, 40))} contains non-visible-ASCII characters` });
      else if (id.length < 16) out.push({ severity: 'info', message: `session id is only ${id.length} characters` });
    }
    if (isModernOnly(snap) && sessionIds(snap).length) out.push({ severity: 'warning', message: 'modern-only server mints or echoes Mcp-Session-Id (see SPEC-015)' });
    return out;
  },
);

export const SPEC_007 = defineRule(
  {
    id: 'SPEC-007', title: 'Unsupported protocol version rejected', severity: { spec: 'error' }, needs: ['http'],
    rationale: 'Servers must reject protocol versions they do not support.',
    fix: 'Return 400 (and -32022 with data.supported on 2026-07-28) for an unsupported MCP-Protocol-Version.',
    sources: [SHTTP],
  },
  (snap) => {
    const out: RawFinding[] = [];
    const legacy = probeRpc(snap, 'badVersion');
    if (legacy?.status !== undefined && legacy.status !== 400) {
      out.push({ severity: 'warning', message: `MCP-Protocol-Version: 1900-01-01 was answered with ${legacy.status}, expected 400` });
    }
    const modern = probeRpc(snap, 'badVersionModern');
    if (modern && isModern(snap)) {
      const data = modern.error?.data;
      const ok = modern.status === 400 && modern.error?.code === -32022 && isObj(data) && isStrArray(data.supported);
      if (!ok) out.push({ message: `server/discover with version 1900-01-01 got ${modern.status ?? 'no status'} / code ${String(modern.error?.code)}; expected 400 / -32022 with data.supported` });
    }
    return out;
  },
);

export const SPEC_008 = defineRule(
  {
    id: 'SPEC-008', title: 'Unknown method → -32601', severity: { spec: 'error' }, needs: [],
    rationale: 'JSON-RPC reserves -32601 for "method not found".',
    fix: 'Return error code -32601 (and HTTP 404 on 2026-07-28) for unknown methods.',
    sources: [SHTTP, 'https://www.jsonrpc.org/specification'],
  },
  (snap) => {
    const out: RawFinding[] = [];
    const modern = probeRpc(snap, 'unknownMethodModern');
    if (modern && isModern(snap) && !(modern.status === 404 && modern.error?.code === -32601)) {
      out.push({ message: `unknown method got HTTP ${modern.status ?? '?'} / code ${String(modern.error?.code)}; expected 404 / -32601` });
    }
    const legacy = probeRpc(snap, 'unknownMethod');
    if (legacy && !legacy.transportError && legacy.error?.code !== -32601) {
      out.push({ severity: 'info', message: legacy.error ? `unknown method returned code ${String(legacy.error.code)} instead of -32601 (JSON-RPC deviation)` : 'unknown method returned a result instead of -32601' });
    }
    return out;
  },
);

export const SPEC_009 = defineRule(
  {
    id: 'SPEC-009', title: 'Unknown tool → JSON-RPC protocol error', severity: { spec: 'warning' }, needs: ['tools'],
    rationale: 'Calling a tool that does not exist is a protocol error, not a tool error.',
    fix: 'Throw a JSON-RPC error (-32602) for unknown tool names.',
    sources: ['https://modelcontextprotocol.io/specification/2026-07-28/server/tools#error-handling'],
  },
  (snap) => {
    const v = probeRpc(snap, 'unknownTool');
    // No result (including a -32020..-32022 header rejection of the probe itself) is not a finding.
    if (!v || v.result === undefined) return [];
    const isError = isObj(v.result) && v.result.isError === true;
    return [{ message: `tools/call for a non-existent tool returned a result${isError ? ' with isError' : ''} instead of a JSON-RPC error` }];
  },
);

export const SPEC_010 = defineRule(
  {
    id: 'SPEC-010', title: 'Resource not found → error, never empty contents', severity: { spec: 'error' }, needs: ['resources'],
    rationale: 'Clients cannot tell an empty resource from a missing one.',
    fix: 'Return a JSON-RPC error (-32602) for unknown resource URIs.',
    sources: ['https://modelcontextprotocol.io/specification/2026-07-28/server/resources#error-handling'],
  },
  (snap) => {
    const out: RawFinding[] = [];
    const check = (v: RpcView | undefined, modern: boolean) => {
      if (!v || v.transportError) return;
      if (isObj(v.result) && Array.isArray(v.result.contents) && v.result.contents.length === 0) {
        out.push({ message: 'resources/read of a missing URI returned empty contents instead of an error' });
        return;
      }
      const code = v.error?.code;
      if (!v.error) return;
      // A header-validation code answers our probe's headers, not the missing resource: inconclusive.
      if (modern && MODERN_HEADER_CODES.includes(code as number)) return;
      if (modern && code !== -32602) out.push({ message: `resource-not-found returned code ${String(code)}; expected -32602` });
      if (!modern && code !== -32002 && code !== -32602) out.push({ severity: 'info', message: `resource-not-found returned code ${String(code)}; expected -32002 or -32602` });
    };
    check(probeRpc(snap, 'resourceMissing'), false);
    if (isModern(snap)) check(probeRpc(snap, 'resourceMissingModern'), true);
    return out;
  },
);

export const SPEC_011 = defineRule(
  {
    id: 'SPEC-011', title: 'server/discover result', severity: { spec: 'error' }, needs: ['modern'],
    rationale: 'server/discover replaces initialize in 2026-07-28.',
    fix: 'Return supportedVersions (string[]), capabilities (object) and a string instructions if any.',
    sources: ['https://modelcontextprotocol.io/specification/2026-07-28/server/discover'],
  },
  (snap) => {
    const r = snap.discoverRaw;
    if (!isObj(r)) return [{ message: 'server/discover result is not an object' }];
    const out: RawFinding[] = [];
    if (!isStrArray(r.supportedVersions) || r.supportedVersions.length === 0) out.push({ message: 'supportedVersions is not a non-empty string[]' });
    if (!isObj(r.capabilities)) out.push({ message: 'capabilities is not an object' });
    if (r.instructions !== undefined && !isStr(r.instructions)) out.push({ message: 'instructions is present but not a string' });
    return out;
  },
);

export const SPEC_012 = defineRule(
  {
    id: 'SPEC-012', title: 'resultType on every result', severity: { spec: 'error' }, needs: ['modern'],
    rationale: '2026-07-28 results carry resultType so clients can detect input_required.',
    fix: 'Set resultType: "complete" on every success result.',
    sources: [SCHEMA_TS],
  },
  (snap) => {
    const out: RawFinding[] = [];
    const seen = new Set<string>();
    for (const { method, result } of snap.transport.modernResults ?? []) {
      if (!isObj(result)) continue;
      const rt = result.resultType;
      let f: RawFinding | undefined;
      if (!isStr(rt)) f = { message: `${method} result has no string resultType` };
      else if (rt !== 'complete' && rt !== 'input_required') f = { severity: 'warning', message: `${method} result has unknown resultType "${rt}"` };
      if (f && !seen.has(f.message)) { seen.add(f.message); out.push(f); }
    }
    return out;
  },
);

const CACHEABLE = new Set(['server/discover', 'tools/list', 'prompts/list', 'resources/list', 'resources/templates/list', 'resources/read']);

export const SPEC_013 = defineRule(
  {
    id: 'SPEC-013', title: 'Caching hints on cacheable results', severity: { spec: 'error' }, needs: ['modern'],
    rationale: 'Cacheable results must carry ttlMs and cacheScope.',
    fix: 'Add ttlMs (number >= 0) and cacheScope ("public" | "private") consistently across pages.',
    sources: ['https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching'],
  },
  (snap) => {
    const out: RawFinding[] = [];
    const scopes: Record<string, Set<unknown>> = {};
    const seen = new Set<string>();
    const add = (m: string) => { if (!seen.has(m)) { seen.add(m); out.push({ message: m }); } };
    for (const { method, result } of snap.transport.modernResults ?? []) {
      if (!CACHEABLE.has(method) || !isObj(result) || result.resultType !== 'complete') continue;
      if (typeof result.ttlMs !== 'number' || !Number.isFinite(result.ttlMs) || result.ttlMs < 0) add(`${method}: ttlMs is not a finite number >= 0`);
      if (result.cacheScope !== 'public' && result.cacheScope !== 'private') add(`${method}: cacheScope is not "public" or "private"`);
      (scopes[method] ??= new Set()).add(result.cacheScope);
    }
    for (const [method, set] of Object.entries(scopes)) {
      if (method !== 'resources/read' && method !== 'server/discover' && set.size > 1) add(`${method}: cacheScope differs between pages`);
    }
    return out;
  },
);

export const SPEC_014 = defineRule(
  {
    id: 'SPEC-014', title: 'Header/body mismatch rejected with -32020', severity: { spec: 'error' }, needs: ['modern'],
    rationale: 'Intermediaries route on Mcp-Method; servers must reject mismatches.',
    fix: 'Validate Mcp-Method against the body and return 400 / -32020 on mismatch or absence.',
    sources: ['https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#server-validation'],
  },
  (snap) => {
    const out: RawFinding[] = [];
    for (const [name, label] of [['headerMismatchNone', 'missing Mcp-Method'], ['headerMismatchWrong', 'wrong Mcp-Method']] as const) {
      const v = probeRpc(snap, name);
      if (!v) continue;
      if (!(v.status === 400 && v.error?.code === -32020)) out.push({ message: `${label}: got HTTP ${v.status ?? '?'} / code ${String(v.error?.code)}; expected 400 / -32020` });
    }
    return out;
  },
);

export const SPEC_015 = defineRule(
  {
    id: 'SPEC-015', title: 'No sessions in modern-only servers', severity: { spec: 'warning' }, needs: ['modern'],
    rationale: '2026-07-28 is stateless; sessions belong to earlier revisions.',
    fix: 'Do not mint Mcp-Session-Id; return 405 for GET and DELETE.',
    sources: ['https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#earlier-streamable-http-revisions'],
  },
  (snap) => {
    if (!isModernOnly(snap)) return [];
    const out: RawFinding[] = [];
    if (sessionIds(snap).length) out.push({ message: 'server mints or echoes Mcp-Session-Id' });
    for (const p of ['get', 'delete'] as const) {
      const ex = probeExchange(snap, p);
      if (ex?.status !== undefined && ex.status !== 405) out.push({ message: `${p.toUpperCase()} returned ${ex.status}, expected 405` });
    }
    return out;
  },
);

export const SPEC_016 = defineRule(
  {
    id: 'SPEC-016', title: 'JSON-RPC error codes and ids valid', severity: { spec: 'error' }, needs: [],
    rationale: 'Error codes in the reserved range have defined meanings; ids must echo the request.',
    fix: 'Use integer codes from the spec and echo the request id (or null).',
    sources: ['https://modelcontextprotocol.io/specification/2026-07-28/basic#error-codes', 'https://www.jsonrpc.org/specification'],
  },
  (snap) => {
    const out: RawFinding[] = [];
    const seen = new Set<string>();
    const add = (f: RawFinding) => { if (!seen.has(f.message)) { seen.add(f.message); out.push(f); } };
    for (const e of snap.transport.observedErrors ?? []) {
      const c = e.code;
      // The -32020..-32099 partition and the -32002/-32042 removal are 2026-07-28 policy. 2025-11-25 defines -32042
      // (URL elicitation required) and lets implementations use that range, so legacy responses get only the
      // integer and id checks.
      const modernPath = e.modern ?? snap.era === 'modern';
      if (typeof c !== 'number' || !Number.isInteger(c)) add({ message: `${e.source}: error code ${JSON.stringify(c)} is not an integer` });
      else if (modernPath && (c === -32002 || c === -32042)) add({ message: `${e.source}: 2026-07-28 response uses code ${c}, which that version removed` });
      else if (modernPath && c >= -32099 && c <= -32020 && !MODERN_HEADER_CODES.includes(c)) add({ message: `${e.source}: error code ${c} is in the reserved range` });
      if (e.requestId !== undefined && e.responseId !== e.requestId && e.responseId !== null) {
        add({ severity: 'warning', message: `${e.source}: response id ${JSON.stringify(e.responseId)} does not match request id ${JSON.stringify(e.requestId)}` });
      }
    }
    return out;
  },
);

const ICON_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml', 'image/webp']);

export const SPEC_017 = defineRule(
  {
    id: 'SPEC-017', title: 'Icons well-formed', severity: { spec: 'warning' }, needs: [],
    rationale: 'Hosts drop malformed icons.',
    fix: 'Use https: or data:image/...;base64 src, an image mimeType (png, jpeg, svg+xml or webp render everywhere), sizes like "48x48" and theme light|dark.',
    sources: [SCHEMA_TS],
  },
  (snap) => {
    const out: RawFinding[] = [];
    const owners: Array<[string, unknown, Partial<RawFinding>]> = [['serverInfo', snap.serverInfo, {}]];
    for (const t of snap.tools) owners.push([`tool ${toolName(t)}`, t, { tool: toolName(t) }]);
    for (const r of snap.resources) owners.push([`resource ${String(r.uri)}`, r, { resource: String(r.uri) }]);
    for (const p of snap.prompts) owners.push([`prompt ${String(p.name)}`, p, {}]);
    for (const [label, owner, extra] of owners) {
      if (!isObj(owner) || owner.icons === undefined) continue;
      if (!Array.isArray(owner.icons)) { out.push({ ...extra, message: `${label}: icons is not an array` }); continue; }
      owner.icons.forEach((icon, i) => {
        const where = `${label} icons[${i}]`;
        if (!isObj(icon)) return out.push({ ...extra, message: `${where} is not an object` });
        const src = icon.src;
        // The schema allows any HTTP/HTTPS URL or a base64 data: URI; http: is valid but hosts may refuse to load it.
        if (isStr(src) && /^http:\/\//i.test(src)) out.push({ ...extra, severity: 'info', message: `${where}: src uses http:; hosts may not load insecure icons` });
        else if (!isStr(src) || !(/^https:\/\//i.test(src) || /^data:image\/[\w.+-]+;base64,/i.test(src))) {
          out.push({ ...extra, message: `${where}: src is neither an HTTP(S) URL nor data:image/...;base64` });
        }
        // The schema lists MIME types only as examples: another image/* type is valid, but hosts may not render it.
        const mime = isStr(icon.mimeType) ? icon.mimeType.toLowerCase() : undefined;
        if (icon.mimeType !== undefined && !(mime && ICON_MIME.has(mime))) {
          if (mime?.startsWith('image/')) out.push({ ...extra, severity: 'info', message: `${where}: mimeType ${JSON.stringify(icon.mimeType)} may not be rendered by hosts (common: png, jpeg, svg+xml, webp)` });
          else out.push({ ...extra, message: `${where}: mimeType ${JSON.stringify(icon.mimeType)} is not an image type` });
        }
        if (icon.sizes !== undefined) {
          const sizes = Array.isArray(icon.sizes) ? icon.sizes : [icon.sizes];
          const bad = sizes.filter((s) => !(isStr(s) && /^(\d+x\d+|any)$/.test(s)));
          if (bad.length) out.push({ ...extra, message: `${where}: invalid sizes ${JSON.stringify(bad)}` });
        }
        if (icon.theme !== undefined && icon.theme !== 'light' && icon.theme !== 'dark') out.push({ ...extra, message: `${where}: theme must be light or dark` });
        return 0;
      });
    }
    return out;
  },
);

const META_ALLOW = new Set([
  'io.modelcontextprotocol/serverInfo', 'io.modelcontextprotocol/protocolVersion', 'io.modelcontextprotocol/clientInfo',
  'io.modelcontextprotocol/clientCapabilities', 'io.modelcontextprotocol/subscriptionId', 'io.modelcontextprotocol/ui',
  // 2025-11-25 tasks and logging
  'io.modelcontextprotocol/related-task', 'io.modelcontextprotocol/logLevel',
]);
const META_NAME = /^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const META_LABEL = /^[A-Za-z]([A-Za-z0-9-]*[A-Za-z0-9])?$/;

/** Official extensions add keys under io.modelcontextprotocol/, so an unknown key there is only an observation. */
export const OFFICIAL_META_PREFIX = 'io.modelcontextprotocol/';

export function metaKeyProblem(key: string): string | undefined {
  if (key === 'ui' || key.startsWith('openai/') || key === 'mcp/www_authenticate') return undefined;
  const slash = key.indexOf('/');
  const prefix = slash >= 0 ? key.slice(0, slash) : undefined;
  const name = slash >= 0 ? key.slice(slash + 1) : key;
  if (prefix !== undefined) {
    const labels = prefix.split('.');
    if (labels.some((l) => !META_LABEL.test(l))) return 'invalid prefix label';
    if ((labels[1] === 'modelcontextprotocol' || labels[1] === 'mcp') && !META_ALLOW.has(key)) return 'reserved prefix';
  }
  if (!META_NAME.test(name)) return 'invalid name';
  return undefined;
}

export const SPEC_018 = defineRule(
  {
    id: 'SPEC-018', title: '_meta key syntax and reserved prefixes', severity: { spec: 'warning' }, needs: [],
    rationale: '_meta keys follow a reverse-DNS prefix/name syntax; MCP prefixes are reserved.',
    fix: 'Use your own reverse-DNS prefix, e.g. com.example/key.',
    sources: [SCHEMA_TS],
  },
  (snap) => {
    const out: RawFinding[] = [];
    const seen = new Set<string>();
    const scan = (owner: unknown, label: string, extra: Partial<RawFinding>) => {
      for (const key of Object.keys(metaOf(owner))) {
        const problem = metaKeyProblem(key);
        if (!problem) continue;
        const official = problem === 'reserved prefix' && key.startsWith(OFFICIAL_META_PREFIX);
        const msg = official
          ? `${label}: _meta key "${key}" is not defined by the core spec (it may come from an official extension)`
          : `${label}: _meta key "${key}" (${problem})`;
        if (!seen.has(msg)) { seen.add(msg); out.push({ ...extra, message: msg, ...(official ? { severity: 'info' as const } : {}) }); }
      }
    };
    for (const t of snap.tools) scan(t, `tool ${toolName(t)}`, { tool: toolName(t) });
    for (const r of snap.resources) scan(r, `resource ${String(r.uri)}`, { resource: String(r.uri) });
    for (const p of snap.prompts) scan(p, `prompt ${String(p.name)}`, {});
    for (const [method, m] of Object.entries(snap.listMeta)) for (const page of m.rawPages) scan(page, `${method} result`, {});
    for (const [uri, r] of Object.entries(snap.resourceReads)) {
      scan(r.raw, `resources/read ${uri}`, { resource: uri });
      if (isObj(r.raw) && Array.isArray(r.raw.contents)) for (const c of r.raw.contents) scan(c, `resources/read ${uri} content`, { resource: uri });
    }
    return out;
  },
);

export const SPEC_019 = defineRule(
  {
    id: 'SPEC-019', title: 'SSE responses disable proxy buffering', severity: { spec: 'info' }, needs: ['http'],
    rationale: 'Reverse proxies buffer SSE unless told otherwise, delaying messages.',
    fix: 'Send X-Accel-Buffering: no on text/event-stream responses.',
    sources: [SHTTP],
  },
  (snap) => {
    const hit = allExchanges(snap).find((e) => mediaType(e.contentType) === 'text/event-stream' && (e.headers?.['x-accel-buffering'] ?? '').toLowerCase() !== 'no');
    return hit ? [{ message: `${hit.label}: text/event-stream response without X-Accel-Buffering: no` }] : [];
  },
);

// resources/templates/list is left out: many servers with the resources capability do not implement it.
const LIST_CAPS: Array<[string, string, string]> = [
  ['tools', 'tools', 'tools/list'], ['resources', 'resources', 'resources/list'], ['prompts', 'prompts', 'prompts/list'],
];

export const SPEC_020 = defineRule(
  {
    id: 'SPEC-020', title: 'List methods for declared capabilities succeed', severity: { spec: 'error', claude: 'error', chatgpt: 'error' }, needs: [],
    rationale: 'A server that declares a capability must answer its list method; when tools/list fails no host can use the server and no tool check can run.',
    fix: 'Make the list method answer with a result (check errors, crashes, timeouts and pagination loops).',
    sources: ['https://modelcontextprotocol.io/specification/2026-07-28/server/tools#listing-tools', 'https://modelcontextprotocol.io/specification/2026-07-28/server/resources#listing-resources'],
  },
  (snap) => {
    const caps = snap.capabilities ?? {};
    const out: RawFinding[] = [];
    for (const [metaKey, cap, method] of LIST_CAPS) {
      const err = snap.listMeta[metaKey]?.error;
      if (!err) continue;
      const declared = caps[cap] !== undefined || (cap === 'tools' && snap.era === 'modern');
      if (declared) out.push({ message: `${method} failed: ${err}` });
    }
    return out;
  },
);

export const specRules = [
  SPEC_001, SPEC_002, SPEC_003, SPEC_004, SPEC_005, SPEC_006, SPEC_007, SPEC_008, SPEC_009, SPEC_010,
  SPEC_011, SPEC_012, SPEC_013, SPEC_014, SPEC_015, SPEC_016, SPEC_017, SPEC_018, SPEC_019, SPEC_020,
];
