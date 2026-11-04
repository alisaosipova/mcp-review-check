// Review round 3, package P6 (1.0.1): listings. Manual items stay when the LST rules could not check (A06-01, A06-02),
// linked folders are not followed out of the root and a linked input is followed once (A06-03, A06-04), icon and
// read-cap severities (A06-05, A06-10), SVG root detection (A06-06), the --verbose dump (A06-07, A06-08) and a
// declared mcpServers path (A06-09).
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import { imageInfo, svgSize } from '../src/listing/image.js';
import { attachListing, describeListing, listingDump, loadOpenAiManifest, loadPluginDir, type Listing } from '../src/listing/index.js';
import { visibleText } from '../src/report/index.js';
import { runRules } from '../src/rules/engine.js';
import { manualChecklist, RULES } from '../src/rules/index.js';
import { emptySnapshot, type Snapshot } from '../src/snapshot.js';

const FIX = fileURLToPath(new URL('./fixtures/listing/', import.meta.url));
const run = (args: string[]) => runCli(args, {}, false);
const canLink = process.platform !== 'win32';

type F = { ruleId: string; severity: string; message: string };
const findings = (stdout: string): F[] => JSON.parse(stdout).findings;
const listingSnap = (l: Listing, target: Snapshot['options']['target'] = 'chatgpt') =>
  attachListing(emptySnapshot({ kind: 'listing' }, { target, active: false, activeAuth: false }), l);
const manualIds = (snap: Snapshot) => manualChecklist(snap).map((m) => m.id);

const png = (w: number, h: number) => { const b = Buffer.alloc(33); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };

let dir = '';
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mrc-r3p6-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

/** A ChatGPT package in `dir/pkg` with assets and the given interface fields. */
function pkg(files: Record<string, Buffer | string>, iface: Record<string, unknown>, extra: Record<string, unknown> = {}): string {
  const root = join(dir, 'pkg');
  mkdirSync(join(root, 'assets'), { recursive: true });
  for (const [name, buf] of Object.entries(files)) writeFileSync(join(root, 'assets', name), buf);
  const manifest = join(root, 'plugin.json');
  writeFileSync(manifest, JSON.stringify({ name: 'acme', version: '1.0.0', ...extra, extensions: { 'com.openai': { interface: { displayName: 'Acme', ...iface } } } }));
  return manifest;
}

describe('A06-01 manual items stay when the LST rules could not check', () => {
  it('an MCP configuration only keeps MAN-015..024 whole', () => {
    const snap = listingSnap(loadOpenAiManifest(join(FIX, 'openai-mcp-only', 'mcp.json')));
    const ids = manualIds(snap);
    for (const id of ['MAN-015', 'MAN-016', 'MAN-017', 'MAN-018', 'MAN-019', 'MAN-020', 'MAN-021', 'MAN-023']) expect(ids, id).toContain(id);
    expect(manualChecklist(snap).find((m) => m.id === 'MAN-016')!.text).not.toMatch(/checked by/);
  });

  it('a manifest that does not parse, or has no interface, keeps them too; the valid package still drops them', () => {
    writeFileSync(join(dir, 'bad.json'), '{ nope');
    expect(manualIds(listingSnap(loadOpenAiManifest(join(dir, 'bad.json'))))).toContain('MAN-015');
    writeFileSync(join(dir, 'plain.json'), JSON.stringify({ name: 'x' }));
    expect(manualIds(listingSnap(loadOpenAiManifest(join(dir, 'plain.json'))))).toEqual(expect.arrayContaining(['MAN-015', 'MAN-017', 'MAN-018', 'MAN-019']));
    const ok = manualIds(listingSnap(loadOpenAiManifest(join(FIX, 'openai-valid', 'plugin.json'))));
    for (const id of ['MAN-015', 'MAN-017', 'MAN-018', 'MAN-019', 'MAN-023']) expect(ok, id).not.toContain(id);
  });

  it('a plugin folder whose plugin.json does not parse keeps MAN-002 whole', () => {
    mkdirSync(join(dir, '.claude-plugin'));
    writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), '{ nope');
    const m = manualChecklist(listingSnap(loadPluginDir(dir), 'claude')).find((x) => x.id === 'MAN-002')!;
    expect(m.text).not.toMatch(/checked by/);
    const valid = manualChecklist(listingSnap(loadPluginDir(join(FIX, 'plugin-valid')), 'claude')).find((x) => x.id === 'MAN-002')!;
    expect(valid.text).toMatch(/checked by LST-014/);
  });

  it('the CLI checklist for an MCP configuration lists MAN-015', async () => {
    const r = await run(['--openai-manifest', join(FIX, 'openai-mcp-only', 'mcp.json'), '--target', 'chatgpt', '--format', 'json']);
    expect(JSON.parse(r.stdout).manual.map((m: { id: string }) => m.id)).toContain('MAN-015');
  });
});

