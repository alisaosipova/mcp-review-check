// Read a Claude plugin folder or a ChatGPT plugin package manifest from disk into a Listing (spec Q3, wave 6).
// Read-only and bounded: links are listed but never followed, every read is capped, and parse or I/O problems are
// recorded in Listing.errors instead of thrown. Messages carry relative paths and error codes, not absolute paths.
import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { capStrings, TEXT_CAP } from '../limits.js';
import { examineImage, IMAGE_COUNT_CAP } from './image.js';
import type { Listing, ListingImage, ListingEntry, ListingError, ListingJson, ListingText, OpenAiFormat, OpenAiListing, PluginListing } from './types.js';

/** A manifest or MCP configuration larger than this is not parsed (the directory's own per-file limit is 5 MiB,
 *  and anything a reviewer reads is far smaller). */
export const LISTING_JSON_CAP = 1024 * 1024;
/** README and package-manager configuration text read (the directory holds files over 256 KiB for a reviewer). */
export const LISTING_TEXT_CAP = 256 * 1024;
/** Entries listed in a plugin folder (the directory's repository limit is 10,000 files and folders). */
export const LISTING_FILES_CAP = 10_000;
/** Folder depth walked. */
const MAX_DEPTH = 32;

/** Package-manager configuration files that can set a registry, index or proxy (pre-submission checklist). */
export const PACKAGE_CONFIG_FILES = new Set(['.npmrc', '.yarnrc', '.yarnrc.yml', 'bunfig.toml', 'uv.toml', 'pip.conf', 'pip.ini']);

const README = /^readme(\.[a-z0-9]+)?$/i;
const LICENSE = /^(licen[cs]e|copying)([.-][a-z0-9.-]+)?$/i;

const posix = (p: string) => p.split('\\').join('/');
const codeOf = (err: unknown) => String((err as NodeJS.ErrnoException)?.code ?? (err as Error)?.name ?? 'error');

export function emptyListing(): Listing {
  return { errors: [], truncated: [] };
}

/** Both listings in one (the plugin of `a` wins over `b`, errors and truncations are concatenated). */
export function mergeListings(...parts: Array<Listing | undefined>): Listing {
  const out = emptyListing();
  for (const p of parts) {
    if (!p) continue;
    out.plugin ??= p.plugin;
    out.openai ??= p.openai;
    out.errors.push(...p.errors);
    out.truncated.push(...p.truncated);
  }
  return out;
}

