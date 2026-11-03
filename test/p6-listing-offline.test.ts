// P6-listing-offline (0.6.0): listing-only runs (no server), image header reading for MAN-019 / MAN-024
// (LST-027, LST-028) and the --verbose listing dump.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import { examineImage, imageInfo, svgSize } from '../src/listing/image.js';
import { loadOpenAiManifest } from '../src/listing/index.js';
import { LISTING_ONLY_REASON, runRules } from '../src/rules/engine.js';
import { RULES } from '../src/rules/index.js';
import { emptySnapshot } from '../src/snapshot.js';

const FIX = fileURLToPath(new URL('./fixtures/listing/', import.meta.url));
const run = (args: string[]) => runCli(args, {}, false);

// ---- synthetic image headers (no pixel data: the readers look at headers only)
const png = (w: number, h: number) => { const b = Buffer.alloc(33); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
const jpeg = (w: number, h: number) => {
  const app = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14)]);
  const sof = Buffer.alloc(19); sof.writeUInt16BE(0xffc0, 0); sof.writeUInt16BE(17, 2); sof[4] = 8; sof.writeUInt16BE(h, 5); sof.writeUInt16BE(w, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app, sof]);
};
const riff = (kind: string, fill: (b: Buffer) => void) => { const b = Buffer.alloc(40); b.write('RIFF', 0, 'latin1'); b.writeUInt32LE(32, 4); b.write('WEBP', 8, 'latin1'); b.write(kind, 12, 'latin1'); fill(b); return b; };
const webpX = (w: number, h: number) => riff('VP8X', (b) => { b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3); });
const webpL = (w: number, h: number) => riff('VP8L', (b) => { b[20] = 0x2f; b.writeUInt32LE(((w - 1) | ((h - 1) << 14)) >>> 0, 21); });
const webpLossy = (w: number, h: number) => riff('VP8 ', (b) => { b[23] = 0x9d; b[24] = 0x01; b[25] = 0x2a; b.writeUInt16LE(w, 26); b.writeUInt16LE(h, 28); });
const svg = (attrs: string) => Buffer.from(`<?xml version="1.0"?>\n<!-- c -->\n<svg xmlns="http://www.w3.org/2000/svg" ${attrs}><rect/></svg>`);

describe('image headers', () => {
  it('reads PNG, JPEG and the three WebP forms', () => {
    expect(imageInfo(png(256, 128))).toEqual({ format: 'png', size: { width: 256, height: 128 } });
    expect(imageInfo(jpeg(706, 500))).toEqual({ format: 'jpeg', size: { width: 706, height: 500 } });
    expect(imageInfo(webpX(300, 200)).size).toEqual({ width: 300, height: 200 });
    expect(imageInfo(webpL(64, 48)).size).toEqual({ width: 64, height: 48 });
    expect(imageInfo(webpLossy(512, 512))).toEqual({ format: 'webp', size: { width: 512, height: 512 } });
  });

  it('reads SVG width/height in px or unitless, else the viewBox; other units give no size', () => {
    expect(imageInfo(svg('width="64" height="64px"')).size).toEqual({ width: 64, height: 64 });
    expect(imageInfo(svg('viewBox="0 0 24 24"')).size).toEqual({ width: 24, height: 24 });
    expect(imageInfo(svg('width="100%" height="100%" viewBox="0, 0, 48 96"')).size).toEqual({ width: 48, height: 96 });
    expect(svgSize('<svg width="2em" height="2em">')).toBeUndefined();
    expect(imageInfo(svg('')).format).toBe('svg');
  });

  it('a truncated or foreign header gives a format without a size, or nothing', () => {
    expect(imageInfo(png(10, 10).subarray(0, 14))).toEqual({ format: 'png' });
    expect(imageInfo(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toEqual({ format: 'jpeg' });
    expect(imageInfo(Buffer.from('GIF89a......'))).toEqual({});
    expect(imageInfo(png(0, 5)).size).toBeUndefined();
  });
});

let dir = '';
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mrc-p6-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('examineImage', () => {
  it('reports each unreadable case deterministically, without a path', () => {
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'assets', 'ok.png'), png(64, 64));
    writeFileSync(join(dir, 'assets', 'text.png'), 'not an image');
    writeFileSync(join(dir, 'assets', 'trunc.png'), png(1, 1).subarray(0, 12));
    mkdirSync(join(dir, 'assets', 'adir'));
    try { symlinkSync(join(dir, 'assets', 'ok.png'), join(dir, 'assets', 'link.png')); } catch { /* no symlinks here */ }
    const p = (ref: unknown) => examineImage(dir, 'openai', 'logo', ref);
    expect(p('./assets/ok.png')).toMatchObject({ format: 'png', width: 64, height: 64, bytes: 33 });
    expect(p('./assets/none.png').problem).toBe('missing');
    expect(p('./assets/text.png').problem).toBe('unknown-format');
    expect(p('./assets/trunc.png').problem).toBe('no-dimensions');
    expect(p('./assets/adir').problem).toBe('not-file');
    expect(p('../x.png').problem).toBe('outside');
    expect(p('/etc/passwd').problem).toBe('outside');
    expect(p('https://x.test/a.png').problem).toBe('outside');
    expect(p(7).problem).toBe('not-a-path');
    if (process.platform !== 'win32') expect(p('./assets/link.png').problem).toBe('link');
    expect(JSON.stringify(p('./assets/none.png'))).not.toContain(dir);
  });
});