describe('A06-02 MAN-020 keeps the tools_triggered part when LST-025 is skipped', () => {
  it('a listing-only run keeps MAN-020 with the part LST-025 could not check', async () => {
    const r = await run(['--openai-manifest', join(FIX, 'openai-valid', 'plugin.json'), '--target', 'chatgpt', '--format', 'json']);
    const doc = JSON.parse(r.stdout);
    expect(doc.skipped.some((s: { ruleId: string }) => s.ruleId === 'LST-025')).toBe(true);
    const m = doc.manual.find((x: { id: string }) => x.id === 'MAN-020');
    expect(m.text).toMatch(/tools_triggered names exist in tools\/list/);
    expect(m.text).toMatch(/checked by LST-022\)/);
  });
});

describe('A06-03 files behind a linked folder are not read', () => {
  it.runIf(canLink)('a .claude-plugin link out of the plugin folder is refused, not parsed', async () => {
    const outside = join(dir, 'outside', 'secretdir');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'plugin.json'), JSON.stringify({ name: 'leaked-outside-name', mcpServers: { s: { type: 'http', url: 'http://inner.corp.example/mcp' } } }));
    const pl = join(dir, 'pl');
    mkdirSync(pl);
    symlinkSync(join('..', 'outside', 'secretdir'), join(pl, '.claude-plugin'));
    const l = loadPluginDir(pl);
    expect(l.plugin!.manifest).toMatchObject({ error: expect.stringMatching(/behind a symbolic link/), level: 'warning' });
    const r = await run(['--plugin-dir', pl, '--target', 'claude', '--verbose', '--format', 'json']);
    expect(r.stdout + r.stderr).not.toContain('leaked-outside-name');
    expect(r.stdout + r.stderr).not.toContain('inner.corp.example');
    const lst001 = findings(r.stdout).find((f) => f.ruleId === 'LST-001')!;
    expect(lst001).toMatchObject({ severity: 'warning' });
    expect(lst001.message).toMatch(/not checked/);
  });

  it.runIf(canLink)('a declared mcpServers path through a linked folder is refused', async () => {
    mkdirSync(join(dir, 'outside'));
    writeFileSync(join(dir, 'outside', 'mcp.json'), JSON.stringify({ mcpServers: { s: { url: 'https://inner.corp.example/mcp' } } }));
    const m = pkg({ 'i.png': png(64, 64) }, { logo: './assets/i.png', composerIcon: './assets/i.png' }, { mcpServers: './cfg/mcp.json' });
    symlinkSync(join('..', 'outside'), join(dir, 'pkg', 'cfg'));
    const r = await run(['--openai-manifest', m, '--target', 'chatgpt', '--format', 'json']);
    expect(r.stdout).not.toContain('inner.corp.example');
    expect(findings(r.stdout).find((f) => f.ruleId === 'LST-024')).toMatchObject({ severity: 'warning', message: expect.stringMatching(/behind a symbolic link/) });
  });
});

describe('A06-04 an input path that is itself a link is followed once', () => {
  it.runIf(canLink)('--plugin-dir through a link checks the folder', async () => {
    mkdirSync(join(dir, 'lnk'));
    symlinkSync(join(FIX, 'plugin-valid'), join(dir, 'lnk', 'plugdir'));
    const r = await run(['--plugin-dir', join(dir, 'lnk', 'plugdir'), '--target', 'claude', '--format', 'json']);
    expect(r.stderr).not.toMatch(/is not a directory/);
    expect(findings(r.stdout).filter((f) => f.severity === 'error')).toEqual([]);
    expect(r.code).toBe(0);
  });

  it.runIf(canLink)('--openai-manifest through a link reads the linked file in the folder it was named in', async () => {
    // The root is the folder the user named (review of A06-04), so the package's assets sit next to the link.
    cpSync(join(FIX, 'openai-valid', 'assets'), join(dir, 'assets'), { recursive: true });
    cpSync(join(FIX, 'openai-valid', 'mcp.json'), join(dir, 'mcp.json'));
    symlinkSync(join(FIX, 'openai-valid', 'plugin.json'), join(dir, 'plugin.json'));
    const r = await run(['--openai-manifest', join(dir, 'plugin.json'), '--target', 'chatgpt', '--format', 'json']);
    expect(findings(r.stdout).filter((f) => f.ruleId === 'LST-016')).toEqual([]);
    expect(r.code).toBe(0);
  });
});

