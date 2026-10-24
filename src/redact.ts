// Secret redaction: one Redactor per run covers HTTP credentials and stdio argv/env secrets, and the
// finished Report is scrubbed in one place before any format renders it.
import { createRedactor, scrub, type Redactor } from './protocol/trace.js';
import { isKnownToken, isSecretName } from './rules/util/net.js';

export type { Redactor } from './protocol/trace.js';
export { scrub } from './protocol/trace.js';
export { isSecretName } from './rules/util/net.js';

/** Header names whose value is a credential when they appear as "Name: value" in argv (mcp-remote --header ...). */
const SECRET_HEADER = /^(authorization|proxy-authorization|cookie|x-api-key|api-key|x-auth-token|[\w-]*(token|secret|key))$/i;
/** Values never treated as secrets on their own: they would blank out unrelated report text, or, as protocol and schema words, server data (R-8). */
const TRIVIAL = /^(true|false|yes|no|on|off|null|undefined|none|\d{1,6}(\.\d+)?|object|string|number|integer|array|boolean|type|title|name|description|properties|required|items|enum|const|default|format|pattern|anyOf|oneOf|allOf|\$ref|\$schema|\$defs|uri|mimeType|text|image|audio|resource|resource_link|json|html|plain|xml|application)$/i;

/** A percent-decoded URL part, or the part as written when its escapes are malformed. */
const decoded = (part: string) => { try { return decodeURIComponent(part); } catch { return part; } };

/** A value that is a credential by its form alone (R-8): a known token format, or 16+ characters with letters and digits. */
const tokenLike = (v: string) => isKnownToken(v) || (v.length >= 16 && /[a-z]/i.test(v) && /\d/.test(v));

/**
 * Credentials inside a URL, decoded and as written ("+", %2f): query and fragment parameters with a secret name or a
 * value in a known token format, path segments in a known token format, the password and the username of user:pass@ (R-9).
 * `strongOnly` (R-8): the username only when it looks like a token, as a plain one is often a word ("postgres", "admin").
 */
export function urlSecrets(raw: string, strongOnly = false): string[] {
  try {
    const u = new URL(raw);
    // URLSearchParams has one entry per non-empty "&" part; the raw value differs from the decoded one on "+" or %2f.
    const out = [u.search, u.hash].flatMap((s) => {
      const parts = s.slice(1).split('&').filter(Boolean);
      return [...new URLSearchParams(s.slice(1))].flatMap(([k, v], i) => {
        const raw = parts[i]?.split(/=(.*)/s)[1] ?? '';
        return !isSecretName(k) && !isKnownToken(v) ? [] : raw && raw !== v ? [v, raw] : [v];
      });
    });
    out.push(...u.pathname.split('/').filter(isKnownToken));
    if (u.password) out.push(u.password, decoded(u.password));
    // A username shorter than 4 characters is never a secret (createRedactor); TRIVIAL values are dropped in buildRedactor.
    if (u.username.length >= 4 && (!strongOnly || tokenLike(decoded(u.username)))) out.push(u.username, decoded(u.username));
    return out;
  } catch {
    return [];
  }
}

/** A secret value, plus the token after an auth scheme ("Bearer X"). */
function withSchemeToken(value: string): string[] {
  const v = value.trim();
  const token = /^(bearer|basic|token|dpop)\s+(.+)$/is.exec(v)?.[2];
  return token ? [v, token] : [v];
}

/** The secret part of a "Name: value" header string, plus the token after an auth scheme. */
function headerSecrets(name: string, value: string): string[] {
  return SECRET_HEADER.test(name.trim()) || isSecretName(name.trim()) ? withSchemeToken(value) : [];
}

/**
 * Secret values in a stdio argv: the value after a secret-looking flag (`--api-key X`, `--api-key=X`),
 * `KEY=value` with a secret-looking KEY, credentials inside URLs, and "Authorization: Bearer X" header args.
 */
export function argvSecrets(args: string[], strongOnly = false): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const eq = /^(-{1,2}[\w.-]+|[A-Za-z_][\w.-]*)=(.+)$/s.exec(a);
    if (eq && isSecretName(eq[1])) out.push(...withSchemeToken(eq[2]));
    else if (/^-{1,2}[\w.-]+$/.test(a) && isSecretName(a) && i + 1 < args.length && !args[i + 1].startsWith('--')) out.push(...withSchemeToken(args[++i]));
    const header = /^([\w-]+)\s*:\s*(.+)$/s.exec(a.replace(/^-{1,2}[\w.-]+=/, ''));
    if (header && !a.includes('://')) out.push(...headerSecrets(header[1], header[2]));
    if (a.includes('://')) out.push(...urlSecrets(a.replace(/^[^=]*=(?=\w+:\/\/)/, ''), strongOnly));
    else if (isKnownToken(a)) out.push(a);
  }
  return out;
}

