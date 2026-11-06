// Read a Claude plugin folder or a ChatGPT plugin package manifest from disk into a Listing (spec Q3, wave 6).
// Read-only and bounded: links are listed but never followed, every read is capped, and parse or I/O problems are
// recorded in Listing.errors instead of thrown. Messages carry relative paths and error codes, not absolute paths.
import { closeSync, constants, fstatSync, lstatSync, opendirSync, openSync, readSync, realpathSync } from 'node:fs';
import { basename, dirname, join, sep } from 'node:path';
import { capStrings, TEXT_CAP } from '../limits.js';
import { displayUrl } from '../rules/util/net.js';
import { examineImage, IMAGE_COUNT_CAP } from './image.js';
import type { Listing, ListingImage, ListingEntry, ListingError, ListingJson, ListingText, OpenAiFormat, OpenAiListing, PluginListing, PluginMcpFile } from './types.js';

/** A manifest or MCP configuration larger than this is not parsed. This is the tool's own read cap, not a directory
 *  rule (the directory's per-file limit is 5 MiB, and a real manifest is far smaller), so a file over it is reported at
 *  warning level as not checked. */
export const LISTING_JSON_CAP = 1024 * 1024;
/** README and package-manager configuration text read (the directory holds files over 256 KiB for a reviewer). */
export const LISTING_TEXT_CAP = 256 * 1024;
/** Entries listed in a plugin folder (the directory's repository limit is 10,000 files and folders). */
export const LISTING_FILES_CAP = 10_000;
/** Folder depth walked. */
const MAX_DEPTH = 32;
/** VCS metadata folders `--plugin-dir` never walks, at any depth (never part of the committed plugin). */
export const VCS_DIRS = new Set(['.git', '.hg', '.svn']);
/** Dependency and build-cache folders `--plugin-dir` does not walk, at any depth, when the plugin's root `.gitignore`
 *  lists them (1.1.1, A06-06): the directory reviews the committed repository, and an ignored folder of installed
 *  dependencies is not part of it. A committed one (not in .gitignore) is walked and checked as before. `dist/` and
 *  `build/` are never skipped: a plugin often commits its built server there. */
export const DEPENDENCY_DIRS = new Set([
  'node_modules', 'bower_components', '.venv', 'venv', '__pycache__', 'site-packages', '.tox', '.nox', '.mypy_cache',
  '.pytest_cache', '.ruff_cache', '.turbo', '.parcel-cache', '.next',
]);
/** Every folder name the walk may skip. */
export const SKIPPED_DIRS = new Set([...VCS_DIRS, ...DEPENDENCY_DIRS]);

/** A root .gitignore line that names a DEPENDENCY_DIRS folder. */
export interface IgnoreRule { path: string; anchored: boolean; negate: boolean }
/** Rules kept from a .gitignore (a real one has a handful; the cap bounds the walk on a hostile one). */
const IGNORE_RULES_CAP = 1000;

/** The lines of a root .gitignore that name a DEPENDENCY_DIRS folder, read as text, never through git: exact names,
 *  `/name` (root only), `name/`, `**` + `/name` and `a/name` paths; `!` lines re-include. Globs are not expanded. */
export function gitignoreRules(text: string): IgnoreRule[] {
  const out: IgnoreRule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let p = raw.replace(/[ \t]+$/, '');
    if (!p || p.startsWith('#')) continue;
    const negate = p.startsWith('!');
    if (negate) p = p.slice(1);
    p = p.replace(/\/+$/, '');
    if (p.startsWith('**/')) p = p.slice(3);
    const anchored = p.startsWith('/') || p.slice(0, -1).includes('/');
    p = p.replace(/^\//, '');
    if (!DEPENDENCY_DIRS.has(p.split('/').pop()!)) continue;
    out.push({ path: p, anchored, negate });
    if (out.length >= IGNORE_RULES_CAP) break;
  }
  return out;
}

/** Whether the folder `rel` (POSIX, relative to the plugin root) is ignored by the rules: the last matching rule wins. */
export function ignoredBy(rel: string, rules: IgnoreRule[]): boolean {
  const name = rel.slice(rel.lastIndexOf('/') + 1);
  let ignored = false;
  for (const r of rules) if (r.anchored ? r.path === rel : r.path === name) ignored = !r.negate;
  return ignored;
}

/** Skipped folders named in the listing (the rest are counted only by being skipped). */
const SKIPPED_SHOWN = 20;
/** MCP configuration files read from plugin.json mcpServers. */
export const MCP_FILES_CAP = 16;