/** A ChatGPT package in `dir` with the given icon and screenshot files. */
function pkg(files: Record<string, Buffer>, iface: Record<string, unknown>): string {
  mkdirSync(join(dir, 'assets'), { recursive: true });
  for (const [name, buf] of Object.entries(files)) writeFileSync(join(dir, 'assets', name), buf);
  const manifest = join(dir, 'plugin.json');
  writeFileSync(manifest, JSON.stringify({ name: 'acme', version: '1.0.0', extensions: { 'com.openai': { interface: { displayName: 'Acme', ...iface } } } }));
  return manifest;
}
const ids = (stdout: string) => (JSON.parse(stdout).findings as Array<{ ruleId: string; message: string }>).filter((f) => f.ruleId.startsWith('LST-02'));

describe('LST-027 / LST-028 over real files', () => {
  it('flags non-square, small, huge-file and wrong-format icons; passes a good one', async () => {
    const big = Buffer.concat([png(256, 256), Buffer.alloc(5 * 1024 * 1024 + 1)]);
    const m = pkg({ 'good.png': png(512, 512), 'wide.png': png(256, 128), 'tiny.webp': webpX(32, 32), 'big.png': big, 'huge.jpg': jpeg(5000, 5000), 'fake.png': Buffer.from('nope') },
      { logo: './assets/wide.png', logoDark: './assets/tiny.webp', composerIcon: './assets/good.png', composerIconDark: './assets/big.png' });
    const r = await run(['--openai-manifest', m, '--format', 'json']);
    const msgs = ids(r.stdout).map((f) => f.message).join('\n');
    expect(msgs).toMatch(/logo .*256x128.*square/);
    expect(msgs).toMatch(/logoDark .*32x32.*48 to 4096/);
    expect(msgs).toMatch(/composerIconDark .*over the 5 MiB/);
    expect(msgs).not.toMatch(/composerIcon "/);
    const m2 = pkg({ 'huge.jpg': jpeg(5000, 5000), 'fake.png': Buffer.from('nope') }, { logo: './assets/huge.jpg', composerIcon: './assets/fake.png' });
    const m2msgs = ids((await run(['--openai-manifest', m2, '--format', 'json'])).stdout).map((f) => f.message).join('\n');
    expect(m2msgs).toMatch(/5000x5000.*48 to 4096/);
    expect(m2msgs).toMatch(/composerIcon .*no PNG, JPEG, WebP or SVG|composerIcon .*file signature/);
  });

  it('screenshots must be 706 wide, 400-860 tall, PNG or JPEG; an SVG icon with a viewBox is measured', async () => {
    const m = pkg({ 's1.png': png(706, 500), 's2.png': png(700, 500), 's3.jpg': jpeg(706, 900), 's4.webp': webpX(706, 500), 'i.svg': svg('viewBox="0 0 64 32"') },
      { logo: './assets/i.svg', defaultPrompt: ['a'], screenshots: ['./assets/s1.png', './assets/s2.png', './assets/s3.jpg', './assets/s4.webp'] });
    const msgs = ids((await run(['--openai-manifest', m, '--format', 'json'])).stdout);
    const text = msgs.map((f) => `${f.ruleId} ${f.message}`).join('\n');
    expect(text).toMatch(/LST-027 .*logo .*64x32.*square/);
    expect(text).toMatch(/LST-028 .*screenshots\[1\].*700 px wide/);
    expect(text).toMatch(/LST-028 .*screenshots\[2\].*900 px tall/);
    expect(text).toMatch(/LST-028 .*screenshots\[3\].*webp file; screenshots must be PNG or JPEG/);
    expect(text).toMatch(/LST-028 .*4 screenshots for 1 starter prompt/);
    expect(text).not.toMatch(/screenshots\[0\]/);
  });

  it('review fixes: one root cause per screenshot (LST-028 only) and URL userinfo is not echoed', async () => {
    const cred = 'https://u:' + ['pw', 'SYNTH'].join('') + '@x.test/a.png';
    const m = pkg({}, { logo: './assets/i.svg', defaultPrompt: ['a'], screenshots: ['./assets/../plugin.json', 5, cred] });
    const out = (await run(['--openai-manifest', m, '--format', 'json', '--target', 'chatgpt'])).stdout;
    const f = ids(out);
    expect(f.filter((x) => x.ruleId === 'LST-021' && /screenshots\[/.test(x.message))).toEqual([]);
    expect(f.some((x) => x.ruleId === 'LST-028' && /screenshots\[2\]/.test(x.message))).toBe(true);
    expect(out).not.toContain('pwSYNTH');
  });

  it('the valid fixture (real PNG files) has no LST finding', () => {
    const l = loadOpenAiManifest(join(FIX, 'openai-valid', 'plugin.json'));
    expect(l.openai!.images!.map((i) => [i.key, i.width, i.height, i.problem])).toEqual([['logo', 64, 64, undefined], ['composerIcon', 64, 64, undefined]]);
  });
});

describe('listing-only runs', () => {
  it('rules that need a server are skipped with the reason, not passed', () => {
    const snap = emptySnapshot({ kind: 'listing' }, { target: 'all', active: false, activeAuth: false });
    const r = runRules(snap, RULES);
    expect(r.rulesRun).toBe(0); // no listing input either
    expect(r.skipped.find((s) => s.ruleId === 'SRV-001')?.reason).toBe(LISTING_ONLY_REASON);
    expect(r.skipped.find((s) => s.ruleId === 'TOOL-001')?.reason).toBe(LISTING_ONLY_REASON);
    expect(r.skipped.find((s) => s.ruleId === 'LST-001')?.reason).toBe('needs --plugin-dir');
  });

  it('--plugin-dir alone: LST findings, server rules skipped, exit 1 on errors, all formats say listing-only', async () => {
    const args = ['--plugin-dir', join(FIX, 'plugin-invalid')];
    const j = await run([...args, '--format', 'json']);
    expect(j.code).toBe(1);
    const doc = JSON.parse(j.stdout);
    expect(doc.server).toMatchObject({ listingOnly: true, transport: 'streamable-http' });
    expect(doc.server.url).toBeUndefined();
    expect(doc.summary.score).toBeNull();
    expect(doc.findings.some((f: { ruleId: string }) => f.ruleId === 'LST-005')).toBe(true);
    expect(doc.findings.every((f: { ruleId: string }) => f.ruleId.startsWith('LST-'))).toBe(true);
    expect(doc.skipped.find((s: { ruleId: string }) => s.ruleId === 'LST-015').reason).toBe(LISTING_ONLY_REASON);
    expect(doc.skipped.find((s: { ruleId: string }) => s.ruleId === 'SRV-001').reason).toBe(LISTING_ONLY_REASON);
    for (const fmt of ['text', 'markdown', 'sarif', 'junit']) {
      const r = await run([...args, '--format', fmt]);
      expect(r.code, fmt).toBe(1);
      expect(r.stdout, fmt).toMatch(/listing-only/);
    }
  });

  it('--fail-on decides the exit code; a valid package passes', async () => {
    const valid = join(FIX, 'openai-valid', 'plugin.json');
    expect((await run(['--openai-manifest', valid, '--target', 'chatgpt'])).code).toBe(0);
    expect((await run(['--plugin-dir', join(FIX, 'plugin-invalid'), '--fail-on', 'never'])).code).toBe(0);
    const w = await run(['--plugin-dir', join(FIX, 'plugin-invalid'), '--fail-on', 'warning', '--target', 'claude']);
    expect(w.code).toBe(1);
  });

  it('both inputs together; server-only options are usage errors', async () => {
    const r = await run(['--plugin-dir', join(FIX, 'plugin-valid'), '--openai-manifest', join(FIX, 'openai-valid', 'plugin.json'), '--format', 'json']);
    expect(r.code).toBe(0);
    for (const bad of [['--bearer', 'x'], ['--header', 'A: b'], ['--env', 'A=b'], ['--active']]) {
      const e = await run(['--plugin-dir', join(FIX, 'plugin-valid'), ...bad]);
      expect(e.code, bad[0]).toBe(2);
      expect(e.stderr).toMatch(/needs a <url> or --stdio target/);
    }
  });

  it('a config file with pluginDir / openaiManifest and no url or stdio is a listing-only run', async () => {
    writeFileSync(join(dir, 'c.json'), JSON.stringify({ pluginDir: join(FIX, 'plugin-invalid'), failOn: 'error' }));
    const r = await run(['--config', join(dir, 'c.json'), '--format', 'json']);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout).server.listingOnly).toBe(true);
  });

  it('the markdown manual checklist keeps working and no server counts are shown', async () => {
    const r = await run(['--openai-manifest', join(FIX, 'openai-valid', 'plugin.json'), '--format', 'markdown']);
    expect(r.stdout).toMatch(/listing-only: no server/);
    expect(r.stdout).not.toMatch(/0 tools/);
  });
});

describe('--verbose listing dump', () => {
  it('prints the parsed listing to stderr with header, env and credential values removed', async () => {
    const token = ['sk', 'live', 'SYNTH0123456789abcdef'].join('_');
    mkdirSync(join(dir, '.claude-plugin'));
    writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'acme-notes', version: '1.0.0', description: 'd', author: { name: 'A' }, license: 'MIT' }));
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { s: { type: 'http', url: `https://user:${token}@mcp.acme.test/mcp?api_key=${token}`, headers: { Authorization: `Bearer ${token}` }, env: { K: token } } } }));
    const r = await run(['--plugin-dir', dir, '--verbose', '--format', 'json']);
    expect(r.stderr).toMatch(/\[listing\]/);
    expect(r.stderr).toMatch(/"name": "acme-notes"/);
    expect(r.stderr).toMatch(/\[redacted\]/);
    for (const out of [r.stderr, r.stdout]) {
      expect(out).not.toContain(token);
      expect(out).not.toMatch(/user:/);
    }
    // without --verbose nothing is dumped
    expect((await run(['--plugin-dir', dir])).stderr).not.toMatch(/\[listing\]/);
  });
});
