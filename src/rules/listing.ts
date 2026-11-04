// LST: listing and plugin manifests (spec Q3, wave 6). Claude plugin folder (--plugin-dir) checks follow the plugin
// pre-submission checklist; ChatGPT package manifest (--openai-manifest) checks follow the OpenAI submission pages.
// Each message names the manual checklist item it automates, where there is one. Values that may be credentials
// (headers, env, clientSecret) are never quoted: the report redactor does not know them.
import type { Snapshot } from '../snapshot.js';
import type { ListingEntry, ListingImage, OpenAiListing, PluginListing } from '../listing/types.js';
import { defineRule, type RawFinding } from './types.js';
import { hostOf, isObj, isStr, listPreview, toolNames, type Obj } from './util/access.js';
import { displayUrl, isKnownToken, isSecretName } from './util/net.js';
import { snippet, wordCount } from './util/text.js';

const C_PSC = 'https://claude.com/docs/plugins/pre-submission-checklist';
const C_PREF = 'https://code.claude.com/docs/en/plugins-reference';
const O_SUBMIT = 'https://developers.openai.com/plugins/deploy/submission';
const O_ERRORS = 'https://developers.openai.com/plugins/deploy/submission-errors';

const plugin = (snap: Snapshot): PluginListing => snap.listing!.plugin!;
const oai = (snap: Snapshot): OpenAiListing => snap.listing!.openai!;
const chars = (s: string) => [...s].length;
const q = (s: string) => JSON.stringify(snippet(s, 0, s.length, 80));
const man = (id: string) => ` (${id})`;

// ---------------------------------------------------------------- Claude plugin helpers

function pluginManifest(p: PluginListing): Obj | undefined {
  return isObj(p.manifest?.json) ? p.manifest.json : undefined;
}

export interface ServerEntry { name: string; cfg: Obj; where: string }

/** An MCP configuration's server map: `{ "mcpServers": {...} }` or the bare map. */
function serverMap(json: unknown): Obj | undefined {
  if (!isObj(json)) return undefined;
  if (isObj(json.mcpServers)) return json.mcpServers;
  return 'mcpServers' in json ? undefined : json;
}

/** Server entries of `.mcp.json` and of plugin.json's inline mcpServers (object, or array with objects). */
export function pluginServers(p: PluginListing): ServerEntry[] {
  const out: ServerEntry[] = [];
  const add = (map: Obj | undefined, where: string) => {
    for (const [name, cfg] of Object.entries(map ?? {})) if (isObj(cfg)) out.push({ name, cfg, where });
  };
  add(serverMap(p.mcp?.json), '.mcp.json');
  const inline = pluginManifest(p)?.mcpServers;
  for (const m of Array.isArray(inline) ? inline : [inline]) if (isObj(m)) add(m, '.claude-plugin/plugin.json');
  return out;
}

/** plugin.json mcpServers strings (config paths, .mcpb/.dxt bundle paths or URLs). */
function pluginServerRefs(p: PluginListing): string[] {
  const inline = pluginManifest(p)?.mcpServers;
  return (Array.isArray(inline) ? inline : [inline]).filter(isStr);
}

const isRemote = (cfg: Obj) => cfg.url !== undefined || ['http', 'sse', 'ws', 'streamable-http'].includes(String(cfg.type));
const subject = (s: ServerEntry) => `server "${s.name}" in ${s.where}`;

/** command + args as one argv; a command with spaces and no args is split on whitespace. */
function argvOf(cfg: Obj): string[] {
  const cmd = isStr(cfg.command) ? cfg.command.trim() : '';
  const args = Array.isArray(cfg.args) ? cfg.args.filter(isStr) : [];
  return [...(args.length ? [cmd] : cmd.split(/\s+/)), ...args].filter(Boolean);
}

const NPM_EXACT = /^(@[^/@\s]+\/)?[^@\s/]+@\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
const PY_EXACT = /^[A-Za-z0-9][\w.-]*(\[[^\]]*\])?(==|@)\d[\w.!+-]*$/;
/** Options of the launchers that take a separate value (the value is not the package). */
const VALUE_FLAGS = new Set([
  '-p', '--package', '-c', '--call', '--cache', '--registry', '--userconfig', '--prefix', '--workspace', '-w',
  '--from', '--with', '--with-editable', '--with-requirements', '--python', '--index', '--index-url', '--extra-index-url',
  '--default-index', '--find-links', '-f', '--constraint', '--override', '--spec', '--pip-args', '--suffix', '--cwd',
]);
const launcherBase = (s: string) => s.split(/[\\/]/).pop()!.toLowerCase().replace(/\.(cmd|exe|ps1)$/, '');

export interface Launcher { launcher: string; spec?: string; pinned: boolean }

/** A package launcher in argv (npx, bunx, pnpm dlx, yarn dlx, uvx, pipx run, uv run) and whether it pins its package. */
export function launcherOf(argv: string[]): Launcher | undefined {
  const b0 = launcherBase(argv[0] ?? '');
  let launcher: string | undefined;
  let rest: string[] = [];
  if (['npx', 'bunx', 'uvx'].includes(b0)) { launcher = b0; rest = argv.slice(1); }
  else if ((b0 === 'pnpm' || b0 === 'yarn') && argv[1] === 'dlx') { launcher = `${b0} dlx`; rest = argv.slice(2); }
  else if (b0 === 'pipx' && argv[1] === 'run') { launcher = 'pipx run'; rest = argv.slice(2); }
  else if (b0 === 'uv' && argv[1] === 'run') {
    return { launcher: 'uv run', pinned: argv.includes('--locked') || argv.includes('--frozen') };
  }
  if (!launcher) return undefined;
  const python = launcher === 'uvx' || launcher === 'pipx run';
  // An explicit package option names the package; otherwise the first positional argument does.
  let spec: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    const [flag, inlineValue] = a.startsWith('--') && a.includes('=') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, undefined];
    if (['-p', '--package', '--from', '--spec'].includes(flag) && !(python && flag === '-p')) { spec = inlineValue ?? rest[i + 1]; break; }
    if (a.startsWith('-')) { if (VALUE_FLAGS.has(flag) && inlineValue === undefined) i++; continue; }
    spec = a;
    break;
  }
  if (!spec) return undefined;
  // A file in the plugin, a path or a variable is not a registry package.
  if (/^(\.{0,2}[\\/]|\$\{|[A-Za-z]:[\\/]|file:|https?:|git\+)/.test(spec)) return undefined;
  return { launcher, spec, pinned: python ? PY_EXACT.test(spec) : NPM_EXACT.test(spec) };
}

const REF = /\$\{([^}]*)\}/g;
const USER_CONFIG = /^user_config\.[A-Za-z_]\w*$/;
const PLUGIN_VAR = /^CLAUDE_(PLUGIN_ROOT|PLUGIN_DATA|PROJECT_DIR)$/;
const PLACEHOLDER = /^(<[^>]*>|\[[^\]]*\]|\{[^}]*\}|your[-_ ]|x{3,}|\.{3}|\*{3,}|changeme|placeholder|example|redacted|todo|tbd)/i;
const SECRET_HEADER = /^(authorization|proxy-authorization|cookie|x-api-key|api-key|x-auth-token)$/i;

/** The literal credential part of a header or env value: the value without ${...} references and auth scheme words. */
function literalPart(v: string): string {
  return v.replace(REF, ' ').replace(/^\s*(bearer|basic|token|apikey|api-key)\b/i, ' ').trim();
}

// ---------------------------------------------------------------- Claude plugin rules