describe('A06-04 review: a linked manifest folder keeps the package root the user named', () => {
  /** A Codex package `dir/<name>/pkg` from openai-valid, with its `.codex-plugin` folder at `manifestDir` (relative to `dir/<name>`). */
  function codexPkg(name: string, manifestDir: string): string {
    const raw = JSON.parse(readFileSync(join(FIX, 'openai-valid', 'plugin.json'), 'utf8'));
    const manifest = { ...raw, interface: raw.extensions['com.openai'].interface, mcpServers: './.mcp.json' };
    const base = join(dir, name);
    const root = join(base, 'pkg');
    mkdirSync(join(base, manifestDir), { recursive: true });
    writeFileSync(join(base, manifestDir, 'plugin.json'), JSON.stringify(manifest));
    cpSync(join(FIX, 'openai-valid', 'assets'), join(root, 'assets'), { recursive: true });
    cpSync(join(FIX, 'openai-valid', 'mcp.json'), join(root, '.mcp.json'));
    return root;
  }
  const blockers = (f: F[]) => f.filter((x) => x.severity === 'error' || ['LST-024', 'LST-027'].includes(x.ruleId));

  it.runIf(canLink)('.codex-plugin -> meta (inside the package) finds the icons and .mcp.json as 1.0.0 did', async () => {
    const root = codexPkg('in', 'pkg/meta');
    symlinkSync('meta', join(root, '.codex-plugin'));
    const r = await run(['--openai-manifest', join(root, '.codex-plugin', 'plugin.json'), '--target', 'chatgpt', '--format', 'json']);
    expect(blockers(findings(r.stdout))).toEqual([]);
    expect(r.code).toBe(0);
    expect(loadOpenAiManifest(join(root, '.codex-plugin', 'plugin.json')).openai!.mcp).toMatchObject({ path: '.mcp.json', json: expect.anything() });
  });

  it.runIf(canLink)('.codex-plugin -> ../shared/manifest (outside) reads the named manifest; the root stays the package', async () => {
    const root = codexPkg('out', 'shared/manifest');
    symlinkSync(join('..', 'shared', 'manifest'), join(root, '.codex-plugin'));
    const r = await run(['--openai-manifest', join(root, '.codex-plugin', 'plugin.json'), '--target', 'chatgpt', '--format', 'json']);
    expect(blockers(findings(r.stdout))).toEqual([]);
    expect(r.code).toBe(0);
  });

  it.runIf(canLink)('a linked plugin.json keeps the folder it was named in as the root', () => {
    const root = codexPkg('file', 'elsewhere');
    mkdirSync(join(root, '.codex-plugin'));
    symlinkSync(join('..', '..', 'elsewhere', 'plugin.json'), join(root, '.codex-plugin', 'plugin.json'));
    const l = loadOpenAiManifest(join(root, '.codex-plugin', 'plugin.json'));
    expect(l.openai!.manifest.json).toBeDefined();
    expect(l.openai!.files.map((f) => f.path)).toContain('assets');
    expect(l.openai!.images!.every((im) => !im.problem)).toBe(true);
  });

  it.runIf(canLink)('an icon through a linked folder out of the package is still refused (A06-03 guard)', () => {
    const root = codexPkg('guard', 'pkg/.codex-plugin');
    mkdirSync(join(dir, 'guard', 'elsewhere'));
    cpSync(join(root, 'assets'), join(dir, 'guard', 'elsewhere', 'assets'), { recursive: true });
    rmSync(join(root, 'assets'), { recursive: true });
    symlinkSync(join('..', 'elsewhere', 'assets'), join(root, 'assets'));
    const l = loadOpenAiManifest(join(root, '.codex-plugin', 'plugin.json'));
    expect(l.openai!.images!.map((im) => im.problem)).toEqual(l.openai!.images!.map(() => 'outside'));
  });
});

