// Listing inputs: --plugin-dir (Claude plugin folder) and --openai-manifest (ChatGPT plugin package), spec Q3.
import type { Snapshot } from '../snapshot.js';
import { tokenizeCommand } from '../protocol/stdioArgs.js';
import { displayUrl, isKnownToken, isSecretName } from '../rules/util/net.js';
import type { Listing } from './types.js';

export * from './types.js';
export { emptyListing, loadOpenAiManifest, loadPluginDir, mergeListings, openAiFormat, LISTING_FILES_CAP, LISTING_JSON_CAP, LISTING_TEXT_CAP } from './load.js';

/** Store a listing on the snapshot (additive: nothing changes without one) and report its cut strings with the other
 *  input caps in snap.limits.truncated. */
export function attachListing(snap: Snapshot, listing: Listing | undefined): Snapshot {
  if (!listing || (!listing.plugin && !listing.openai)) return snap;
  snap.listing = listing;
  if (listing.truncated.length) (snap.limits ??= { truncated: [] }).truncated.push(...listing.truncated);
  return snap;
}

/** Keys whose whole value the dump hides: this list (whole blocks such as headers and env, reviewer data) and every
 *  name the redaction treats as a credential (isSecretName: privateKey, x-auth, sessionToken, ...). */
const SECRET_KEY = /secret|token|password|passwd|authorization|api[-_]?key|credential|cookie|reviewer_instructions|^(headers|env|http_headers|env_http_headers|bearer_token_env_var)$/i;
const secretKey = (k: string) => SECRET_KEY.test(k) || isSecretName(k);
const MAX_DUMP_DEPTH = 12;
const REDACTED = '[redacted]';

/** Known-format tokens inside a string, bounded like a word (`--keys=ghp_…`, a JWT of up to three dot-separated
 *  pieces), replaced: the same scan as argvSecrets in src/redact.ts. */
function maskKnownTokens(s: string): string {
  return s.replace(/[\w.-]+/g, (w) => {
    if (w.length < 15) return w; // no known format is shorter
    const p = w.split('.');
    for (let n = 3; n >= 1; n--) for (let i = 0; i + n <= p.length; i++) {
      // No known format is shorter than 15 characters, and a dotted one (a JWT) has pieces of 8 or more: a window that
      // cannot match is not joined, so a long run of dots stays cheap.
      if (n === 1 ? p[i].length < 15 : p[i].length < 8 || p[i + 1].length < 8 || (n === 3 && p[i + 2].length < 8)) continue;
      if (isKnownToken(p.slice(i, i + n).join('.'))) return [...p.slice(0, i), REDACTED, ...p.slice(i + n)].join('.');
    }
    return w;
  });
}

/** An array, with the values of credential flags hidden as the stdio argv redaction (argvSecrets) finds them: the
 *  element after `--api-key`, the part after `=` in `--auth=...` or `TOKEN=...`, the value of an `Authorization: ...`
 *  header, also after a leading `--flag=` (`--header=Authorization: Bearer ...`), and a known-format token anywhere. */
function dumpArray(a: unknown[], depth: number): unknown[] {
  const out: unknown[] = [];
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (typeof x === 'string') {
      const eq = /^(-{1,2}[\w.-]+|[A-Za-z_][\w.-]*)=(.+)$/s.exec(x);
      if (eq && isSecretName(eq[1])) { out.push(`${eq[1]}=${REDACTED}`); continue; }
      const flag = /^-{1,2}[\w.-]+=/.exec(x)?.[0] ?? '';
      const header = x.includes('://') ? null : /^([\w-]+)\s*:\s*(.+)$/s.exec(x.slice(flag.length));
      if (header && secretKey(header[1])) { out.push(`${flag}${header[1]}: ${REDACTED}`); continue; }
      const next = a[i + 1];
      if (/^-{1,2}[\w.-]+$/.test(x) && isSecretName(x) && typeof next === 'string' && !next.startsWith('--')) { out.push(x, REDACTED); i++; continue; }
      if (isKnownToken(x)) { out.push(REDACTED); continue; }
      const masked = maskKnownTokens(x);
      if (masked !== x) { out.push(masked); continue; }
    }
    out.push(dumpValue(x, depth + 1));
  }
  return out;
}

/** A string with every `scheme://...` URL in it shown through displayUrl (also after `--db=` or inside a sentence) and
 *  known-format tokens masked (A06-08). */
