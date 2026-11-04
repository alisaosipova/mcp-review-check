// Listing inputs: --plugin-dir (Claude plugin folder) and --openai-manifest (ChatGPT plugin package), spec Q3.
import type { Snapshot } from '../snapshot.js';
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

/** An array, with the values of credential flags hidden as the stdio argv redaction finds them: the element after
 *  `--api-key`, the part after `=` in `--auth=...` or `TOKEN=...`, and the value of an `Authorization: ...` header. */
function dumpArray(a: unknown[], depth: number): unknown[] {
  const out: unknown[] = [];
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (typeof x === 'string') {
      const eq = /^(-{1,2}[\w.-]+|[A-Za-z_][\w.-]*)=(.+)$/s.exec(x);
      if (eq && isSecretName(eq[1])) { out.push(`${eq[1]}=${REDACTED}`); continue; }
      const header = x.includes('://') ? null : /^([\w-]+)\s*:\s*(.+)$/s.exec(x);
      if (header && secretKey(header[1])) { out.push(`${header[1]}: ${REDACTED}`); continue; }
      const next = a[i + 1];
      if (/^-{1,2}[\w.-]+$/.test(x) && isSecretName(x) && typeof next === 'string' && !next.startsWith('--')) { out.push(x, REDACTED); i++; continue; }
      if (isKnownToken(x)) { out.push(REDACTED); continue; }
    }
    out.push(dumpValue(x, depth + 1));
  }
  return out;
}

function dumpValue(v: unknown, depth: number): unknown {
  if (typeof v === 'string') return /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? displayUrl(v) : v;
  if (v === null || typeof v !== 'object') return v;
  if (depth >= MAX_DUMP_DEPTH) return '[too deep]';
  if (Array.isArray(v)) return dumpArray(v, depth);
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, secretKey(k) && x !== null && x !== undefined && x !== '' ? REDACTED : dumpValue(x, depth + 1)]));
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
        files: l.plugin.files.length, ...(l.plugin.filesTruncated ? { filesTruncated: true } : {}),
      },
    }),
    ...(l.openai && { openai: { format: l.openai.format, manifest: json(l.openai.manifest), mcp: json(l.openai.mcp), files: l.openai.files.map((f) => f.path), images: l.openai.images?.map((im) => ({ ...im, ref: displayUrl(im.ref) })) } }),
    errors: l.errors,
  };
}
