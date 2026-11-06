// Secret redaction: one Redactor per run covers HTTP credentials and stdio argv/env secrets, and the
// finished Report is scrubbed in one place before any format renders it.
import { createRedactor, scrub, type Redactor } from './protocol/trace.js';
import { isKnownToken, isSecretName } from './rules/util/net.js';
import { proxyEnvUrls } from './proxy.js';

export type { Redactor } from './protocol/trace.js';
export { scrub } from './protocol/trace.js';
export { isSecretName } from './rules/util/net.js';

/** Header names whose value is a credential when they appear as "Name: value" in argv (mcp-remote --header ...). */
const SECRET_HEADER = /^(authorization|proxy-authorization|cookie|x-api-key|api-key|x-auth-token|[\w-]*(token|secret|key))$/i;
/** Values never treated as secrets on their own: they would blank out unrelated report text, or, as protocol and schema words, server data. */
const TRIVIAL = /^(true|false|yes|no|on|off|null|undefined|none|\d{1,6}(\.\d+)?|object|string|number|integer|array|boolean|type|title|name|description|properties|required|items|enum|const|default|format|pattern|anyOf|oneOf|allOf|\$ref|\$schema|\$defs|uri|mimeType|text|image|audio|resource|resource_link|json|html|plain|xml|application)$/i;

/**
 * Common settings an --env value under a plain name often holds (NODE_ENV=production, LOG_LEVEL=debug, APP_VERSION=1.2.3):
 * not masked in the report, as they would blank out the same words in tool names, descriptions and serverInfo.version.
 */
/** Also the report's own words (A07-04): platforms (CLIENT=claude), formats and transports, which the report prints in
 *  its header, its docs URLs and its JSON enums. */
const PLAIN_SETTING = /^(production|prod|development|dev|staging|stage|test|testing|local|debug|info|warn|warning|error|trace|verbose|silent|fatal|claude|chatgpt|openai|anthropic|spec|all|stdio|sse|http|https|streamable-http|json|sarif|junit|markdown|v?\d+(\.\d+){1,3}([-+][\w.]+)?)$/i;

/** A percent-decoded URL part, or the part as written when its escapes are malformed. */
const decoded = (part: string) => { try { return decodeURIComponent(part); } catch { return part; } };

/** A value that is a credential by its form alone: a known token format, or 16+ characters with letters and digits. */
const tokenLike = (v: string) => isKnownToken(v) || (v.length >= 16 && /[a-z]/i.test(v) && /\d/.test(v));

/**
 * Credentials inside a URL, decoded and as written ("+", %2f): query and fragment parameters with a secret name or a
 * value in a known token format, path segments in a known token format, the password and the username of user:pass@.
 * `strongOnly`: the username only when it looks like a token, as a plain one is often a word ("postgres", "admin").
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

/** "user:pass" and the password of a Basic credential: a server may quote the password alone ("bad password X"). */
function basicParts(token: string): string[] {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(token)) return [];
  const plain = Buffer.from(token, 'base64').toString('utf8');
  const colon = plain.indexOf(':');
  // Not base64 of "user:pass" text: no colon, or bytes that are no text (control characters, invalid UTF-8).
  return colon < 0 || /[\p{Cc}�]/u.test(plain) ? [] : [plain, plain.slice(colon + 1)];
}

/** A secret value, plus the token after an auth scheme ("Bearer X"), and for Basic the decoded "user:pass" and password. */
function withSchemeToken(value: string): string[] {
  const v = value.trim();
  const m = /^(bearer|basic|token|dpop)\s+(.+)$/is.exec(v);
  if (!m) return [v];
  const token = m[2].trim();
  return [v, token, ...(m[1].toLowerCase() === 'basic' ? basicParts(token) : [])];
}

/**
 * Each "name=value" pair of a Cookie header, and the value alone under a secret-looking cookie name (session, auth_token)
 * or when it looks like a token: a server may echo one session cookie without the rest of the header; "theme=dark"
 * does not make "dark" a secret.
 */
function cookieParts(value: string): string[] {
  return value.split(';').flatMap((part) => {
    const m = /^\s*([^=\s]+)\s*=\s*(.*?)\s*$/s.exec(part);
    if (!m?.[2]) return [];
    const val = m[2].replace(/^"(.*)"$/s, '$1');
    return [`${m[1]}=${m[2]}`, ...(isSecretName(m[1]) || tokenLike(val) ? [val] : [])];
  });
}

/** The secret part of a "Name: value" header string, plus the token after an auth scheme and the pairs of a Cookie. */
function headerSecrets(name: string, value: string): string[] {
  const n = name.trim();
  if (!SECRET_HEADER.test(n) && !isSecretName(n)) return [];
  return [...withSchemeToken(value), ...(/^cookie$/i.test(n) ? cookieParts(value) : [])];
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
    // A known-format token anywhere in the argument, bounded like a word: whole, after "=" or "Name: " under a plain name,
    // inside JSON or a list ('{"apiKey":"sk-…"}', --keys=ghp_…,ghp_…); a JWT spans up to three dot-separated pieces.
    for (const w of a.match(/[\w.-]+/g) ?? []) {
      const p = w.split('.');
      for (const v of p.flatMap((_, i) => [1, 2, 3].map((n) => p.slice(i, i + n).join('.')))) if (isKnownToken(v) && !out.includes(v)) out.push(v);
    }
  }
  return out;
}