/** Package-manager configuration files that can set a registry, index or proxy (pre-submission checklist). */
export const PACKAGE_CONFIG_FILES = new Set(['.npmrc', '.yarnrc', '.yarnrc.yml', 'bunfig.toml', 'uv.toml', 'pip.conf', 'pip.ini', 'pyproject.toml']);
/** A pyproject.toml is a package-manager configuration only when it has uv settings ([tool.uv], tool.uv.* keys). */
const isPackageConfig = (path: string, text: string) => basename(path) !== 'pyproject.toml' || /\buv\b/.test(text);

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

/** Whether `real` (a resolved path) is `realRoot` or inside it. */
export function within(real: string, realRoot: string): boolean {
  return real === realRoot || real.startsWith(realRoot.endsWith(sep) ? realRoot : realRoot + sep);
}

/** A file reached through a linked folder that leads out of the root: not read (this tool's guard, not a vendor rule). */
export const BEHIND_LINK = 'is behind a symbolic link that leads out of the folder (not followed), so it was not checked';

/** Up to `cap` bytes of a regular file inside `realRoot` (never through a link, also not through a linked folder on
 *  the way); undefined with an error recorded otherwise (`guard.hit` set when the refusal is BEHIND_LINK). */
function readCapped(abs: string, rel: string, cap: number, source: ListingError['source'], errors: ListingError[], realRoot: string, strict = false, guard?: { hit: boolean }): { text: string; truncated: boolean; size: number } | undefined {
  let fd: number | undefined;
  try {
    const st = lstatSync(abs);
    if (st.isSymbolicLink()) { errors.push({ source, path: rel, message: 'is a symbolic link (not followed)' }); return undefined; }
    if (!st.isFile()) { errors.push({ source, path: rel, message: 'is not a regular file' }); return undefined; }
    // The lstat and O_NOFOLLOW guard only the last path component: a folder on the way may be a link out of the root.
    if (!within(realpathSync(abs), realRoot)) {
      errors.push({ source, path: rel, message: BEHIND_LINK });
      if (guard) guard.hit = true;
      return undefined;
    }
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
function readJson(abs: string, rel: string, source: ListingError['source'], listing: Listing, realRoot: string): ListingJson | undefined {
  if (!exists(abs)) return undefined;
  const guard = { hit: false };
  const r = readCapped(abs, rel, LISTING_JSON_CAP, source, listing.errors, realRoot, true, guard);
  if (!r) return { path: rel, error: listing.errors[listing.errors.length - 1]?.message ?? 'could not be read', ...(guard.hit ? { level: 'warning' as const } : {}) };
  if (r.truncated) {
    const error = `is ${r.size} bytes, over the ${LISTING_JSON_CAP / 1024 / 1024} MiB read cap; not parsed, so not checked (a limit of this tool, not of the directory)`;
    listing.errors.push({ source, path: rel, message: error });
    return { path: rel, error, level: 'warning' };
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

function readText(abs: string, rel: string, source: ListingError['source'], errors: ListingError[], realRoot: string): ListingText | undefined {
  const r = readCapped(abs, rel, LISTING_TEXT_CAP, source, errors, realRoot);
  return r && { path: rel, text: r.text, ...(r.truncated ? { truncated: true } : {}) };
}

/** Up to `limit` names of a folder, sorted, read with opendir so a huge folder is not read in full (I-A06-7). */
function readNames(abs: string, limit: number): string[] {
  const d = opendirSync(abs);
  const names: string[] = [];
  try {
    while (names.length < limit) {
      const e = d.readSync();
      if (!e) break;
      names.push(e.name);
    }
  } finally {
    d.closeSync();
  }
  return names.sort();
}

/** Every entry under `root` (links listed, not followed; the root `.git` skipped, and with `skip` set the VCS_DIRS
 *  folders and the DEPENDENCY_DIRS folders the root .gitignore lists, at any depth, recorded in `skip.dirs`), breadth first, at most `cap`. A folder is read only as far as the
 *  cap needs, so the kept entries of a folder that overflows it are the first ones the system lists, sorted. */
function walk(root: string, maxDepth: number, cap: number, source: ListingError['source'], errors: ListingError[], skip?: { gitignore: IgnoreRule[]; dirs: string[] }): { files: ListingEntry[]; truncated: boolean } {
  const files: ListingEntry[] = [];
  const queue: Array<{ rel: string; depth: number }> = [{ rel: '', depth: 0 }];
  for (let next = queue.shift(); next; next = queue.shift()) {
    let names: string[];
    try {
      // Enough names to reach the cap even when every skipped name is in this folder.
      names = readNames(join(root, next.rel), cap - files.length + SKIPPED_DIRS.size + 1);
    } catch (err) {
      errors.push({ source, path: next.rel || '.', message: `could not be listed (${codeOf(err)})` });
      continue;
    }
    for (const name of names) {
      if (next.depth === 0 && name === '.git') continue;
      const rel = next.rel ? `${next.rel}/${name}` : name;
      let st: ReturnType<typeof lstatSync> | undefined;
      try { st = lstatSync(join(root, rel)); } catch { st = undefined; }
      if (skip && SKIPPED_DIRS.has(name) && st?.isDirectory() && (VCS_DIRS.has(name) || ignoredBy(posix(rel), skip.gitignore))) {
        if (skip.dirs.length < SKIPPED_SHOWN) skip.dirs.push(posix(rel));
        continue;
      }
      if (files.length >= cap) return { files, truncated: true };
      const entry: ListingEntry = st
        ? { path: posix(rel), size: st.isFile() ? st.size : 0, kind: st.isSymbolicLink() ? 'symlink' : st.isDirectory() ? 'dir' : st.isFile() ? 'file' : 'other' }
        : { path: posix(rel), size: 0, kind: 'other' };
      files.push(entry);
      if (entry.kind === 'dir' && next.depth + 1 < maxDepth) queue.push({ rel, depth: next.depth + 1 });
    }
  }
  return { files, truncated: false };
}

/** The MCP configuration files plugin.json names in `mcpServers` (a `.json` string, or the `.json` strings of an
 *  array), read like the ChatGPT declared file: a `./` path with no `..`, inside the real root, never through a link
 *  (A06-01). The root `.mcp.json` is read already and is not read twice. Read problems are carried on the entry for
 *  LST-006, not printed as warnings: in 1.1.1 these files only add info findings. */
function pluginMcpFiles(realRoot: string, manifest: ListingJson | undefined, listing: Listing): PluginMcpFile[] | undefined {
  const j = manifest?.json;
  if (!isObj(j)) return undefined;
  const raw = j.mcpServers;
  const refs = (Array.isArray(raw) ? raw : [raw]).filter((r): r is string => typeof r === 'string' && /\.json$/i.test(r.trim()));
  if (!refs.length) return undefined;
  const sink: Listing = { errors: [], truncated: listing.truncated };
  const seen = new Set<string>(['.mcp.json']);
  const out: PluginMcpFile[] = [];
  for (const given of refs.slice(0, MCP_FILES_CAP)) {
    const ref = given.trim();
    const scheme = /^[a-z][a-z0-9+.-]*:/i.test(ref);
    const shown = scheme ? displayUrl(ref) : posix(ref);
    const parts = ref.split(/[\\/]/);
    if (scheme) { out.push({ ref: shown, path: shown, problem: 'not-relative', error: 'is not a ./ path inside the plugin folder, so it was not read' }); continue; }
    if (/^([\\/]|[A-Za-z]:)/.test(ref) || parts.includes('..')) { out.push({ ref: shown, path: shown, problem: 'escapes', error: 'is outside the plugin folder (path escapes plugin folder), so it was not read' }); continue; }
    if (!ref.startsWith('./')) { out.push({ ref: shown, path: shown, problem: 'not-relative', error: 'is not a ./ path inside the plugin folder, so it was not read' }); continue; }
    const rel = parts.filter((x) => x && x !== '.').join('/');
    if (seen.has(rel)) continue;
    seen.add(rel);
    const got = readJson(join(realRoot, rel), rel, 'plugin', sink, realRoot);
    out.push(got ? { ...got, ref: shown } : { ref: shown, path: rel, problem: 'not-found', error: 'does not exist in the plugin folder (Path not found), so it was not read' });
  }
  return out;
}

/** Read a Claude plugin folder: `.claude-plugin/plugin.json`, `.mcp.json`, README, LICENSE, package-manager
 *  configuration files and the file list. A folder that cannot be listed gives a plugin with no files and an error. */
export function loadPluginDir(given: string): Listing {
  const listing = emptyListing();
  const errors = listing.errors;
  let dir: string;
  try {
    // The folder the user named is followed once (it may itself be a link); links inside it are not.
    dir = realpathSync(given);
    if (!lstatSync(dir).isDirectory()) { errors.push({ source: 'plugin', path: '.', message: 'is not a directory' }); listing.plugin = { packageConfigs: [], files: [] }; return listing; }
  } catch (err) {
    errors.push({ source: 'plugin', path: '.', message: `could not be read (${codeOf(err)})` });
    listing.plugin = { packageConfigs: [], files: [] };
    return listing;
  }
  // The root .gitignore, read as text (a read problem only means nothing is skipped beyond the VCS folders).
  const gitignore = gitignoreRules(exists(join(dir, '.gitignore')) ? readText(join(dir, '.gitignore'), '.gitignore', 'plugin', [], dir)?.text ?? '' : '');
  const skip = { gitignore, dirs: [] as string[] };
  const { files, truncated } = walk(dir, MAX_DEPTH, LISTING_FILES_CAP, 'plugin', errors, skip);
  const skippedDirs = skip.dirs;
  const rootFiles = files.filter((f) => !f.path.includes('/') && f.kind === 'file');
  const readmes = rootFiles.filter((f) => README.test(f.path)).sort((a, b) => Number(!/^readme\.md$/i.test(a.path)) - Number(!/^readme\.md$/i.test(b.path)));
  const manifest = readJson(join(dir, '.claude-plugin', 'plugin.json'), '.claude-plugin/plugin.json', 'plugin', listing, dir);
  const mcpFiles = pluginMcpFiles(dir, manifest, listing);
  const plugin: PluginListing = {
    manifest,
    mcp: readJson(join(dir, '.mcp.json'), '.mcp.json', 'plugin', listing, dir),
    readme: readmes[0] && readText(join(dir, readmes[0].path), readmes[0].path, 'plugin', errors, dir),
    license: rootFiles.find((f) => LICENSE.test(f.path))?.path,
    packageConfigs: files
      .filter((f) => f.kind === 'file' && PACKAGE_CONFIG_FILES.has(basename(f.path)))
      .flatMap((f) => readText(join(dir, f.path), f.path, 'plugin', errors, dir) ?? [])
      .filter((c) => isPackageConfig(c.path, c.text)),
    files,
    ...(truncated ? { filesTruncated: true } : {}),
    ...(skippedDirs.length ? { skippedDirs } : {}),
    ...(mcpFiles ? { mcpFiles } : {}),
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

/** The MCP configuration a manifest names with a string `mcpServers`. Only that file is read: a declared path that is
 *  missing or leads out of the package is recorded (warning level), never replaced by the root mcp.json. */
function declaredMcp(realRoot: string, raw: string, listing: Listing): ListingJson {
  const declared = raw.replace(/^\.\//, '');
  const scheme = /^[a-z][a-z0-9+.-]*:/i.test(declared);
  const shown = scheme ? displayUrl(declared) : posix(declared);
  let error: string;
  if (!declared.trim()) error = 'is empty: mcpServers names no file, so no MCP configuration was checked';
  else if (scheme || /^[\\/]/.test(declared) || declared.split(/[\\/]/).includes('..')) error = 'is not a ./ path inside the package (mcpServers), so it was not read';
  else {
    const got = readJson(join(realRoot, declared), shown, 'openai', listing, realRoot);
    if (got) return got;
    error = 'does not exist in the package (declared in mcpServers), so no MCP configuration was checked';
  }
  listing.errors.push({ source: 'openai', path: shown || 'mcpServers', message: error });
  return { path: shown || 'mcpServers', error, level: 'warning' };
}

/** Read a ChatGPT plugin package manifest (plugin.json with extensions.com.openai, or `.codex-plugin/plugin.json`),
 *  or a bare mcp.json; the companion mcp.json / .mcp.json and the root's entries come from the package root. */
export function loadOpenAiManifest(given: string): Listing {
  const listing = emptyListing();
  // The package root comes from the path the user gave (the parent of its .codex-plugin/.agent-plugin/.claude-plugin
  // folder, else its folder), resolved once: a linked manifest folder or a linked plugin.json does not move it. Only the
  // named file is then followed to its real path; every other file is read inside the real root (A06-03 guard).
  const name = basename(given);
  const inPluginDir = ['.codex-plugin', '.agent-plugin', '.claude-plugin'].includes(basename(dirname(given)));
  const rel = inPluginDir ? `${basename(dirname(given))}/${name}` : name;
  const root = packageRoot(given);
  let realRoot = root;
  try { realRoot = realpathSync(root); } catch { /* the manifest is missing too; nothing is read */ }
  let path = given;
  try { path = realpathSync(given); } catch { /* missing or a dangling link: readJson below reports it */ }
  const manifest = readJson(path, rel, 'openai', listing, dirname(path)) ?? (listing.errors.push({ source: 'openai', path: rel, message: 'does not exist' }), { path: rel, error: 'does not exist' });
  const format = openAiFormat(manifest.json);
  let mcp: ListingJson | undefined;
  if (format === 'mcp-config') mcp = manifest;
  else if (isObj(manifest.json) && typeof manifest.json.mcpServers === 'string') mcp = declaredMcp(realRoot, manifest.json.mcpServers, listing);
  else {
    for (const c of ['mcp.json', '.mcp.json']) {
      mcp = readJson(join(realRoot, c), c, 'openai', listing, realRoot);
      if (mcp) break;
    }
  }
  const { files } = walk(realRoot, 1, LISTING_FILES_CAP, 'openai', listing.errors);
  const images = format === 'codex' || format === 'agent-plugins' ? openAiImages(realRoot, manifest.json, format) : undefined;
  const openai: OpenAiListing = { manifest, format, ...(mcp ? { mcp } : {}), files, ...(images ? { images } : {}) };
  listing.openai = openai;
  return listing;
}
