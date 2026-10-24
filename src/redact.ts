// Secret redaction: one Redactor per run covers HTTP credentials and stdio argv/env secrets, and the
// finished Report is scrubbed in one place before any format renders it.
import { createRedactor, scrub, type Redactor } from './protocol/trace.js';
import { isSecretName } from './rules/util/net.js';

export type { Redactor } from './protocol/trace.js';
export { scrub } from './protocol/trace.js';
export { isSecretName } from './rules/util/net.js';

/** Header names whose value is a credential when they appear as "Name: value" in argv (mcp-remote --header ...). */
const SECRET_HEADER = /^(authorization|proxy-authorization|cookie|x-api-key|api-key|x-auth-token|[\w-]*(token|secret|key))$/i;
/** Values never treated as secrets on their own: they would blank out unrelated report text, or, as protocol and schema words, server data (R-8). */
const TRIVIAL = /^(true|false|yes|no|on|off|null|undefined|none|\d{1,6}(\.\d+)?|object|string|number|integer|array|boolean|type|title|name|description|properties|required|items|enum|const|default|format|pattern|anyOf|oneOf|allOf|\$ref|\$schema|\$defs|uri|mimeType|text|image|audio|resource|resource_link|json|html|plain|xml|application)$/i;

/** Credentials inside a URL: the password of user:pass@ and secret query parameter values, decoded and as written ("+", %2f). */
export function urlSecrets(raw: string): string[] {
  try {
    const u = new URL(raw);
    // searchParams has one entry per non-empty "&" part; the raw value differs from the decoded one on "+" or %2f.
    const parts = u.search.slice(1).split('&').filter(Boolean);
    const out = [...u.searchParams].flatMap(([k, v], i) => {
      const raw = parts[i]?.split(/=(.*)/s)[1] ?? '';
      return !isSecretName(k) ? [] : raw && raw !== v ? [v, raw] : [v];
    });
    if (u.password) out.push(u.password, decodeURIComponent(u.password));
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
export function argvSecrets(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const eq = /^(-{1,2}[\w.-]+|[A-Za-z_][\w.-]*)=(.+)$/s.exec(a);
    if (eq && isSecretName(eq[1])) out.push(...withSchemeToken(eq[2]));
    else if (/^-{1,2}[\w.-]+$/.test(a) && isSecretName(a) && i + 1 < args.length && !args[i + 1].startsWith('--')) out.push(...withSchemeToken(args[++i]));
    const header = /^([\w-]+)\s*:\s*(.+)$/s.exec(a.replace(/^-{1,2}[\w.-]+=/, ''));
    if (header && !a.includes('://')) out.push(...headerSecrets(header[1], header[2]));
    if (a.includes('://')) out.push(...urlSecrets(a.replace(/^[^=]*=(?=\w+:\/\/)/, '')));
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

/** A Redactor for a run: --bearer, --header values, URL credentials, argv secrets and --env values (strongOnly, R-8: under a secret name only). */
export function buildRedactor(input: RedactionInput, strongOnly = false): Redactor {
  const headers = input.headers ?? {};
  const values: string[] = [];
  if (input.bearer) values.push(input.bearer);
  for (const [k, v] of Object.entries(headers)) values.push(v, ...headerSecrets(k, v).slice(1));
  if (input.url) values.push(...urlSecrets(input.url));
  if (input.argv) values.push(...argvSecrets(input.argv));
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
/** The report's own vocabulary (severities, platforms, verdicts) outside server data: renderers compare these values. */
const OWN_VOCABULARY = new Set(['ruleId', 'severity', 'platforms', 'severityByPlatform', 'verdict', 'failOn', 'toolLevel', 'era', 'kind', 'role']);

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
        out[keys ? scrub(k, r) : k] = copy(x, keys === 2 || SERVER_DATA.has(k) ? 2 : SERVER_KEYED.has(k) ? 1 : 0, !s && (own || OWN_VOCABULARY.has(k)), s);
      }
    });
    return out;
  };
  const root = copy(value);
  while (pending.length) pending.pop()!();
  return root as T;
}