function dumpString(v: string): string {
  return maskKnownTokens(showUrls(v));
}

/** Each `scheme://...` in a string (up to whitespace, a quote or an angle bracket) through displayUrl. A scan from each
 *  `://` back over the scheme and forward over the URL, so it stays linear on long strings. */
function showUrls(v: string): string {
  let out = '';
  let last = 0;
  for (let k = v.indexOf('://'); k >= 0; k = v.indexOf('://', k + 3)) {
    if (k < last) continue;
    let b = k;
    while (b > last && /[a-z0-9+.-]/i.test(v[b - 1])) b--;
    while (b < k && !/[a-z]/i.test(v[b])) b++;
    if (b === k) continue;
    let e = k + 3;
    while (e < v.length && !/[\s"'<>]/.test(v[e])) e++;
    out += v.slice(last, b) + displayUrl(v.slice(b, e));
    last = e;
  }
  return out + v.slice(last);
}

function dumpValue(v: unknown, depth: number): unknown {
  if (typeof v === 'string') return dumpString(v);
  if (v === null || typeof v !== 'object') return v;
  if (depth >= MAX_DUMP_DEPTH) return '[too deep]';
  if (Array.isArray(v)) return dumpArray(v, depth);
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, secretKey(k) && x !== null && x !== undefined && x !== '' ? REDACTED : k === 'command' && typeof x === 'string' && /\s/.test(x.trim()) ? dumpCommand(x, depth) : dumpValue(x, depth + 1)]));
}

/** A one-string server `command` (`node server.js --api-key ...`), split as `--stdio` splits a command (quotes kept
 *  together, so `--header "Authorization: Bearer X"` is one word), redacted like an argv and joined again (A06-08). An
 *  unterminated quote is closed at the end; a command that still does not split is hidden whole. */
function dumpCommand(cmd: string, depth: number): string {
  let argv: string[] | undefined;
  for (const close of ['', '"', "'"]) {
    try { argv = tokenizeCommand(cmd + close); break; } catch { /* try closing the quote */ }
  }
  if (!argv) return REDACTED;
  return dumpArray(argv, depth).map((w) => (typeof w === 'string' && /\s/.test(w) ? JSON.stringify(w) : String(w))).join(' ');
}

/** The `--verbose` [listing] block: describeListing as indented JSON, one line per JSON line. `esc` (the CLI's
 *  visibleText) runs per line, so the pretty-print newlines stay newlines (JSON.stringify already escapes control
 *  characters inside strings; format and bidi characters are left to `esc`). */
export function listingDump(l: Listing, esc: (s: string) => string = (s) => s): string {
  return JSON.stringify(describeListing(l), null, 2).split('\n').map(esc).join('\n');
}

/** The parsed listing for `--verbose` (stderr): manifests with header, env and credential-named values and URL
 *  userinfo or secret parameters removed, text files by size only, the file list by count. The report redactor still
 *  runs over the output. */
export function describeListing(l: Listing): unknown {
  const json = (j: { path: string; json?: unknown; error?: string } | undefined) => j && { path: j.path, ...(j.error ? { error: j.error } : { json: dumpValue(j.json, 0) }) };
  return {
    ...(l.plugin && {
      plugin: {
        manifest: json(l.plugin.manifest), mcp: json(l.plugin.mcp),
        readme: l.plugin.readme && { path: l.plugin.readme.path, chars: l.plugin.readme.text.length, ...(l.plugin.readme.truncated ? { truncated: true } : {}) },
        license: l.plugin.license, packageConfigs: l.plugin.packageConfigs.map((c) => c.path),
        ...(l.plugin.mcpFiles ? { mcpFiles: l.plugin.mcpFiles.map((f) => ({ ref: f.ref, ...json(f)! })) } : {}),
        files: l.plugin.files.length, ...(l.plugin.filesTruncated ? { filesTruncated: true } : {}),
        ...(l.plugin.skippedDirs ? { skippedDirs: l.plugin.skippedDirs } : {}),
      },
    }),
    ...(l.openai && { openai: { format: l.openai.format, manifest: json(l.openai.manifest), mcp: json(l.openai.mcp), files: l.openai.files.map((f) => f.path), images: l.openai.images?.map((im) => ({ ...im, ref: displayUrl(im.ref) })) } }),
    errors: l.errors,
  };
}