export const LST_001 = defineRule(
  {
    id: 'LST-001', title: 'Plugin manifest .claude-plugin/plugin.json present and valid', severity: { claude: 'error' }, needs: ['plugin-dir'],
    rationale: 'The plugin directory blocks a submitted folder without .claude-plugin/plugin.json; the manifest must be a JSON object with a name.',
    fix: 'Add .claude-plugin/plugin.json at the plugin root with at least "name" (claude plugin validate checks its syntax).',
    sources: [C_PSC, C_PREF],
  },
  (snap) => {
    const p = plugin(snap);
    const m = p.manifest;
    const unreadable = snap.listing!.errors.find((e) => e.source === 'plugin' && e.path === '.');
    if (unreadable) return [{ message: `the plugin folder ${unreadable.message}` }];
    if (!m) {
      const skillsOnly = p.files.some((f) => /^skills\/[^/]+\/SKILL\.md$/.test(f.path)) && !p.files.some((f) => f.path.endsWith('plugin.json'));
      return [skillsOnly
        ? { severity: 'info', message: 'no .claude-plugin/plugin.json: a folder with skills/<name>/SKILL.md passes with a note and is listed for Claude Code only' }
        : { message: 'no .claude-plugin/plugin.json in the plugin folder' }];
    }
    if (m.error) return [{ path: m.path, message: `.claude-plugin/plugin.json ${m.error}` }];
    if (!isObj(m.json)) return [{ path: m.path, message: '.claude-plugin/plugin.json is not a JSON object' }];
    if (!isStr(m.json.name) || !m.json.name.trim()) return [{ path: m.path, message: '.claude-plugin/plugin.json has no "name" (the only required key)' }];
    return [];
  },
);

const RESERVED_WHOLE = new Set(['claude', 'anthropic', 'anthropics', 'official', 'plugin', 'mcp', 'test', 'claude-code', 'claude-mods']);
const RESERVED_PREFIX = /^(claude|anthropic|anthropics|cc-plugin)-/;

export const LST_002 = defineRule(
  {
    id: 'LST-002', title: 'Plugin name: lowercase letters, digits and hyphens, ≤64, not reserved', severity: { claude: 'error' }, needs: ['plugin-dir'],
    rationale: 'The directory blocks a non-ASCII or reserved plugin name (claude, anthropic, official, plugin, mcp, test, or one that passes as Anthropic\'s own) and warns on any other name outside the lowercase-hyphen pattern of up to 64 characters.',
    fix: 'Use a distinctive kebab-case name built around your product, up to 64 characters, starting and ending with a letter or digit.',
    sources: [C_PSC, `${C_PREF}#name`],
  },
  (snap) => {
    const name = pluginManifest(plugin(snap))?.name;
    if (!isStr(name) || !name.trim()) return []; // LST-001
    const path = '.claude-plugin/plugin.json';
    if (/[^\x20-\x7e]/.test(name)) return [{ path, message: `name ${q(name)} has non-ASCII characters (blocks: Non-ASCII identifier)` }];
    const norm = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (RESERVED_WHOLE.has(norm) || RESERVED_PREFIX.test(norm) || /(^|-)official(-|$)/.test(norm) && /(^|-)(claude|anthropic)(-|$)/.test(norm)) {
      return [{ path, message: `name ${q(name)} is reserved or passes as one of Anthropic's own` }];
    }
    if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(name)) {
      return [{ path, severity: 'warning', message: `name ${q(name)} is not lowercase letters, digits and hyphens of up to 64 characters starting and ending with a letter or digit` }];
    }
    return [];
  },
);

export const LST_003 = defineRule(
  {
    id: 'LST-003', title: 'Plugin manifest sets description, author and version', severity: { claude: 'warning' }, needs: ['plugin-dir'],
    rationale: 'The directory warns when plugin.json has no description, author or version; version should rise with every release.',
    fix: 'Set "description", "author": { "name": ... } and "version" in .claude-plugin/plugin.json.',
    sources: [C_PSC, C_PREF],
  },
  (snap) => {
    const m = pluginManifest(plugin(snap));
    if (!m) return [];
    const missing = [
      ...(!isStr(m.description) || !m.description.trim() ? ['description'] : []),
      ...(!isObj(m.author) || !isStr(m.author.name) || !m.author.name.trim() ? ['author.name'] : []),
      ...(!isStr(m.version) || !m.version.trim() ? ['version'] : []),
    ];
    return missing.length ? [{ path: '.claude-plugin/plugin.json', message: `plugin.json does not set ${missing.join(', ')}` }] : [];
  },
);