describe('A06-05 one finding at the LST-021 level for an icon ref', () => {
  it('a URL logo is one LST-021 warning; a .gif icon is one LST-021 error', async () => {
    const gif = Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1');
    const m = pkg({ 'gif.gif': gif }, { logo: 'https://cdn.example.com/logo.png', composerIcon: './assets/gif.gif' });
    const f = findings((await run(['--openai-manifest', m, '--target', 'chatgpt', '--format', 'json'])).stdout);
    const logo = f.filter((x) => /\.logo /.test(x.message));
    expect(logo.map((x) => [x.ruleId, x.severity])).toEqual([['LST-021', 'warning']]);
    const icon = f.filter((x) => /composerIcon /.test(x.message));
    expect(icon.map((x) => [x.ruleId, x.severity])).toEqual([['LST-021', 'error']]);
  });

  it('a screenshot URL is a warning in LST-028, as in LST-021', async () => {
    const m = pkg({ 'i.png': png(64, 64) }, { logo: './assets/i.png', composerIcon: './assets/i.png', defaultPrompt: ['a'], screenshots: ['https://cdn.example.com/s.png'] });
    const f = findings((await run(['--openai-manifest', m, '--target', 'chatgpt', '--format', 'json'])).stdout).filter((x) => x.ruleId === 'LST-028');
    expect(f.map((x) => x.severity)).toEqual(['warning']);
  });
});

describe('A06-05 review: LST-027 names the real cause of an outside ref', () => {
  it('.//etc/logo.png and ./..\\x.png are "not a ./ path inside the package" warnings, not "behind a symbolic link"', async () => {
    const m = pkg({ 'i.png': png(64, 64) }, { logo: './/etc/logo.png', composerIcon: './..\\x.png', defaultPrompt: ['a'], screenshots: ['.//etc/s.png'] });
    const f = findings((await run(['--openai-manifest', m, '--target', 'chatgpt', '--format', 'json'])).stdout);
    expect(f.filter((x) => /symbolic link/.test(x.message))).toEqual([]);
    for (const key of ['.logo ', 'composerIcon ', 'screenshots[0] ']) {
      const own = f.filter((x) => x.message.includes(key) && /not a \.\/ path inside the package/.test(x.message));
      expect(own.map((x) => x.severity), key).toEqual(['warning']);
    }
  });
});

describe('A06-10 this tool\'s read caps are warnings (not checked), not vendor errors', () => {
  it('a 70 MiB icon has only the 5 MiB error; a 70 MiB screenshot is a warning', async () => {
    const m = pkg({ 'huge.png': png(64, 64), 'shot.png': png(706, 500) }, { logo: './assets/huge.png', composerIcon: './assets/huge.png', defaultPrompt: ['a'], screenshots: ['./assets/shot.png'] });
    truncateSync(join(dir, 'pkg', 'assets', 'huge.png'), 70 * 1024 * 1024);
    truncateSync(join(dir, 'pkg', 'assets', 'shot.png'), 70 * 1024 * 1024);
    const f = findings((await run(['--openai-manifest', m, '--target', 'chatgpt', '--format', 'json'])).stdout).filter((x) => /LST-02[78]/.test(x.ruleId));
    expect(f.filter((x) => x.ruleId === 'LST-027').map((x) => x.message).every((t) => /over the 5 MiB limit/.test(t))).toBe(true);
    expect(f.filter((x) => x.ruleId === 'LST-027')).toHaveLength(2);
    expect(f.filter((x) => x.ruleId === 'LST-028').map((x) => x.severity)).toEqual(['warning']);
  });

  it('a manifest over the 1 MiB read cap is a warning that says it was not checked', async () => {
    mkdirSync(join(dir, '.claude-plugin'));
    writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'big', pad: 'x'.repeat(1024 * 1024) }));
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: {}, pad: 'x'.repeat(1024 * 1024) }));
    const f = findings((await run(['--plugin-dir', dir, '--target', 'claude', '--format', 'json'])).stdout);
    for (const id of ['LST-001', 'LST-006']) {
      const x = f.find((y) => y.ruleId === id)!;
      expect(x, id).toMatchObject({ severity: 'warning' });
      expect(x.message).toMatch(/read cap; not parsed, so not checked/);
    }
    writeFileSync(join(dir, 'm.json'), JSON.stringify({ name: 'big', pad: 'x'.repeat(1024 * 1024) }));
    const g = findings((await run(['--openai-manifest', join(dir, 'm.json'), '--target', 'chatgpt', '--format', 'json'])).stdout);
    expect(g.find((y) => y.ruleId === 'LST-016')).toMatchObject({ severity: 'warning' });
  });
});