const safeUrl = (raw: string) => { try { return new URL(raw); } catch { return { username: '', password: '' }; } };
/** The proxy URLs of the process environment: the same variables src/proxy.ts routes through, ALL_PROXY included. */
const proxyUrls = () => proxyEnvUrls(process.env);

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
 * A Redactor for a run: --bearer, --header values, URL credentials, argv secrets and --env values. strongOnly: an
 * --env value under a secret name, or under a plain name when it looks like a token, and a URL username or a part of an
 * --env value under a plain name (the token after "Bearer", URL credentials) only when it looks like a token; the full
 * set, for the finished report, has them all.
 */
export function buildRedactor(input: RedactionInput, strongOnly = false): Redactor {
  const headers = input.headers ?? {};
  const values: string[] = [];
  if (input.bearer) values.push(input.bearer);
  for (const [k, v] of Object.entries(headers)) values.push(v, ...headerSecrets(k, v).slice(1));
  if (input.url) values.push(...urlSecrets(input.url, strongOnly));
  // Credentials of a proxy URL (HTTPS_PROXY, HTTP_PROXY or ALL_PROXY=http://user:pass@host, socks5 included) may appear in connection errors: always secret.
  for (const p of proxyUrls()) {
    values.push(...urlSecrets(p));
    const { username, password } = safeUrl(p);
    if (password) values.push(`Basic ${Buffer.from(`${decoded(username)}:${decoded(password)}`).toString('base64')}`);
  }
  for (const [k, v] of Object.entries(input.env ?? {})) {
    // The parts: the token after "Bearer", URL credentials, a known-format token anywhere in the value.
    const parts = [...withSchemeToken(v).slice(1), ...urlSecrets(v, strongOnly), ...argvSecrets([v]).filter(isKnownToken)];
    // One strength for a part as written and decoded (Pa%24%24word-… and Pa$$word-…): either form token-like makes both strong.
    const strong = (p: string) => [p, decoded(p), ...parts.filter((q) => decoded(q) === p)].some(tokenLike);
    values.push(...(!strongOnly || isSecretName(k) ? parts : parts.filter(strong)));
  }
  if (input.argv) values.push(...argvSecrets(input.argv, strongOnly));
  // A whole value under a plain name is strong when it is one token-like word (GITHUB_PAT=ghp_…), not a URL or "Bearer X".
  // A common setting under a plain name (NODE_ENV=production) is no secret in either tier.
  for (const [k, v] of Object.entries(input.env ?? {})) {
    const t = v.trim();
    if (isSecretName(k) || (!PLAIN_SETTING.test(t) && (!strongOnly || (tokenLike(t) && !/\s|:\/\//.test(t))))) values.push(v);
  }
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
/** Catalog text of a finding or a manual item (A07-04): its title and docs URLs are the catalog's, never the server's
 *  or the run's. Not `fix`: SRV-003 and INJ-006 build theirs from what the server or the connect error said. */
const CATALOG_FIELDS = new Set(['title', 'docs']);
/** --target values: kept under the key `target` when the value is one (snap.options.target, JSON `target`); the
 *  snapshot's `target` object (the URL and the argv) is scrubbed as before. */
const TARGET_VALUE = /^(claude|chatgpt|all)$/;
/** A finding (ruleId) or a manual item (id and text) of the report: the objects whose CATALOG_FIELDS are kept. */
/** The report arrays whose items are findings or manual items; CATALOG_FIELDS are kept only there, by position, not by
 *  shape (a server object with a string `ruleId` elsewhere, e.g. under transport, is scrubbed in full). */
const CATALOG_LISTS = new Set(['findings', 'ignored', 'manual']);
const isCatalogItem = (o: Record<string, unknown>) => typeof o.ruleId === 'string' || (typeof o.id === 'string' && /^MAN-\d{3}$/.test(o.id) && typeof o.text === 'string');

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
  // `cat`: v is an item of a report findings, ignored or manual array (or that array itself).
  const copy = (v: unknown, keys = 0, own = false, srv = false, cat = false): unknown => {
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
      pending.push(() => { for (const x of v) out.push(copy(x, keys, own, srv, cat)); });
      return out;
    }
    if (!isPlain(v)) return v;
    const out: Record<string, unknown> = {};
    seen.set(v, out);
    pending.push(() => {
      const catalog = cat && !srv && keys !== 2 && isCatalogItem(v as Record<string, unknown>);
      for (const [k, x] of Object.entries(v)) {
        const s = srv || keys === 2 || SERVER_VALUES.has(k);
        const mine = OWN_VOCABULARY.has(k) || (catalog && CATALOG_FIELDS.has(k)) || (k === 'target' && typeof x === 'string' && TARGET_VALUE.test(x));
        const key = keys ? scrub(k, r) : k, val = copy(x, keys === 2 || SERVER_DATA.has(k) ? 2 : SERVER_KEYED.has(k) ? 1 : 0, !s && (own || mine), s, !s && Array.isArray(x) && CATALOG_LISTS.has(k));
        // A "__proto__" key the server sent is data: a plain assignment would set the copy's prototype instead.
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