/** Up to `cap` bytes of a regular file (never through a link); undefined with an error recorded otherwise. */
function readCapped(abs: string, rel: string, cap: number, source: ListingError['source'], errors: ListingError[], strict = false): { text: string; truncated: boolean; size: number } | undefined {
  let fd: number | undefined;
  try {
    const st = lstatSync(abs);
    if (st.isSymbolicLink()) { errors.push({ source, path: rel, message: 'is a symbolic link (not followed)' }); return undefined; }
    if (!st.isFile()) { errors.push({ source, path: rel, message: 'is not a regular file' }); return undefined; }
    // O_NONBLOCK: a FIFO swapped in after the lstat cannot stall the open; the descriptor is checked again.
    fd = openSync(abs, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const fst = fstatSync(fd);
    if (!fst.isFile()) { errors.push({ source, path: rel, message: 'is not a regular file' }); return undefined; }
    const size = fst.size;
    const buf = Buffer.alloc(Math.min(size, cap));
    let off = 0;
    while (off < buf.length) {
      const n = readSync(fd, buf, off, buf.length - off, off);
      if (n === 0) break;
      off += n;
    }
    const bytes = buf.subarray(0, off);
    // Invalid UTF-8 would decode to U+FFFD and could slip into a message or a rule: refuse it, naming no content.
    if (strict) { try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { errors.push({ source, path: rel, message: 'is not valid UTF-8' }); return undefined; } }
    return { text: bytes.toString('utf8').replace(/^\uFEFF/, ''), truncated: size > cap, size };
  } catch (err) {
    errors.push({ source, path: rel, message: `could not be read (${codeOf(err)})` });
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Whether a path exists, without following a final link. */
function exists(abs: string): boolean {
  try { lstatSync(abs); return true; } catch { return false; }
}

/** " (line L, column C)" from the position a JSON SyntaxError reports, or "" when it reports none; never its message. */
export function jsonErrorPosition(err: unknown, text: string): string {
  const m = /\bposition (\d+)/.exec(err instanceof Error ? err.message : '');
  if (!m) return '';
  const at = Math.min(Number(m[1]), text.length);
  let line = 1;
  let last = -1;
  for (let i = text.indexOf('\n'); i >= 0 && i < at; i = text.indexOf('\n', i + 1)) { line++; last = i; }
  return ` (line ${line}, column ${at - last})`;
}

/** Parse a JSON file; strings over TEXT_CAP are cut (recorded in `listing.truncated`). Undefined when it does not exist. */
function readJson(abs: string, rel: string, source: ListingError['source'], listing: Listing): ListingJson | undefined {
  if (!exists(abs)) return undefined;
  const r = readCapped(abs, rel, LISTING_JSON_CAP, source, listing.errors, true);
  if (!r) return { path: rel, error: listing.errors[listing.errors.length - 1]?.message ?? 'could not be read' };
  if (r.truncated) {
    const error = `is ${r.size} bytes, over the ${LISTING_JSON_CAP / 1024 / 1024} MiB read cap; not parsed`;
    listing.errors.push({ source, path: rel, message: error });
    return { path: rel, error };
  }
  try {
    const json: unknown = JSON.parse(r.text);
    if (json !== null && typeof json === 'object') capStrings(json, TEXT_CAP, rel, listing.truncated);
    return { path: rel, json };
  } catch (err) {
    // A SyntaxError message quotes a window of the input (which may hold a token): only the position is kept.
    const error = `is not valid JSON${jsonErrorPosition(err, r.text)}`;
    listing.errors.push({ source, path: rel, message: error });
    return { path: rel, error };
  }
}

function readText(abs: string, rel: string, source: ListingError['source'], errors: ListingError[]): ListingText | undefined {
  const r = readCapped(abs, rel, LISTING_TEXT_CAP, source, errors);
  return r && { path: rel, text: r.text, ...(r.truncated ? { truncated: true } : {}) };
}

/** Every entry under `root` (links listed, not followed; `.git` skipped), breadth first, at most `cap`. */
function walk(root: string, maxDepth: number, cap: number, source: ListingError['source'], errors: ListingError[]): { files: ListingEntry[]; truncated: boolean } {
  const files: ListingEntry[] = [];
  const queue: Array<{ rel: string; depth: number }> = [{ rel: '', depth: 0 }];
  for (let next = queue.shift(); next; next = queue.shift()) {
    let names: string[];
    try {
      names = readdirSync(join(root, next.rel)).sort();
    } catch (err) {
      errors.push({ source, path: next.rel || '.', message: `could not be listed (${codeOf(err)})` });
      continue;
    }
    for (const name of names) {
      if (next.depth === 0 && name === '.git') continue;
      const rel = next.rel ? `${next.rel}/${name}` : name;
      if (files.length >= cap) return { files, truncated: true };
      let entry: ListingEntry;
      try {
        const st = lstatSync(join(root, rel));
        entry = { path: posix(rel), size: st.isFile() ? st.size : 0, kind: st.isSymbolicLink() ? 'symlink' : st.isDirectory() ? 'dir' : st.isFile() ? 'file' : 'other' };
      } catch {
        entry = { path: posix(rel), size: 0, kind: 'other' };
      }
      files.push(entry);
      if (entry.kind === 'dir' && next.depth + 1 < maxDepth) queue.push({ rel, depth: next.depth + 1 });
    }
  }
  return { files, truncated: false };
}

/** Read a Claude plugin folder: `.claude-plugin/plugin.json`, `.mcp.json`, README, LICENSE, package-manager
 *  configuration files and the file list. A folder that cannot be listed gives a plugin with no files and an error. */
export function loadPluginDir(dir: string): Listing {
  const listing = emptyListing();
  const errors = listing.errors;
  try {
    if (!lstatSync(dir).isDirectory()) { errors.push({ source: 'plugin', path: '.', message: 'is not a directory' }); listing.plugin = { packageConfigs: [], files: [] }; return listing; }
  } catch (err) {
    errors.push({ source: 'plugin', path: '.', message: `could not be read (${codeOf(err)})` });
    listing.plugin = { packageConfigs: [], files: [] };
    return listing;
  }
  const { files, truncated } = walk(dir, MAX_DEPTH, LISTING_FILES_CAP, 'plugin', errors);
  const rootFiles = files.filter((f) => !f.path.includes('/') && f.kind === 'file');
  const readmes = rootFiles.filter((f) => README.test(f.path)).sort((a, b) => Number(!/^readme\.md$/i.test(a.path)) - Number(!/^readme\.md$/i.test(b.path)));
  const plugin: PluginListing = {
    manifest: readJson(join(dir, '.claude-plugin', 'plugin.json'), '.claude-plugin/plugin.json', 'plugin', listing),
    mcp: readJson(join(dir, '.mcp.json'), '.mcp.json', 'plugin', listing),
    readme: readmes[0] && readText(join(dir, readmes[0].path), readmes[0].path, 'plugin', errors),
    license: rootFiles.find((f) => LICENSE.test(f.path))?.path,
    packageConfigs: files
      .filter((f) => f.kind === 'file' && PACKAGE_CONFIG_FILES.has(basename(f.path)))
      .flatMap((f) => readText(join(dir, f.path), f.path, 'plugin', errors) ?? []),
    files,
    ...(truncated ? { filesTruncated: true } : {}),
  };
  listing.plugin = plugin;
  return listing;
}

/** The package root of a manifest: the parent of `.codex-plugin/`, `.agent-plugin/` or `.claude-plugin/`, otherwise its folder. */
function packageRoot(file: string): string {
  const d = dirname(file);
  return ['.codex-plugin', '.agent-plugin', '.claude-plugin'].includes(basename(d)) ? dirname(d) : d;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

export function openAiFormat(json: unknown): OpenAiFormat {
  if (!isObj(json)) return 'unknown';
  // A Codex manifest keeps review and publication under extensions.com.openai too: its root interface decides.
  if (isObj(json.interface)) return 'codex';
  const ext = isObj(json.extensions) ? json.extensions['com.openai'] : undefined;
  if (isObj(ext)) return 'agent-plugins';
  if (isObj(json.mcpServers) && json.name === undefined) return 'mcp-config';
  return 'unknown';
}

const IMAGE_KEYS = ['logo', 'logoDark', 'composerIcon', 'composerIconDark'];

/** The icons and screenshots of the listing object, examined (at most IMAGE_COUNT_CAP). */
function openAiImages(root: string, json: unknown, format: OpenAiFormat): ListingImage[] {
  if (!isObj(json)) return [];
  const ext = isObj(json.extensions) ? json.extensions['com.openai'] : undefined;
  const iface = format === 'codex' ? json.interface : isObj(ext) ? ext.interface : undefined;
  if (!isObj(iface)) return [];
  const refs: Array<[string, unknown]> = IMAGE_KEYS.filter((k) => iface[k] !== undefined).map((k) => [k, iface[k]]);
  if (Array.isArray(iface.screenshots)) iface.screenshots.forEach((s, n) => refs.push([`screenshots[${n}]`, s]));
  return refs.slice(0, IMAGE_COUNT_CAP).map(([k, v]) => examineImage(root, 'openai', k, v));
}

/** Read a ChatGPT plugin package manifest (plugin.json with extensions.com.openai, or `.codex-plugin/plugin.json`),
 *  or a bare mcp.json; the companion mcp.json / .mcp.json and the root's entries come from the package root. */
export function loadOpenAiManifest(path: string): Listing {
  const listing = emptyListing();
  const name = basename(path);
  const inPluginDir = ['.codex-plugin', '.agent-plugin', '.claude-plugin'].includes(basename(dirname(path)));
  const rel = inPluginDir ? `${basename(dirname(path))}/${name}` : name;
  const manifest = readJson(path, rel, 'openai', listing) ?? (listing.errors.push({ source: 'openai', path: rel, message: 'does not exist' }), { path: rel, error: 'does not exist' });
  const format = openAiFormat(manifest.json);
  const root = packageRoot(path);
  let mcp: ListingJson | undefined;
  if (format === 'mcp-config') mcp = manifest;
  else {
    const declared = isObj(manifest.json) && typeof manifest.json.mcpServers === 'string' ? manifest.json.mcpServers.replace(/^\.\//, '') : undefined;
    const candidates = [...(declared && !declared.split(/[\\/]/).includes('..') && !/^([a-z]+:|[\\/])/i.test(declared) ? [declared] : []), 'mcp.json', '.mcp.json'];
    for (const c of candidates) {
      mcp = readJson(join(root, c), posix(c), 'openai', listing);
      if (mcp) break;
    }
  }
  const { files } = walk(root, 1, LISTING_FILES_CAP, 'openai', listing.errors);
  const images = format === 'codex' || format === 'agent-plugins' ? openAiImages(root, manifest.json, format) : undefined;
  const openai: OpenAiListing = { manifest, format, ...(mcp ? { mcp } : {}), files, ...(images ? { images } : {}) };
  listing.openai = openai;
  return listing;
}