describe('A06-06 SVG root element', () => {
  it('a licence comment over 4 KiB before <svg> is still an SVG with its size', () => {
    const text = `<?xml version="1.0"?>\n<!-- ${'licence text '.repeat(450)} -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd" [ <!ENTITY e "a>b"> ]>\n<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"></svg>`;
    expect(text.indexOf('<svg') > 4096).toBe(true);
    expect(imageInfo(Buffer.from(text))).toEqual({ format: 'svg', size: { width: 512, height: 512 } });
  });

  it('an <svg> tag inside a comment does not set the size', () => {
    const text = '<!-- old: <svg width="4" height="4"> --><svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"/>';
    expect(svgSize(text)).toEqual({ width: 512, height: 512 });
    expect(imageInfo(Buffer.from(text)).size).toEqual({ width: 512, height: 512 });
  });

  it('a long-licence SVG icon passes LST-027', async () => {
    const text = `<?xml version="1.0"?>\n<!-- ${'licence text '.repeat(450)} -->\n<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"></svg>`;
    const m = pkg({ 'lic.svg': text }, { logo: './assets/lic.svg', composerIcon: './assets/lic.svg' });
    const f = findings((await run(['--openai-manifest', m, '--target', 'chatgpt', '--format', 'json'])).stdout).filter((x) => x.ruleId === 'LST-027');
    expect(f).toEqual([]);
  });
});

describe('A06-07 the --verbose dump hides credential-named keys and flag values', () => {
  it('privateKey, x-auth, --api-key <v> and --auth=<v> are redacted', async () => {
    const v1 = ['val', 'SYNTH', 'q8vLmN3pRt5WxY2'].join('_');
    const v2 = ['val', 'SYNTH', 'q8vLmN3pRt5WxY2b'].join('_');
    const v3 = ['priv', 'SYNTH', '123456'].join('_');
    const v4 = ['xauth', 'SYNTH', '98765'].join('_');
    const v5 = ['hdr', 'SYNTH', '4242'].join('_');
    mkdirSync(join(dir, 'red'));
    writeFileSync(join(dir, 'red', '.mcp.json'), JSON.stringify({ mcpServers: { s: { command: 'node', args: ['srv.js', '--api-key', v1, `--auth=${v2}`, '--header', `Authorization: Bearer ${v5}`, '--port', '8080'], privateKey: v3, 'x-auth': v4 } } }));
    const r = await run(['--plugin-dir', join(dir, 'red'), '--verbose', '--format', 'json']);
    expect(r.stderr).toMatch(/\[listing\]/);
    for (const v of [v1, v2, v3, v4, v5]) expect(r.stderr, v).not.toContain(v);
    const d = JSON.stringify(describeListing(loadPluginDir(join(dir, 'red'))));
    expect(d).toContain('"--auth=[redacted]"');
    expect(d).toContain('"--api-key","[redacted]"');
    expect(d).toContain('"--port","8080"');
    expect(d).toContain('"srv.js"');
  });
});

describe('A06-07 review: the dump redacts --flag=value forms as the stdio argv redactor does', () => {
  it('--header=Name: value, --header=Name:value and a known token after --flag= are redacted', async () => {
    const h1 = ['HdrEq1', 'SYNTH', 'AAAAAAA'].join('_');
    const h2 = ['HdrEq2', 'SYNTH', 'BBBBBBB'].join('_');
    const gh = ['ghp_', 'SYNTH', 'abcdefghijklmnopqrstuvwxyz0123'].join('');
    mkdirSync(join(dir, 'red'));
    writeFileSync(join(dir, 'red', '.mcp.json'), JSON.stringify({ mcpServers: { s: { command: 'npx', args: ['-y', 'mcp-remote@1.2.3', 'https://h.example/mcp', `--header=Authorization: Bearer ${h1}`, `--header=X-Api-Key:${h2}`, `--keys=${gh}`, '--mode=fast'] } } }));
    const r = await run(['--plugin-dir', join(dir, 'red'), '--verbose', '--format', 'json']);
    expect(r.stderr).toMatch(/\[listing\]/);
    for (const v of [h1, h2, gh]) expect(r.stderr, v).not.toContain(v);
    const d = JSON.stringify(describeListing(loadPluginDir(join(dir, 'red'))));
    for (const v of [h1, h2, gh]) expect(d, v).not.toContain(v);
    expect(d).toContain('"--header=Authorization: [redacted]"');
    expect(d).toContain('"--header=X-Api-Key: [redacted]"');
    expect(d).toContain('"--mode=fast"');
    expect(d).toContain('"mcp-remote@1.2.3"');
  });
});