/** README text without fenced code blocks and inline code (words inside code blocks don't count). */
export function readmeProse(text: string): string {
  return text.replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(^ {0,3}\1[`~]*[ \t]*$|(?![\s\S]))/gm, ' ').replace(/`[^`\n]*`/g, ' ');
}

export const LST_004 = defineRule(
  {
    id: 'LST-004', title: 'Plugin README of at least 40 words', severity: { claude: 'error' }, needs: ['plugin-dir'],
    rationale: 'The directory shows the README as the listing description and blocks a plugin folder without one or with fewer than 40 words outside code blocks.',
    fix: 'Add README.md to the plugin folder describing what the plugin does, runs, sends and fetches (at least 40 words of prose).',
    sources: [C_PSC],
  },
  (snap) => {
    const r = plugin(snap).readme;
    if (!r) return [{ message: 'no README in the plugin folder (blocks: README missing)' }];
    const n = wordCount(readmeProse(r.text));
    // The word count approximates the portal's: a short README is a warning, a missing one an error.
    return n < 40 ? [{ path: r.path, severity: 'warning', message: `${r.path} has about ${n} words outside code blocks; the directory needs at least 40 (README too short)` }] : [];
  },
);

export const LST_005 = defineRule(
  {
    id: 'LST-005', title: 'Plugin has a LICENSE file or a license field', severity: { claude: 'error' }, needs: ['plugin-dir'],
    rationale: 'The directory requires a license before it lists a plugin and blocks one with neither a LICENSE file nor "license" in plugin.json.',
    fix: 'Add a LICENSE file to the plugin folder or set "license" (an SPDX identifier such as MIT) in plugin.json.',
    sources: [C_PSC],
  },
  (snap) => {
    const p = plugin(snap);
    const field = pluginManifest(p)?.license;
    return p.license || (isStr(field) && field.trim()) ? [] : [{ message: 'no LICENSE file in the plugin folder and no "license" in plugin.json (blocks: License missing)' }];
  },
);

export const LST_006 = defineRule(
  {
    id: 'LST-006', title: '.mcp.json is valid and every server entry has command or url', severity: { claude: 'error' }, needs: ['plugin-dir'],
    rationale: 'The directory blocks a .mcp.json that does not parse or a server entry that does not match the MCP configuration schema (command and args, or url).',
    fix: 'Make .mcp.json valid JSON of the form { "mcpServers": { "<name>": { "command": ..., "args": [...] } | { "type": "http", "url": ... } } }.',
    sources: [C_PSC, 'https://code.claude.com/docs/en/mcp'],
  },
  (snap) => {
    const p = plugin(snap);
    const out: RawFinding[] = [];
    if (p.mcp?.error) out.push({ path: p.mcp.path, message: `.mcp.json ${p.mcp.error} (blocks: .mcp.json can't be parsed)` });
    else if (p.mcp && !serverMap(p.mcp.json)) out.push({ path: p.mcp.path, message: '.mcp.json is not an object of MCP servers ({ "mcpServers": { ... } })' });
    const map = serverMap(p.mcp?.json);
    for (const [name, cfg] of Object.entries(map ?? {})) if (!isObj(cfg)) out.push({ path: '.mcp.json', message: `server "${name}" in .mcp.json is not an object` });
    for (const s of pluginServers(p)) {
      const hasCmd = isStr(s.cfg.command) && s.cfg.command.trim() !== '';
      const hasUrl = isStr(s.cfg.url);
      if (!hasCmd && !hasUrl) out.push({ path: s.where, message: `${subject(s)} has neither "command" nor "url"` });
      else if (hasCmd && hasUrl) out.push({ path: s.where, message: `${subject(s)} has both "command" and "url"` });
      if (s.cfg.args !== undefined && !(Array.isArray(s.cfg.args) && s.cfg.args.every(isStr))) out.push({ path: s.where, message: `${subject(s)}: "args" is not an array of strings` });
    }
    return out;
  },
);

/** A Claude plugin remote server URL the directory accepts: absolute https:// or wss://, a ${user_config.KEY} reference, or "". */
export function acceptedRemoteUrl(url: string): boolean {
  if (url === '' || /^\$\{user_config\.[A-Za-z_]\w*\}/.test(url)) return true;
  try {
    const u = new URL(url);
    return (u.protocol === 'https:' || u.protocol === 'wss:') && !!u.hostname;
  } catch {
    return false;
  }
}

export const LST_007 = defineRule(
  {
    id: 'LST-007', title: 'Remote plugin servers: type http, sse or ws and an https:// or wss:// URL', severity: { claude: 'error' }, needs: ['plugin-dir'],
    rationale: 'The directory blocks a remote MCP server whose type is not http, sse or ws, or whose url is not an absolute https:// or wss:// URL, a ${user_config.KEY} reference or "".',
    fix: 'Set "type": "http" (or "sse", "ws") and an https:// URL, or ask for the endpoint with userConfig and use "${user_config.KEY}".',
    sources: [C_PSC],
  },
  (snap) => pluginServers(plugin(snap)).filter((s) => isRemote(s.cfg)).flatMap((s): RawFinding[] => {
    const out: RawFinding[] = [];
    if (!['http', 'sse', 'ws'].includes(String(s.cfg.type))) out.push({ path: s.where, message: `${subject(s)} has type ${JSON.stringify(s.cfg.type ?? null)}; a remote server needs "http", "sse" or "ws"` });
    if (!isStr(s.cfg.url)) out.push({ path: s.where, message: `${subject(s)} has no string "url"` });
    else if (!acceptedRemoteUrl(s.cfg.url)) out.push({ path: s.where, message: `${subject(s)} url ${q(displayUrl(s.cfg.url))} is not an absolute https:// or wss:// URL (blocks: MCP server URL is not https)` });
    return out;
  }),
);

export const LST_008 = defineRule(
  {
    id: 'LST-008', title: 'Package launchers pin an exact version', severity: { claude: 'error' }, needs: ['plugin-dir'],
    rationale: 'The directory blocks a plugin whose MCP server runs a package through a launcher (npx, bunx, pnpm dlx, yarn dlx, uvx, pipx run) without an exact version, or uv run without --locked or --frozen.',
    fix: 'Pin the package exactly: npx <package>@1.2.3, uvx <package>==1.2.3; run uv run with --locked or --frozen. Or bundle the server in the plugin.',
    sources: [C_PSC],
  },
  (snap) => pluginServers(plugin(snap)).flatMap((s): RawFinding[] => {
    const l = launcherOf(argvOf(s.cfg));
    if (!l || l.pinned) return [];
    if (l.launcher === 'uv run') return [{ path: s.where, message: `${subject(s)} runs uv run without --locked or --frozen` }];
    return [{ path: s.where, message: `${subject(s)} runs ${l.launcher} ${q(l.spec!)} without an exact version${l.launcher === 'npx' || l.launcher === 'uvx' ? ` (blocks: Unpinned ${l.launcher} launcher)` : ''}` }];
  }),
);

/** A package-manager configuration line that sets a registry, index, proxy or other package source. */
const PACKAGE_SOURCE = /^\s*(\[\[?\s*(index|install\.scopes|install\.registry)[^\]]*\]\]?|(@[^\s:=]+:)?registry\s*[=:]|(https?-|no-)?proxy\s*[=:]|(extra-)?index(-url)?\s*[=:]|default-index\s*[=:]|find-links\s*[=:]|npmRegistryServer\s*:|npmScopes\s*:|httpsProxy\s*:|httpProxy\s*:)/im;

export const LST_009 = defineRule(
  {
    id: 'LST-009', title: 'No package-manager source configuration next to a launcher', severity: { claude: 'error' }, needs: ['plugin-dir'],
    rationale: 'In a plugin that uses a package launcher, the directory blocks a package-manager configuration file (.npmrc, bunfig.toml, uv.toml, ...) that sets a registry, index, proxy or other package source.',
    fix: 'Remove the registry, index or proxy settings (or the file) from the plugin folder; publish the package to the public registry or bundle it.',
    sources: [C_PSC],
  },
  (snap) => {
    const p = plugin(snap);
    const launcher = pluginServers(p).some((s) => launcherOf(argvOf(s.cfg)));
    if (!launcher) return [];
    return p.packageConfigs.filter((c) => PACKAGE_SOURCE.test(c.text)).map((c) => ({
      path: c.path, message: `${c.path} sets a package source (registry, index or proxy) in a plugin that uses a package launcher`,
    }));
  },
);

export const LST_010 = defineRule(
  {
    id: 'LST-010', title: 'MCP servers declared with command or url, not .mcpb/.dxt bundles', severity: { claude: 'warning' }, needs: ['plugin-dir'],
    rationale: 'The directory holds a plugin with an .mcpb or .dxt bundle for a reviewer (Bundled MCP server not inspected) and blocks a bundle fetched from a URL.',
    fix: 'Declare each MCP server in .mcp.json with "command" and "args" (or "url") instead of an MCP bundle.',
    sources: [C_PSC, `${C_PREF}#mcpservers`],
  },
  (snap) => {
    const p = plugin(snap);
    const out: RawFinding[] = [];
    for (const ref of pluginServerRefs(p)) {
      if (!/\.(mcpb|dxt)$/i.test(ref)) continue;
      if (/^https?:/i.test(ref)) out.push({ path: '.claude-plugin/plugin.json', severity: 'error', message: `mcpServers fetches the bundle ${q(displayUrl(ref))} from a URL` });
      else out.push({ path: '.claude-plugin/plugin.json', message: `mcpServers declares the bundle ${q(ref)}` });
    }
    const declared = new Set(pluginServerRefs(p).map((r) => r.replace(/^\.\//, '')));
    for (const f of p.files) if (f.kind === 'file' && /\.(mcpb|dxt)$/i.test(f.path) && !declared.has(f.path)) out.push({ path: f.path, message: `the plugin folder contains the MCP bundle ${f.path}` });
    return out;
  },
);

export const LST_011 = defineRule(
  {
    id: 'LST-011', title: 'No credentials in MCP server headers or env', severity: { claude: 'error' }, needs: ['plugin-dir'],
    rationale: 'The directory blocks a real credential in any plugin file (Secret in MCP headers) and holds a plugin that reads a credential from the user\'s environment; values come from userConfig with sensitive: true.',
    fix: 'Declare the value in plugin.json userConfig with "sensitive": true and reference it as ${user_config.KEY}; never commit the credential.',
    sources: [C_PSC, `${C_PREF}#user-configuration`],
  },
  (snap) => pluginServers(plugin(snap)).flatMap((s): RawFinding[] => {
    const out: RawFinding[] = [];
    const check = (kind: 'header' | 'env', obj: unknown) => {
      if (!isObj(obj)) return;
      for (const [k, v] of Object.entries(obj)) {
        if (!isStr(v)) continue;
        const secretName = kind === 'header' ? SECRET_HEADER.test(k) || isSecretName(k) : isSecretName(k);
        for (const m of v.matchAll(REF)) {
          const ref = m[1].trim();
          if (USER_CONFIG.test(ref) || PLUGIN_VAR.test(ref)) continue;
          if (secretName || isSecretName(ref)) out.push({ path: s.where, severity: 'warning', message: `${kind} "${k}" of ${subject(s)} reads \${${ref}} from the user's environment (held: Uses a credential from the user's machine)` });
        }
        const lit = literalPart(v);
        if (!lit || PLACEHOLDER.test(lit)) continue;
        // A known token format is a credential for certain; a literal under a credential name is likely one.
        if (isKnownToken(lit)) out.push({ path: s.where, message: `${kind} "${k}" of ${subject(s)} holds a literal credential in a known token format (value not shown)` });
        else if (secretName && lit.length >= 8) out.push({ path: s.where, severity: 'warning', message: `${kind} "${k}" of ${subject(s)} holds a literal value that looks like a credential (value not shown)` });
      }
    };
    check('header', s.cfg.headers);
    check('env', s.cfg.env);
    return out;
  }),
);

const SYSTEM_FILE = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|__MACOSX)$/i;

export const LST_012 = defineRule(
  {
    id: 'LST-012', title: 'No macOS or Windows system files in the plugin folder', severity: { claude: 'error' }, needs: ['plugin-dir'],
    rationale: 'The directory blocks a plugin folder with .DS_Store, Thumbs.db, desktop.ini or __MACOSX entries.',
    fix: 'Delete the system files and add them to .gitignore.',
    sources: [C_PSC],
  },
  (snap) => {
    const hits = plugin(snap).files.filter((f) => SYSTEM_FILE.test(f.path)).map((f) => f.path);
    return hits.length ? [{ message: `system files in the plugin folder: ${listPreview(hits)}` }] : [];
  },
);

const MEDIA = /\.(png|jpe?g|gif|webp|svg|ttf|otf|woff2?|eot)$/i;
const BINARY = /\.(ico|pdf|zip|gz|tgz|tar|7z|rar|jar|class|exe|dll|so|dylib|bin|wasm|node|pyc|o|a|dmg|pkg|deb|rpm|docx?|xlsx?|pptx?)$/i;

export const LST_013 = defineRule(
  {
    id: 'LST-013', title: 'Plugin files within the reviewer-free limits (size, count, type, no links)', severity: { claude: 'warning' }, needs: ['plugin-dir'],
    rationale: 'The directory holds for a reviewer a plugin with a non-image file over 256 KiB, more than 512 files or a binary other than images and fonts, and blocks links the plugin loads.',
    fix: 'Keep text files under 256 KiB and the plugin to 512 files; remove binaries; commit regular files instead of symbolic links.',
    sources: [C_PSC],
  },
  (snap) => {
    const p = plugin(snap);
    const files = p.files.filter((f) => f.kind === 'file');
    const out: RawFinding[] = [];
    const big = files.filter((f) => f.size > 256 * 1024 && !MEDIA.test(f.path));
    if (big.length) out.push({ message: `${big.length} file${big.length === 1 ? '' : 's'} over 256 KiB: ${listPreview(big.map((f) => `${f.path} (${Math.ceil(f.size / 1024)} KiB)`))}` });
    if (files.length > 512 || p.filesTruncated) out.push({ message: `the plugin has ${p.filesTruncated ? 'more than ' : ''}${files.length} files; over 512 is held for a reviewer` });
    const bin = files.filter((f) => BINARY.test(f.path));
    if (bin.length) out.push({ message: `binary files the validator can't inspect: ${listPreview(bin.map((f) => f.path))}` });
    const links: ListingEntry[] = p.files.filter((f) => f.kind === 'symlink');
    if (links.length) out.push({ message: `symbolic links (blocked where the plugin loads them): ${listPreview(links.map((f) => f.path))}` });
    return out;
  },
);

const LISTING_URLS = ['documentationUrl', 'supportUrl', 'privacyPolicyUrl', 'termsOfServiceUrl'] as const;

export const LST_014 = defineRule(
  {
    id: 'LST-014', title: 'Plugin directory listing fields: https URLs and an icon in the plugin', severity: { claude: 'warning' }, needs: ['plugin-dir'],
    rationale: 'The directory reads icon, documentationUrl, supportUrl, privacyPolicyUrl and termsOfServiceUrl from plugin.json for the listing; each URL is an https:// URL and icon an image file inside the plugin.',
    fix: 'Set documentationUrl, supportUrl and privacyPolicyUrl (and termsOfServiceUrl) to https:// URLs and icon to a ./ path of an image in the plugin.',
    sources: [`${C_PREF}#directory-listing-fields`, 'https://claude.com/docs/connectors/building/submission'],
  },
  (snap) => {
    const p = plugin(snap);
    const m = pluginManifest(p);
    if (!m) return [];
    const path = '.claude-plugin/plugin.json';
    const out: RawFinding[] = [];
    for (const k of LISTING_URLS) {
      const v = m[k];
      if (v === undefined) { if (k !== 'termsOfServiceUrl') out.push({ path, severity: 'info', message: `plugin.json has no ${k} for the directory listing${man('MAN-002')}` }); continue; }
      let ok = false;
      try { ok = isStr(v) && new URL(v).protocol === 'https:'; } catch { /* not a URL */ }
      if (!ok) out.push({ path, message: `${k} ${isStr(v) ? q(displayUrl(v)) : JSON.stringify(v)} is not an https:// URL${man('MAN-002')}` });
    }
    const icon = m.icon;
    if (icon === undefined) out.push({ path, severity: 'info', message: `plugin.json has no icon for the directory listing${man('MAN-002')}` });
    else if (!isStr(icon) || !MEDIA.test(icon)) out.push({ path, message: `icon ${JSON.stringify(icon)} is not an image file path${man('MAN-002')}` });
    else if (!p.files.some((f) => f.kind === 'file' && f.path === icon.replace(/^\.\//, ''))) out.push({ path, message: `icon ${q(icon)} is not a file in the plugin folder${man('MAN-002')}` });
    return out;
  },
);

/** Remote server URLs of a server list that name a concrete host (not a ${...} reference or ""). */
function concreteUrls(servers: ServerEntry[]): Array<{ s: ServerEntry; url: URL }> {
  return servers.flatMap((s) => {
    if (!isStr(s.cfg.url) || !s.cfg.url || s.cfg.url.includes('${')) return [];
    try { return [{ s, url: new URL(s.cfg.url) }]; } catch { return []; }
  });
}

function hostMismatch(snap: Snapshot, servers: ServerEntry[]): RawFinding[] {
  const host = hostOf(snap);
  const urls = concreteUrls(servers);
  if (!host || !urls.length || urls.some((u) => u.url.hostname.toLowerCase() === host)) return [];
  return urls.map((u) => ({ path: u.s.where, message: `${subject(u.s)} points at ${q(displayUrl(u.url.href))}, not at the checked server host ${host}` }));
}

export const LST_015 = defineRule(
  {
    id: 'LST-015', title: 'Plugin remote server URL matches the checked server', severity: { claude: 'warning' }, needs: ['plugin-dir', 'http'],
    rationale: 'The findings for the checked URL say little about the plugin when its .mcp.json points users at another host.',
    fix: 'Check the URL the plugin ships (or update .mcp.json to the server you checked).',
    sources: [C_PSC],
  },
  (snap) => hostMismatch(snap, pluginServers(plugin(snap)).filter((s) => isRemote(s.cfg))),
);

// ---------------------------------------------------------------- ChatGPT package helpers

function openAiExt(o: OpenAiListing): Obj | undefined {
  const j = o.manifest.json;
  const ext = isObj(j) && isObj(j.extensions) ? j.extensions['com.openai'] : undefined;
  return isObj(ext) ? ext : undefined;
}

/** The listing object: extensions.com.openai.interface (Agent Plugins) or the root interface (Codex). */
export function openAiInterface(o: OpenAiListing): Obj | undefined {
  const j = o.manifest.json;
  if (o.format === 'codex' && isObj(j) && isObj(j.interface)) return j.interface;
  const i = openAiExt(o)?.interface;
  return o.format === 'agent-plugins' && isObj(i) ? i : undefined;
}

const ifacePath = (o: OpenAiListing) => (o.format === 'codex' ? 'interface' : 'extensions.com.openai.interface');

export function openAiServers(o: OpenAiListing): ServerEntry[] {
  return Object.entries(serverMap(o.mcp?.json) ?? {}).flatMap(([name, cfg]) => (isObj(cfg) ? [{ name, cfg, where: o.mcp!.path }] : []));
}

/** Every key path under `value` whose key is in `keys` (iterative, bounded). */
function findKeys(value: unknown, keys: Set<string>, base: string): string[] {
  const out: string[] = [];
  const stack: Array<{ v: unknown; p: string }> = [{ v: value, p: base }];
  let seen = 0;
  for (let n = stack.pop(); n && seen < 100_000; n = stack.pop(), seen++) {
    if (n.v === null || typeof n.v !== 'object') continue;
    for (const [k, v] of Object.entries(n.v as Obj)) {
      const p = n.p ? `${n.p}.${k}` : k;
      if (keys.has(k)) out.push(p);
      stack.push({ v, p });
    }
  }
  return out.sort();
}

const singleLine = (s: string) => !/[\r\n]/.test(s);

// ---------------------------------------------------------------- ChatGPT package rules

export const LST_016 = defineRule(
  {
    id: 'LST-016', title: 'ChatGPT package manifest parses and has listing fields', severity: { chatgpt: 'error' }, needs: ['openai-manifest'],
    rationale: 'The OpenAI portal reads the listing from plugin.json (extensions.com.openai.interface) or a Codex manifest (.codex-plugin/plugin.json, root interface); mcp.json holds only the MCP configuration.',
    fix: 'Pass the package plugin.json; put displayName, shortDescription, longDescription and the listing URLs under extensions.com.openai.interface (or interface for Codex).',
    sources: [O_SUBMIT, O_ERRORS],
  },
  (snap) => {
    const o = oai(snap);
    const path = o.manifest.path;
    if (o.manifest.error) return [{ path, message: `${path} ${o.manifest.error}${man('MAN-015')}` }];
    if (!isObj(o.manifest.json)) return [{ path, message: `${path} is not a JSON object${man('MAN-015')}` }];
    if (o.format === 'mcp-config') return [{ path, severity: 'warning', message: `${path} is an MCP configuration only; the listing fields live in plugin.json (extensions.com.openai.interface), so they were not checked${man('MAN-015')}` }];
    if (!openAiInterface(o)) return [{ path, message: `${path} has no extensions.com.openai.interface or root interface object with the listing fields${man('MAN-015')}` }];
    return [];
  },
);

export const OPENAI_CATEGORIES = [
  'Productivity', 'Creativity', 'Developer Tools', 'Business & Operations', 'Data & Analytics', 'Communication',
  'Education & Research', 'Security', 'Finance', 'Healthcare', 'Travel', 'Entertainment', 'Other',
];

export const LST_017 = defineRule(
  {
    id: 'LST-017', title: 'ChatGPT listing text within the final-submission limits', severity: { chatgpt: 'error' }, needs: ['openai-manifest'],
    rationale: 'Final submission requires displayName and shortDescription of at most 30 characters (one line), longDescription of at most 4000, developerName of at most 80, a known category and at most 20 capabilities of at most 120 characters.',
    fix: 'Shorten the fields to the final-submission limits (the package upload accepts longer drafts) and use a category from the dashboard list.',
    sources: [O_ERRORS, O_SUBMIT],
  },
  (snap) => {
    const o = oai(snap);
    const i = openAiInterface(o);
    if (!i) return [];
    const path = o.manifest.path;
    const at = ifacePath(o);
    const out: RawFinding[] = [];
    const text = (key: string, max: number, oneLine: boolean, required: 'error' | 'info' = 'error') => {
      const v = i[key];
      if (v === undefined || v === null || (isStr(v) && !v.trim())) { out.push({ path, severity: required, message: `${at}.${key} is ${v === undefined ? 'missing' : 'empty'}${required === 'info' ? ' (the portal sets it from your verified developer identity for ZIP uploads)' : ''}${man('MAN-015')}` }); return; }
      if (!isStr(v)) { out.push({ path, message: `${at}.${key} is not a string${man('MAN-015')}` }); return; }
      if (chars(v) > max) out.push({ path, message: `${at}.${key} is ${chars(v)} characters (max ${max}): ${q(v)}${man('MAN-015')}` });
      if (oneLine && !singleLine(v)) out.push({ path, message: `${at}.${key} spans several lines; it must be one line${man('MAN-015')}` });
    };
    text('displayName', 30, true);
    text('shortDescription', 30, true);
    text('longDescription', 4000, false);
    text('developerName', 80, true, 'info');
    const cat = i.category;
    if (cat === undefined) out.push({ path, severity: 'info', message: `${at}.category is missing; the listing uses Other${man('MAN-015')}` });
    else if (!isStr(cat) || !OPENAI_CATEGORIES.includes(cat)) out.push({ path, message: `${at}.category ${JSON.stringify(cat)} is not one of ${OPENAI_CATEGORIES.join(', ')}${man('MAN-015')}` });
    const caps = i.capabilities;
    if (caps !== undefined) {
      if (!Array.isArray(caps)) out.push({ path, message: `${at}.capabilities is not an array of strings${man('MAN-015')}` });
      else {
        if (caps.length > 20) out.push({ path, message: `${at}.capabilities has ${caps.length} entries (max 20)${man('MAN-015')}` });
        caps.forEach((c, n) => {
          if (!isStr(c) || !c.trim()) out.push({ path, message: `${at}.capabilities[${n}] is empty or not a string${man('MAN-015')}` });
          else if (chars(c) > 120 || !singleLine(c)) out.push({ path, message: `${at}.capabilities[${n}] is ${singleLine(c) ? `${chars(c)} characters (max 120)` : 'not one line'}${man('MAN-015')}` });
        });
      }
    } else if (o.format === 'codex') out.push({ path, message: `${at}.capabilities is missing (required in the Codex format; use [])${man('MAN-015')}` });
    return out;
  },
);

/** Why a listing URL is rejected, or undefined when it is an HTTPS URL with a host, no credentials and ≤1024 characters. */
export function listingUrlProblem(v: unknown): string | undefined {
  if (!isStr(v)) return 'is not a string';
  if (!v.trim()) return 'is empty';
  if (/[\s\x00-\x1f\x7f]/.test(v)) return 'contains whitespace or control characters';
  let u: URL;
  try { u = new URL(v); } catch { return 'is not a URL'; }
  if (u.protocol !== 'https:') return 'is not HTTPS';
  if (!u.hostname) return 'has no host';
  if (u.username || u.password) return 'embeds credentials';
  if (v.length > 1024) return `is ${v.length} characters (max 1024)`;
  return undefined;
}

export const LST_018 = defineRule(
  {
    id: 'LST-018', title: 'ChatGPT listing URLs: four HTTPS URLs without credentials, ≤1024 characters', severity: { chatgpt: 'error' }, needs: ['openai-manifest'],
    rationale: 'Remote MCP submissions require websiteURL, supportURL, privacyPolicyURL and termsOfServiceURL as HTTPS URLs with a host, no embedded credentials and at most 1024 characters.',
    fix: 'Set all four URLs in the listing to public https:// pages of your own (homepage and author.url do not fill them).',
    sources: [O_SUBMIT, O_ERRORS],
  },
  (snap) => {
    const o = oai(snap);
    const i = openAiInterface(o);
    if (!i) return [];
    return ['websiteURL', 'supportURL', 'privacyPolicyURL', 'termsOfServiceURL'].flatMap((k): RawFinding[] => {
      const v = i[k];
      if (v === undefined) return [{ path: o.manifest.path, message: `${ifacePath(o)}.${k} is missing (required for MCP review)${man('MAN-016')}` }];
      const why = listingUrlProblem(v);
      return why ? [{ path: o.manifest.path, message: `${ifacePath(o)}.${k}${isStr(v) && v ? ` ${q(displayUrl(v))}` : ''} ${why}${man('MAN-016')}` }] : [];
    });
  },
);

/** A starter prompt for the uniqueness check (the portal's normalization is not documented: heuristic). */
const normPrompt = (s: string) => s.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

export const LST_019 = defineRule(
  {
    id: 'LST-019', title: 'ChatGPT starter prompts: ≤3, one line, ≤128 characters, unique, no @mentions', severity: { chatgpt: 'error' }, needs: ['openai-manifest'],
    rationale: 'defaultPrompt takes at most three non-empty one-line prompts of at most 128 characters for final submission, unique after normalization and without MCP server @mentions.',
    fix: 'Keep up to three distinct, single-line starter prompts of at most 128 characters, without @mentions.',
    sources: [O_ERRORS, O_SUBMIT],
  },
  (snap) => {
    const o = oai(snap);
    const i = openAiInterface(o);
    const dp = i?.defaultPrompt;
    if (dp === undefined || dp === null) return [];
    const path = o.manifest.path;
    const at = `${ifacePath(o)}.defaultPrompt`;
    const list = Array.isArray(dp) ? dp : [dp];
    const out: RawFinding[] = [];
    if (list.length > 3) out.push({ path, message: `${at} has ${list.length} prompts (max 3)${man('MAN-017')}` });
    const seen = new Set<string>();
    list.forEach((p, n) => {
      if (!isStr(p) || !p.trim()) { out.push({ path, message: `${at}[${n}] is empty or not a string${man('MAN-017')}` }); return; }
      if (chars(p) > 128) out.push({ path, message: `${at}[${n}] is ${chars(p)} characters (max 128): ${q(p)}${man('MAN-017')}` });
      if (!singleLine(p)) out.push({ path, message: `${at}[${n}] spans several lines${man('MAN-017')}` });
      if (/(^|[\s(])@[A-Za-z0-9][\w.-]*/.test(p)) out.push({ path, severity: 'warning', message: `${at}[${n}] seems to @mention a server: ${q(p)}${man('MAN-017')}` });
      const k = normPrompt(p);
      if (seen.has(k)) out.push({ path, severity: 'warning', message: `${at}[${n}] repeats an earlier prompt: ${q(p)}${man('MAN-017')}` });
      seen.add(k);
    });
    return out;
  },
);

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** WCAG 2 contrast ratio of two #RRGGBB colors. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

export const LST_020 = defineRule(
  {
    id: 'LST-020', title: 'ChatGPT brand colors #RRGGBB with ≥2:1 contrast', severity: { chatgpt: 'error' }, needs: ['openai-manifest'],
    rationale: 'brandColor must be a six-digit hex color with at least 2:1 contrast against white, and brandColorDark at least 2:1 against #212121.',
    fix: 'Pick a darker brandColor (or a lighter brandColorDark) until the contrast is 2:1 or more.',
    sources: [O_ERRORS, O_SUBMIT],
  },
  (snap) => {
    const o = oai(snap);
    const i = openAiInterface(o);
    if (!i) return [];
    const out: RawFinding[] = [];
    for (const [key, bg] of [['brandColor', '#FFFFFF'], ['brandColorDark', '#212121']] as const) {
      const v = i[key];
      if (v === undefined) continue;
      if (!isStr(v) || !/^#[0-9A-Fa-f]{6}$/.test(v)) { out.push({ path: o.manifest.path, message: `${ifacePath(o)}.${key} ${JSON.stringify(v)} is not #RRGGBB${man('MAN-018')}` }); continue; }
      const r = contrast(v, bg);
      if (r < 2) out.push({ path: o.manifest.path, message: `${ifacePath(o)}.${key} ${v} has ${r.toFixed(2)}:1 contrast against ${bg} (min 2:1)${man('MAN-018')}` });
    }
    return out;
  },
);

const IMAGE = /\.(png|jpe?g|webp|svg)$/i;

export const LST_021 = defineRule(
  {
    id: 'LST-021', title: 'ChatGPT icons: logo and composerIcon as ./ paths to PNG, JPEG, WebP or SVG', severity: { chatgpt: 'error' }, needs: ['openai-manifest'],
    rationale: 'The dashboard needs a primary icon (logo) before submission and the Codex format requires logo and composerIcon; images are PNG, JPEG, WebP or SVG at ./-prefixed paths.',
    fix: 'Set logo and composerIcon to ./assets/... paths of square PNG, JPEG, WebP or SVG images (48–4096 px, ≤5 MiB) included in the package.',
    sources: [O_SUBMIT, O_ERRORS],
  },
  (snap) => {
    const o = oai(snap);
    const i = openAiInterface(o);
    if (!i) return [];
    const path = o.manifest.path;
    const at = ifacePath(o);
    const out: RawFinding[] = [];
    for (const key of ['logo', 'composerIcon']) {
      if (i[key] !== undefined) continue;
      out.push(o.format === 'codex'
        ? { path, message: `${at}.${key} is missing (required in the Codex format)${man('MAN-019')}` }
        : { path, severity: 'warning', message: `${at}.${key} is missing${key === 'logo' ? '; the dashboard requires a primary icon before submission' : ''}${man('MAN-019')}` });
    }
    const imgs = ['logo', 'logoDark', 'composerIcon', 'composerIconDark'].map((k) => [k, i[k]] as const);
      // screenshots are checked by LST-028 (MAN-024)
    for (const [k, v] of imgs) {
      if (v === undefined) continue;
      if (!isStr(v) || !IMAGE.test(v)) out.push({ path, message: `${at}.${k} ${isStr(v) ? q(displayUrl(v)) : JSON.stringify(v)} is not a PNG, JPEG, WebP or SVG file${man('MAN-019')}` });
      else if (!v.startsWith('./') || v.split('/').includes('..')) out.push({ path, severity: 'warning', message: `${at}.${k} ${q(displayUrl(v))} is not a ./ path inside the package${man('MAN-019')}` });
    }
    return out;
  },
);

export const LST_022 = defineRule(
  {
    id: 'LST-022', title: 'ChatGPT review: exactly 5 positive and 3 negative test cases, demo URL, release notes', severity: { chatgpt: 'error' }, needs: ['openai-manifest'],
    rationale: 'Initial MCP app review requires exactly five positive and three negative test cases (description and prompt; positive ones also tools_triggered and expected_behavior), a demo recording URL and release notes.',
    fix: 'Add extensions.com.openai.review.test_cases with 5 positive and 3 negative cases, review.demo_recording_url and publication.release_notes.',
    sources: [O_SUBMIT, O_ERRORS],
  },
  (snap) => {
    const o = oai(snap);
    if (!openAiInterface(o) || !openAiServers(o).length) return []; // skills-only packages need no MCP review cases
    const ext = openAiExt(o);
    const review = isObj(ext?.review) ? ext.review : undefined;
    const pub = isObj(ext?.publication) ? ext.publication : undefined;
    const path = o.manifest.path;
    const at = 'extensions.com.openai.review';
    const out: RawFinding[] = [];
    const tc = review?.test_cases;
    if (tc === undefined || tc === null) out.push({ path, severity: 'warning', message: `${at}.test_cases is missing: initial MCP review needs 5 positive and 3 negative cases (an update without it keeps the dashboard's cases)${man('MAN-020')}` });
    else if (!isObj(tc)) out.push({ path, message: `${at}.test_cases is not an object${man('MAN-020')}` });
    else {
      for (const [kind, want] of [['positive', 5], ['negative', 3]] as const) {
        const list = tc[kind];
        if (!Array.isArray(list)) { out.push({ path, message: `${at}.test_cases.${kind} is not an array (${want} cases required)${man('MAN-020')}` }); continue; }
        if (list.length !== want) out.push({ path, message: `${at}.test_cases.${kind} has ${list.length} case${list.length === 1 ? '' : 's'}; exactly ${want} are required${man('MAN-020')}` });
        list.forEach((c, n) => {
          const need = kind === 'positive' ? ['description', 'prompt', 'tools_triggered', 'expected_behavior'] : ['description', 'prompt'];
          const missing = need.filter((f) => !isObj(c) || !(isStr(c[f]) ? c[f].trim() : Array.isArray(c[f]) && c[f].length));
          if (missing.length) out.push({ path, message: `${at}.test_cases.${kind}[${n}] has no ${missing.join(', ')}${man('MAN-020')}` });
          if (kind === 'positive' && isObj(c) && isStr(c.description) && chars(c.description) > 4000) out.push({ path, message: `${at}.test_cases.positive[${n}].description is over 4000 characters${man('MAN-020')}` });
        });
      }
    }
    const demo = review?.demo_recording_url;
    if (demo === undefined || demo === null) out.push({ path, severity: 'warning', message: `${at}.demo_recording_url is missing (required for MCP review; omitting it keeps a saved value)${man('MAN-021')}` });
    else if (listingUrlProblem(demo)) out.push({ path, message: `${at}.demo_recording_url ${listingUrlProblem(demo)}${man('MAN-021')}` });
    const notes = pub?.release_notes;
    if (notes === undefined || notes === null) out.push({ path, severity: 'warning', message: `extensions.com.openai.publication.release_notes is missing (final submission requires release notes)${man('MAN-020')}` });
    else if (!isStr(notes) || !notes.trim()) out.push({ path, message: `extensions.com.openai.publication.release_notes is empty${man('MAN-020')}` });
    return out;
  },
);

export const LST_023 = defineRule(
  {
    id: 'LST-023', title: 'ChatGPT package: no credentials, reviewer data, server headers, apps or hooks', severity: { chatgpt: 'error' }, needs: ['openai-manifest'],
    rationale: 'The manifest rejects clientSecret, ZIP metadata rejects test_credentials and reviewer_instructions, public submission rejects non-empty server headers, and ZIPs with apps/.app.json or lifecycle hooks cannot be submitted.',
    fix: 'Remove these from the package: enter the client secret and reviewer access in the portal, drop server headers, apps/.app.json and hooks.',
    sources: [O_SUBMIT, O_ERRORS],
  },
  (snap) => {
    const o = oai(snap);
    const out: RawFinding[] = [];
    const mpath = o.manifest.path;
    if (o.format !== 'mcp-config') {
      for (const p of findKeys(o.manifest.json, new Set(['test_credentials', 'reviewer_instructions']), '')) out.push({ path: mpath, message: `${mpath} has ${p}; enter reviewer access in the dashboard form instead (value not shown)${man('MAN-023')}` });
      const j = o.manifest.json;
      if (isObj(j) && j.apps !== undefined) out.push({ path: mpath, message: `${mpath} declares "apps"; ZIP uploads must not include apps or .app.json${man('MAN-023')}` });
      for (const p of findKeys(j, new Set(['hooks']), '')) out.push({ path: mpath, message: `${mpath} declares ${p}; remove hooks before public submission${man('MAN-023')}` });
    }
    if (o.files.some((f) => f.path === '.app.json')) out.push({ path: '.app.json', message: `the package root has .app.json; ZIP uploads must not include it${man('MAN-023')}` });
    if (o.files.some((f) => f.path === 'hooks' && f.kind === 'dir')) out.push({ path: 'hooks', message: `the package root has a hooks/ folder; remove lifecycle hooks before public submission${man('MAN-023')}` });
    if (o.mcp?.json !== undefined) {
      for (const p of findKeys(o.mcp.json, new Set(['clientSecret', 'client_secret']), '')) out.push({ path: o.mcp.path, message: `${o.mcp.path} has ${p}; the manifest rejects clientSecret, enter it in the portal (value not shown)${man('MAN-023')}` });
    }
    for (const s of openAiServers(o)) {
      if (isObj(s.cfg.headers) && Object.keys(s.cfg.headers).length) out.push({ path: s.where, message: `${subject(s)} has headers (${listPreview(Object.keys(s.cfg.headers))}); public submission rejects non-empty server headers (values not shown)${man('MAN-023')}` });
    }
    return out;
  },
);

export const LST_024 = defineRule(
  {
    id: 'LST-024', title: 'ChatGPT package: one remote MCP server with an https URL', severity: { chatgpt: 'warning' }, needs: ['openai-manifest'],
    rationale: 'Plugin-level review test cases require exactly one MCP server, and local MCP configuration is excluded unless the organization is approved.',
    fix: 'Configure exactly one remote MCP server with an https:// url in mcp.json, or declare the test cases per server.',
    sources: [O_SUBMIT, O_ERRORS],
  },
  (snap) => {
    const o = oai(snap);
    const servers = openAiServers(o);
    const out: RawFinding[] = [];
    if (o.mcp?.error) out.push({ path: o.mcp.path, severity: 'error', message: `${o.mcp.path} ${o.mcp.error}` });
    const tc = openAiExt(o)?.review;
    if (servers.length > 1 && isObj(tc) && tc.test_cases !== undefined) out.push({ path: o.mcp!.path, message: `${o.mcp!.path} has ${servers.length} servers; plugin-level review.test_cases requires exactly one${man('MAN-020')}` });
    for (const s of servers) {
      if (!isStr(s.cfg.url)) { out.push({ path: s.where, message: `${subject(s)} is a local server (no url); local MCP configuration is excluded unless your organization is approved` }); continue; }
      const why = listingUrlProblem(s.cfg.url);
      if (why) out.push({ path: s.where, message: `${subject(s)} url ${q(displayUrl(s.cfg.url))} ${why}` });
    }
    return out;
  },
);

/** tools_triggered names: a comma-separated string (the documented type) or an array of names. */
export function triggeredTools(v: unknown): string[] {
  const parts = isStr(v) ? v.split(',') : Array.isArray(v) ? v.filter(isStr) : [];
  return parts.map((s) => s.trim()).filter(Boolean);
}

export const LST_025 = defineRule(
  {
    id: 'LST-025', title: 'ChatGPT test cases trigger tools the server lists', severity: { chatgpt: 'warning' }, needs: ['openai-manifest', 'tools'],
    rationale: 'Reviewers run each positive test case and expect the tools named in tools_triggered; a name missing from tools/list cannot be triggered.',
    fix: 'Use the exact tool names from tools/list in tools_triggered (comma-separated).',
    sources: [O_SUBMIT],
  },
  (snap) => {
    const o = oai(snap);
    const tc = openAiExt(o)?.review;
    const positive = isObj(tc) && isObj(tc.test_cases) && Array.isArray(tc.test_cases.positive) ? tc.test_cases.positive : [];
    const names = new Set(toolNames(snap));
    return positive.flatMap((c, n): RawFinding[] => {
      const missing = isObj(c) ? triggeredTools(c.tools_triggered).filter((t) => !names.has(t)) : [];
      return missing.length ? [{ path: o.manifest.path, message: `review.test_cases.positive[${n}] triggers ${listPreview(missing.map((t) => q(t)))}, not in tools/list${man('MAN-020')}` }] : [];
    });
  },
);

export const LST_026 = defineRule(
  {
    id: 'LST-026', title: 'ChatGPT package MCP server URL matches the checked server', severity: { chatgpt: 'warning' }, needs: ['openai-manifest', 'http'],
    rationale: 'The findings for the checked URL say little about the package when its mcp.json points at another host.',
    fix: 'Check the URL the package ships (or update mcp.json to the server you checked).',
    sources: [O_SUBMIT],
  },
  (snap) => hostMismatch(snap, openAiServers(oai(snap))),
);

// ---------------------------------------------------------------- image sizes (listing.openai.images, src/listing/image.ts)

const PROBLEM_TEXT: Record<NonNullable<ListingImage['problem']>, string> = {
  'not-a-path': 'is not a file path',
  outside: 'is not a ./ path inside the package, so it was not read',
  link: 'is a symbolic link, so it was not read',
  'not-file': 'is not a regular file',
  missing: 'does not exist in the package',
  'too-large': "is over this tool's 64 MiB read cap and was not opened",
  unreadable: 'could not be read',
  'unknown-format': 'is not a PNG, JPEG, WebP or SVG image (no matching file signature)',
  'no-dimensions': 'has no readable width and height',
};
const MIB = 1024 * 1024;

function imagesOf(o: OpenAiListing, pick: (key: string) => boolean): ListingImage[] {
  return (o.images ?? []).filter((im) => pick(im.key));
}

/** Whether LST-021 already reports this ref as not a ./ path inside the package. */
const notInsidePath = (ref: string) => !ref.startsWith('./') || ref.split('/').includes('..');

/** Findings for a file that could not be measured; undefined when it has a size or another rule owns the problem.
 *  SVG without a size is only info (it scales); any other recognised file whose header could not be parsed is a
 *  warning (our reader, not a vendor rule). A ref that is not a ./ path inside the package is a warning, as in LST-021;
 *  for icons LST-021 reports it, and a wrong file type, itself. This tool's own read cap is a warning (not checked). */
function unmeasured(at: string, im: ListingImage, id: string, icon: boolean): RawFinding | undefined {
  if (!im.problem) return undefined;
  const label = `${at}.${im.key} ${q(displayUrl(im.ref))}`;
  const detail = im.problem === 'unreadable' && im.detail ? ` (${im.detail})` : '';
  const text = `${label} ${PROBLEM_TEXT[im.problem]}${detail}${man(id)}`;
  switch (im.problem) {
    case 'no-dimensions':
      return im.format === 'svg'
        ? { severity: 'info', message: `${label} has no numeric width/height or viewBox; its size cannot be checked${man(id)}` }
        : { severity: 'warning', message: `${label} is a ${im.format} file whose size could not be read from its header; check it by hand${man(id)}` };
    case 'not-a-path':
      return icon ? undefined : { message: text };
    case 'outside':
      if (notInsidePath(im.ref)) return icon ? undefined : { severity: 'warning', message: text };
      // A ./ path whose real path leaves the package: a folder on the way is a link.
      return { severity: 'warning', message: `${label} is behind a symbolic link that leads out of the package, so it was not checked${man(id)}` };
    case 'unknown-format':
      return icon && !IMAGE.test(im.ref) ? undefined : { message: text };
    case 'too-large':
      // An icon this large already fails the 5 MiB limit; a screenshot has no documented size limit.
      return icon ? undefined : { severity: 'warning', message: `${label} is over this tool's 64 MiB read cap, so it was not opened and its size was not checked${man(id)}` };
    default:
      return { message: text };
  }
}

export const LST_027 = defineRule(
  {
    id: 'LST-027', title: 'ChatGPT icons: square, 48-4096 px, at most 5 MiB (read from the image files)', severity: { chatgpt: 'error' }, needs: ['openai-manifest'],
    rationale: 'Icons are square, 48 to 4096 px on a side and at most 5 MiB in PNG, JPEG, WebP or SVG. The sizes are read from the file headers (SVG: width and height, else viewBox).',
    fix: 'Replace the icon with a square image between 48 and 4096 px and under 5 MiB, in PNG, JPEG, WebP or SVG, inside the package.',
    sources: [O_SUBMIT, O_ERRORS],
  },
  (snap) => {
    const o = oai(snap);
    const i = openAiInterface(o);
    if (!i) return [];
    const at = ifacePath(o);
    const path = o.manifest.path;
    const out: RawFinding[] = [];
    for (const im of imagesOf(o, (k) => !k.startsWith('screenshots['))) {
      const bad = unmeasured(at, im, 'MAN-019', true);
      if (bad) { out.push({ path, ...bad }); }
      const label = `${at}.${im.key} ${q(displayUrl(im.ref))}`;
      if (im.bytes !== undefined && im.bytes > 5 * MIB) out.push({ path, message: `${label} is ${(im.bytes / MIB).toFixed(1)} MiB, over the 5 MiB limit${man('MAN-019')}` });
      if (im.width === undefined || im.height === undefined) continue;
      if (im.width !== im.height) out.push({ path, message: `${label} is ${im.width}x${im.height} px; icons must be square${man('MAN-019')}` });
      if (Math.min(im.width, im.height) < 48 || Math.max(im.width, im.height) > 4096) out.push({ path, message: `${label} is ${im.width}x${im.height} px; icons must be 48 to 4096 px on a side${man('MAN-019')}` });
    }
    return out;
  },
);

export const LST_028 = defineRule(
  {
    id: 'LST-028', title: 'ChatGPT screenshots: PNG or JPEG, 706 px wide, 400-860 px tall (read from the image files)', severity: { chatgpt: 'error' }, needs: ['openai-manifest'],
    rationale: 'Screenshots are allowed only with a custom UI: one PNG or JPEG per starter prompt, exactly 706 px wide and 400 to 860 px tall. The sizes are read from the file headers.',
    fix: 'Export each screenshot as a PNG or JPEG exactly 706 px wide and between 400 and 860 px tall, one per starter prompt, inside the package.',
    sources: [O_ERRORS, O_SUBMIT],
  },
  (snap) => {
    const o = oai(snap);
    const i = openAiInterface(o);
    if (!i) return [];
    const at = ifacePath(o);
    const path = o.manifest.path;
    const out: RawFinding[] = [];
    const shots = imagesOf(o, (k) => k.startsWith('screenshots['));
    for (const im of shots) {
      const label = `${at}.${im.key} ${q(displayUrl(im.ref))}`;
      const bad = unmeasured(at, im, 'MAN-024', false);
      if (bad) out.push({ path, ...bad });
      if (im.format && im.format !== 'png' && im.format !== 'jpeg') out.push({ path, message: `${label} is a ${im.format} file; screenshots must be PNG or JPEG${man('MAN-024')}` });
      if (im.width === undefined || im.height === undefined) continue;
      if (im.width !== 706) out.push({ path, message: `${label} is ${im.width} px wide; screenshots must be exactly 706 px wide${man('MAN-024')}` });
      if (im.height < 400 || im.height > 860) out.push({ path, message: `${label} is ${im.height} px tall; screenshots must be 400 to 860 px tall${man('MAN-024')}` });
    }
    const prompts = Array.isArray(i.defaultPrompt) ? i.defaultPrompt.length : undefined;
    if (prompts !== undefined && shots.length > prompts) out.push({ path, severity: 'warning', message: `${shots.length} screenshots for ${prompts} starter prompt${prompts === 1 ? '' : 's'}; the checklist asks for one per starter prompt${man('MAN-024')}` });
    return out;
  },
);

export const listingRules = [
  LST_001, LST_002, LST_003, LST_004, LST_005, LST_006, LST_007, LST_008, LST_009, LST_010, LST_011, LST_012, LST_013,
  LST_014, LST_015, LST_016, LST_017, LST_018, LST_019, LST_020, LST_021, LST_022, LST_023, LST_024, LST_025, LST_026, LST_027, LST_028,
];

/** Whether an LST rule that ran could check what its manual items ask: the listing object it reads was there (a
 *  manifest that does not parse, an MCP configuration only or a manifest without an interface object checks nothing). */
export function listingRuleChecked(snap: Snapshot, id: string): boolean {
  const l = snap.listing;
  if (id === 'LST-014') return !!l?.plugin && !!pluginManifest(l.plugin);
  if (!l?.openai) return false;
  if (id === 'LST-023') return isObj(l.openai.manifest.json) && l.openai.format !== 'mcp-config';
  if (id === 'LST-025') return true;
  return !!openAiInterface(l.openai);
}

/** The manual checklist items the LST rules automate, by input: dropped, or cut to their residual manual part, when
 *  every rule in `rules` ran and could check. `parts` is the manual text for a rule that did not (kept with the
 *  residual); an item with a rule that did not run and has no part stays whole. */
export const LISTING_MANUAL: Record<string, { input: 'plugin' | 'openai'; rules: string[]; residual?: string; parts?: Record<string, string> }> = {
  'MAN-002': { input: 'plugin', rules: ['LST-014'], residual: 'Listing: name ≤100, one-liner ≤200, description ≤2000, 1–5 categories, support contact; slug is permanent' },
  'MAN-015': { input: 'openai', rules: ['LST-016', 'LST-017'] },
  'MAN-016': { input: 'openai', rules: ['LST-018'], residual: 'websiteURL, supportURL, privacyPolicyURL, termsOfServiceURL are publicly accessible and identify the same publisher' },
  'MAN-017': { input: 'openai', rules: ['LST-019'] },
  'MAN-018': { input: 'openai', rules: ['LST-020'] },
  'MAN-019': { input: 'openai', rules: ['LST-021', 'LST-027'] },
  'MAN-020': { input: 'openai', rules: ['LST-022', 'LST-025'], parts: { 'LST-025': 'tools_triggered names exist in tools/list (run with the server as the target to check them)' } },
  'MAN-021': { input: 'openai', rules: ['LST-022'], residual: 'Demo recording covers web, iOS and Android' },
  'MAN-023': { input: 'openai', rules: ['LST-023'] },
  'MAN-024': { input: 'openai', rules: ['LST-028'], residual: 'Screenshots are optional and allowed only with custom UI' },
};