export interface RedactionInput {
  url?: string;
  bearer?: string;
  headers?: Record<string, string>;
  /** stdio command and arguments. */
  argv?: string[];
  /** --env values for the stdio server. */
  env?: Record<string, string>;
}

/**
 * A Redactor for a run: --bearer, --header values, URL credentials, argv secrets and --env values. strongOnly (R-8): an
 * --env value under a secret name only, and a URL username or a part of an --env value under a plain name (the token
 * after "Bearer", URL credentials) only when it looks like a token; the full set, for the finished report, has them all.
 */
export function buildRedactor(input: RedactionInput, strongOnly = false): Redactor {
  const headers = input.headers ?? {};
  const values: string[] = [];
  if (input.bearer) values.push(input.bearer);
  for (const [k, v] of Object.entries(headers)) values.push(v, ...headerSecrets(k, v).slice(1));
  if (input.url) values.push(...urlSecrets(input.url, strongOnly));
  for (const [k, v] of Object.entries(input.env ?? {})) {
    const parts = [...withSchemeToken(v).slice(1), ...urlSecrets(v, strongOnly)];
    values.push(...(!strongOnly || isSecretName(k) ? parts : parts.filter(tokenLike)));
  }
  if (input.argv) values.push(...argvSecrets(input.argv, strongOnly));
  for (const [k, v] of Object.entries(input.env ?? {})) if (!strongOnly || isSecretName(k)) values.push(v);
  return createRedactor(Object.keys(headers), values.map((v) => v.trim()).filter((v) => v && !TRIVIAL.test(v)));
}

const isPlain = (v: object) => {
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

/**
 * Fields that hold what the server sent: it may echo a secret into a key there, so keys below them are masked too.
 * Not capabilities, initializeRaw or discoverRaw: their keys are protocol names the rules look up and never quote.
 */
const SERVER_DATA = new Set(['serverInfo', 'instructions', 'tools', 'resources', 'resourceTemplates', 'prompts', 'toolsWithoutUi', 'rawPages', 'raw', 'json', 'result', 'jsonRpcError', 'args', 'headers', 'parsed', 'data']);
/** Maps keyed by a value the server chose (resource URIs): their keys are masked, their entries are the snapshot's own. */
const SERVER_KEYED = new Set(['resourceReads']);
/** What the server sent under protocol-named keys: keys stay, but every value is masked, the own vocabulary included. */
const SERVER_VALUES = new Set(['capabilities', 'initializeRaw', 'discoverRaw', ...SERVER_KEYED]);
/** The report's own vocabulary (severities, platforms, verdicts, the gate texts) outside server data: renderers compare these values. */
const OWN_VOCABULARY = new Set(['ruleId', 'severity', 'platforms', 'severityByPlatform', 'verdict', 'failOn', 'toolLevel', 'era', 'kind', 'role', 'gate']);

/**
 * A deep copy of `value` with every secret replaced in strings and URL objects; no recursion, so any depth works.
 * Field names of the snapshot and the report and their own vocabulary stay (a secret like "error" must not rename
 * summary.errors or a severity); keys are masked only inside server data (keys: 0 none, 1 this object's own, 2 the subtree).
 * Inside what the server sent (`srv`) no value is kept as own vocabulary.
 */
export function redactDeep<T>(value: T, r: Redactor): T {
  if (!r.values.size) return value;
  const seen = new Map<object, unknown>();
  const pending: (() => void)[] = [];
  // Copies one level: containers come back empty and are filled from `pending`, so deep data never grows the call stack.
  const copy = (v: unknown, keys = 0, own = false, srv = false): unknown => {
    if (typeof v === 'string') return own ? v : scrub(v, r);
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) return seen.get(v);
    if (v instanceof URL) {
      let u: URL = v;
      try { u = new URL(scrub(v.href, r)); } catch { /* keep */ }
      seen.set(v, u);
      return u;
    }
    if (Array.isArray(v)) {
      const out: unknown[] = [];
      seen.set(v, out);
      pending.push(() => { for (const x of v) out.push(copy(x, keys, own, srv)); });
      return out;
    }
    if (!isPlain(v)) return v;
    const out: Record<string, unknown> = {};
    seen.set(v, out);
    pending.push(() => {
      for (const [k, x] of Object.entries(v)) {
        const s = srv || keys === 2 || SERVER_VALUES.has(k);
        const key = keys ? scrub(k, r) : k, val = copy(x, keys === 2 || SERVER_DATA.has(k) ? 2 : SERVER_KEYED.has(k) ? 1 : 0, !s && (own || OWN_VOCABULARY.has(k)), s);
        // A "__proto__" key the server sent is data: a plain assignment would set the copy's prototype instead (R-10).
        if (key === '__proto__') Object.defineProperty(out, key, { value: val, enumerable: true, writable: true, configurable: true });
        else out[key] = val;
      }
    });
    return out;
  };
  const root = copy(value);
  while (pending.length) pending.pop()!();
  return root as T;
}
