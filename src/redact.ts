// Secret redaction: one Redactor per run covers HTTP credentials and stdio argv/env secrets, and the
// finished Report is scrubbed in one place before any format renders it.
import { createRedactor, scrub, type Redactor } from './protocol/trace.js';
import { isSecretQueryParam } from './rules/util/net.js';

export type { Redactor } from './protocol/trace.js';
export { scrub } from './protocol/trace.js';

/** A flag (or KEY=) name whose value is a credential: --api-key, --token, --client-secret, --accessToken, DB_PASSWORD, ... */
const SECRET_NAME = /(^|[-_.])(api[-_]?key|apikey|key|token|secret|password|passwd|pwd|pass|auth|authorization|bearer|credentials?|cookie|session|private[-_]?key|signature|dsn)$/i;
/** Header names whose value is a credential when they appear as "Name: value" in argv (mcp-remote --header ...). */
const SECRET_HEADER = /^(authorization|proxy-authorization|cookie|x-api-key|api-key|x-auth-token|[\w-]*(token|secret|key))$/i;
/** Values never treated as secrets on their own: they would blank out unrelated report text. */
const TRIVIAL = /^(true|false|yes|no|on|off|null|undefined|none|\d{1,6}(\.\d+)?)$/i;

export function isSecretName(name: string): boolean {
  return SECRET_NAME.test(name.replace(/^-+/, '').replace(/([a-z0-9])([A-Z])/g, '$1-$2'));
}

/** Credentials inside a URL: the password of user:pass@ and secret query parameter values. */
export function urlSecrets(raw: string): string[] {
  try {
    const u = new URL(raw);
    const out = [...u.searchParams.entries()].filter(([k]) => isSecretQueryParam(k)).map(([, v]) => v);
    if (u.password) out.push(u.password, decodeURIComponent(u.password));
    return out;
  } catch {
    return [];
  }
}

/** The secret part of a "Name: value" header string, plus the token after an auth scheme. */
function headerSecrets(name: string, value: string): string[] {
  if (!SECRET_HEADER.test(name.trim())) return [];
  const v = value.trim();
  const token = /^(bearer|basic|token|dpop)\s+(.+)$/i.exec(v)?.[2];
  return token ? [v, token] : [v];
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
    if (eq && isSecretName(eq[1])) out.push(eq[2]);
    else if (/^-{1,2}[\w.-]+$/.test(a) && isSecretName(a) && i + 1 < args.length && !args[i + 1].startsWith('--')) out.push(args[++i]);
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

/** The single Redactor for a run: --bearer, --header values, URL credentials, --env values and argv secrets. */
export function buildRedactor(input: RedactionInput): Redactor {
  const headers = input.headers ?? {};
  const values: string[] = [];
  if (input.bearer) values.push(input.bearer);
  for (const [k, v] of Object.entries(headers)) values.push(v, ...headerSecrets(k, v).slice(1));
  if (input.url) values.push(...urlSecrets(input.url));
  if (input.argv) values.push(...argvSecrets(input.argv));
  values.push(...Object.values(input.env ?? {}));
  return createRedactor(Object.keys(headers), values.map((v) => v.trim()).filter((v) => v && !TRIVIAL.test(v)));
}

const isPlain = (v: object) => {
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

/** A deep copy of `value` with every secret replaced in strings (keys included) and URL objects. */
export function redactDeep<T>(value: T, r: Redactor): T {
  if (!r.values.size) return value;
  const seen = new Map<object, unknown>();
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return scrub(v, r);
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
      for (const x of v) out.push(walk(x));
      return out;
    }
    if (!isPlain(v)) return v;
    const out: Record<string, unknown> = {};
    seen.set(v, out);
    for (const [k, x] of Object.entries(v)) out[scrub(k, r)] = walk(x);
    return out;
  };
  return walk(value) as T;
}
