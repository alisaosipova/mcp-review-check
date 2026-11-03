// Listing inputs: --plugin-dir (Claude plugin folder) and --openai-manifest (ChatGPT plugin package), spec Q3.
import type { Snapshot } from '../snapshot.js';
import { displayUrl } from '../rules/util/net.js';
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

const SECRET_KEY = /secret|token|password|passwd|authorization|api[-_]?key|credential|cookie|reviewer_instructions|^(headers|env|http_headers|env_http_headers|bearer_token_env_var)$/i;
const MAX_DUMP_DEPTH = 12;

function dumpValue(v: unknown, depth: number): unknown {
  if (typeof v === 'string') return /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? displayUrl(v) : v;
  if (v === null || typeof v !== 'object') return v;
  if (depth >= MAX_DUMP_DEPTH) return '[too deep]';
  if (Array.isArray(v)) return v.map((x) => dumpValue(x, depth + 1));
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET_KEY.test(k) && x !== null && x !== undefined && x !== '' ? '[redacted]' : dumpValue(x, depth + 1)]));
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
    ...(l.openai && { openai: { format: l.openai.format, manifest: json(l.openai.manifest), mcp: json(l.openai.mcp), files: l.openai.files.map((f) => f.path), images: l.openai.images } }),
    errors: l.errors,
  };
}