describe('A06-08 the [listing] dump keeps its newlines', () => {
  it('listingDump is indented JSON over several lines, escaped per line', () => {
    const l = loadPluginDir(join(FIX, 'plugin-valid'));
    const out = listingDump(l, (s) => s.replace(/\n/g, '\\u{A}'));
    expect(out.split('\n').length).toBeGreaterThan(3);
    expect(out).not.toContain('\\u{A}');
    expect(JSON.parse(out)).toEqual(describeListing(l));
  });
});

describe('A06-08 review: the call the integrator puts in cli.ts', () => {
  it('listingDump(snap.listing, visibleText) type-checks, keeps newlines and still escapes a bidi character', () => {
    mkdirSync(join(dir, 'bidi', '.claude-plugin'), { recursive: true });
    writeFileSync(join(dir, 'bidi', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'acme', description: 'a\u202Eb' }));
    const snap = attachListing(emptySnapshot({ kind: 'listing' }, { target: 'claude', active: false, activeAuth: false }), loadPluginDir(join(dir, 'bidi')));
    const out = snap.listing ? listingDump(snap.listing, visibleText) : '';
    expect(out.split('\n').length).toBeGreaterThan(3);
    expect(out).not.toContain('\\u{A}');
    expect(out).not.toContain('\u202E');
    expect(out).toContain('\\u{202E}');
  });
});

describe('A06-09 a declared mcpServers path is used alone', () => {
  it('a missing declared file is reported, not replaced by the root mcp.json', async () => {
    const m = pkg({ 'i.png': png(64, 64) }, { logo: './assets/i.png', composerIcon: './assets/i.png' }, { mcpServers: './config/missing.json' });
    writeFileSync(join(dir, 'pkg', 'mcp.json'), JSON.stringify({ mcpServers: { s: { url: 'https://fallback.example/mcp' } } }));
    const l = loadOpenAiManifest(m);
    expect(l.openai!.mcp).toMatchObject({ path: 'config/missing.json', error: expect.stringMatching(/does not exist/), level: 'warning' });
    const f = findings((await run(['--openai-manifest', m, '--target', 'chatgpt', '--format', 'json'])).stdout);
    expect(f.find((x) => x.ruleId === 'LST-024')).toMatchObject({ severity: 'warning', message: expect.stringMatching(/config\/missing\.json does not exist/) });
  });

  it('a declared path out of the package is not read and not replaced', () => {
    const m = pkg({}, {}, { mcpServers: '../elsewhere/mcp.json' });
    writeFileSync(join(dir, 'pkg', 'mcp.json'), JSON.stringify({ mcpServers: { s: { url: 'https://fallback.example/mcp' } } }));
    const l = loadOpenAiManifest(m);
    expect(l.openai!.mcp).toMatchObject({ error: expect.stringMatching(/not a \.\/ path inside the package/), level: 'warning' });
    expect(JSON.stringify(l)).not.toContain('fallback.example');
  });

  it('a declared file that exists is read', () => {
    const m = pkg({}, {}, { mcpServers: './config/mcp.json' });
    mkdirSync(join(dir, 'pkg', 'config'));
    writeFileSync(join(dir, 'pkg', 'config', 'mcp.json'), JSON.stringify({ mcpServers: { s: { url: 'https://declared.example/mcp' } } }));
    const l = loadOpenAiManifest(m);
    expect(l.openai!.mcp).toMatchObject({ path: 'config/mcp.json' });
    expect(runRules(listingSnap(l), RULES).findings.filter((x) => x.ruleId === 'LST-024')).toEqual([]);
  });
});
