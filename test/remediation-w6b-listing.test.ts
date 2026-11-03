// Wave 6 W6B (spec Q3): listing inputs read from disk (src/listing), the LST rules on the fixture folders, the needs
// that skip them without input, the manual checklist items they automate, and no credential in any message.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { explainRule } from '../src/explain.js';
import { attachListing, LISTING_JSON_CAP, loadOpenAiManifest, loadPluginDir, mergeListings, type Listing } from '../src/listing/index.js';
import { TEXT_CAP } from '../src/limits.js';
import { manualChecklist, RULES, runRules } from '../src/rules/index.js';
import { contrast, launcherOf, listingRules, readmeProse, triggeredTools } from '../src/rules/listing.js';
import { MANUAL_ITEMS } from '../src/rules/manual.js';
import { snap, tool } from './helpers.js';

const FIX = fileURLToPath(new URL('./fixtures/listing/', import.meta.url));
const URL_ = 'https://mcp.acme.test/mcp';
const TOOLS = [tool(), tool({ name: 'read_note', title: 'Read note', description: 'Read one note by id from the Acme Notes API.' })];

function run(listing: Listing | undefined, url: string | undefined = URL_, target: 'all' | 'claude' | 'chatgpt' = 'all') {
  const s = snap({ url, tools: TOOLS, target });
  attachListing(s, listing);
  return { s, r: runRules(s, RULES) };
}
const lst = (r: ReturnType<typeof runRules>) => r.findings.filter((f) => f.ruleId.startsWith('LST-'));
const ids = (r: ReturnType<typeof runRules>) => [...new Set(lst(r).map((f) => f.ruleId))].sort();

describe('W6B listing fixtures', () => {
  it('a valid plugin folder and a valid ChatGPT package give no LST finding', () => {
    const { r } = run(mergeListings(loadPluginDir(join(FIX, 'plugin-valid')), loadOpenAiManifest(join(FIX, 'openai-valid', 'plugin.json'))));
    expect(lst(r).map((f) => `${f.ruleId} ${f.message}`)).toEqual([]);
    expect(r.skipped.filter((x) => x.ruleId.startsWith('LST-'))).toEqual([]);
  });

  it('the invalid plugin folder trips the plugin rules', () => {
    const l = loadPluginDir(join(FIX, 'plugin-invalid'));
    expect(l.errors).toEqual([]);
    const { r } = run(l);
    expect(ids(r)).toEqual(['LST-002', 'LST-003', 'LST-004', 'LST-005', 'LST-006', 'LST-007', 'LST-008', 'LST-009', 'LST-010', 'LST-011', 'LST-012', 'LST-013', 'LST-014', 'LST-015']);
    for (const f of lst(r)) expect(f.platforms).toEqual(['claude']);
  });

  it('the invalid ChatGPT package trips the ChatGPT rules, with the MAN item in the message', () => {
    const { r } = run(loadOpenAiManifest(join(FIX, 'openai-invalid', 'plugin.json')));
    expect(ids(r)).toEqual(['LST-017', 'LST-018', 'LST-019', 'LST-020', 'LST-021', 'LST-022', 'LST-023', 'LST-024', 'LST-025', 'LST-026', 'LST-027']);
    for (const f of lst(r)) expect(f.platforms).toEqual(['chatgpt']);
    for (const f of lst(r).filter((x) => x.ruleId !== 'LST-024' && x.ruleId !== 'LST-026')) expect(f.message, f.ruleId).toMatch(/\(MAN-0\d\d\)$/);
  });

  it('no credential of the fixtures reaches a message, evidence or path (SYNTH values, URL userinfo)', () => {
    const { r } = run(mergeListings(loadPluginDir(join(FIX, 'plugin-invalid')), loadOpenAiManifest(join(FIX, 'openai-invalid', 'plugin.json'))));
    const text = JSON.stringify(lst(r));
    expect(text).not.toMatch(/SYNTH/);
    expect(text).not.toContain('user:');
  });

  it('a bare mcp.json is read as the MCP configuration and LST-016 says the listing was not checked', () => {
    const l = loadOpenAiManifest(join(FIX, 'openai-mcp-only', 'mcp.json'));
    expect(l.openai?.format).toBe('mcp-config');
    expect(l.openai?.mcp).toBe(l.openai?.manifest);
    const { r } = run(l);
    expect(lst(r).map((f) => [f.ruleId, f.severity])).toEqual([['LST-016', 'warning']]);
  });

  it('target filtering: --target chatgpt skips the plugin rules, --target claude the ChatGPT ones', () => {
    const both = () => mergeListings(loadPluginDir(join(FIX, 'plugin-invalid')), loadOpenAiManifest(join(FIX, 'openai-invalid', 'plugin.json')));
    expect(ids(run(both(), URL_, 'chatgpt').r).every((id) => Number(id.slice(4)) >= 16)).toBe(true);
    expect(ids(run(both(), URL_, 'claude').r).every((id) => Number(id.slice(4)) <= 15)).toBe(true);
  });
});

describe('W6B needs and additivity', () => {
  it('without listing input every LST rule is skipped with the flag to pass, and nothing else changes', () => {
    const plain = snap({ url: URL_, tools: TOOLS });
    const before = runRules(plain, RULES);
    expect(plain.listing).toBeUndefined();
    const skipped = before.skipped.filter((x) => x.ruleId.startsWith('LST-'));
    expect(skipped.map((x) => x.ruleId).sort()).toEqual(listingRules.map((x) => x.id).sort());
    for (const x of skipped) expect(x.reason).toMatch(/^needs --(plugin-dir|openai-manifest)$|^stdio target$/);
    expect(attachListing(plain, undefined).listing).toBeUndefined();
    expect(attachListing(plain, { errors: [], truncated: [] }).listing).toBeUndefined();
    expect(before.findings.filter((f) => f.ruleId.startsWith('LST-'))).toEqual([]);
  });

  it('cross-checks need their live input: LST-015/026 need a URL target, LST-025 tools/list', () => {
    const l = () => mergeListings(loadPluginDir(join(FIX, 'plugin-invalid')), loadOpenAiManifest(join(FIX, 'openai-invalid', 'plugin.json')));
    const stdio = snap({ tools: TOOLS });
    attachListing(stdio, l());
    const r = runRules(stdio, RULES);
    for (const id of ['LST-015', 'LST-026']) expect(r.skipped.find((x) => x.ruleId === id)?.reason, id).toBe('stdio target');
    const s = snap({ url: URL_, tools: TOOLS });
    delete s.listMeta.tools;
    attachListing(s, l());
    expect(runRules(s, RULES).skipped.find((x) => x.ruleId === 'LST-025')?.reason).toMatch(/tools\/list/);
  });

  it('explain shows the need of an LST rule', () => {
    expect(explainRule('LST-001')).toMatch(/Needs\s+--plugin-dir <dir>/);
    expect(explainRule('LST-025')).toMatch(/Needs\s+--openai-manifest <file>, tools\/list works/);
  });

  it('RULES lists the LST category last and in order', () => {
    const lstIds = RULES.map((r) => r.id).filter((id) => id.startsWith('LST-'));
    expect(lstIds).toEqual(listingRules.map((r) => r.id));
    expect(RULES.at(-1)?.id).toBe(lstIds.at(-1));
  });
});

describe('W6B manual checklist', () => {
  const manual = (l: Listing | undefined) => manualChecklist(run(l).s);
  const byId = (items: ReturnType<typeof manual>) => Object.fromEntries(items.map((m) => [m.id, m.text]));

  it('without input the checklist is unchanged', () => {
    const all = byId(manual(undefined));
    for (const m of MANUAL_ITEMS.filter((x) => !x.feature && x.id !== 'MAN-031')) expect(all[m.id]).toBe(m.text);
  });

  it('with --openai-manifest the fully automated items are dropped and the partly automated ones keep their manual rest', () => {
    const items = byId(manual(loadOpenAiManifest(join(FIX, 'openai-valid', 'plugin.json'))));
    for (const id of ['MAN-015', 'MAN-017', 'MAN-018', 'MAN-020', 'MAN-023']) expect(items[id], id).toBeUndefined();
    expect(items['MAN-016']).toMatch(/publicly accessible.*checked by LST-018/);
    expect(items['MAN-019']).toBeUndefined(); // 0.6: LST-027 reads the image sizes
    expect(items['MAN-021']).toMatch(/web, iOS and Android.*checked by LST-022/);
    expect(items['MAN-022']).toBe(MANUAL_ITEMS.find((m) => m.id === 'MAN-022')!.text);
    expect(items['MAN-002']).toBe(MANUAL_ITEMS.find((m) => m.id === 'MAN-002')!.text);
  });

  it('with --plugin-dir MAN-002 keeps the connector-form part only', () => {
    const items = byId(manual(loadPluginDir(join(FIX, 'plugin-valid'))));
    expect(items['MAN-002']).toMatch(/slug is permanent \(the rest is checked by LST-014\)$/);
    expect(items['MAN-002']).not.toMatch(/privacy URL|icon/);
    expect(items['MAN-015']).toBeDefined();
  });
});

describe('W6B loader limits and errors', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mrc-w6b-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('a missing folder or manifest is recorded, not thrown, and the messages carry no absolute path', () => {
    const l = mergeListings(loadPluginDir(join(dir, 'nope')), loadOpenAiManifest(join(dir, 'nope.json')));
    expect(l.errors.map((e) => [e.source, e.path, e.message])).toEqual([['plugin', '.', 'could not be read (ENOENT)'], ['openai', 'nope.json', 'does not exist']]);
    const { r } = run(l);
    expect(lst(r).find((f) => f.ruleId === 'LST-001')?.message).toBe('the plugin folder could not be read (ENOENT)');
    expect(JSON.stringify(lst(r))).not.toContain(dir);
  });

  it('invalid JSON is recorded with the file and LST-001 / LST-006 report it', () => {
    mkdirSync(join(dir, '.claude-plugin'));
    writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), '{ "name": "acme-notes", }');
    writeFileSync(join(dir, '.mcp.json'), '{ nope');
    const l = loadPluginDir(dir);
    expect(l.errors.map((e) => e.path)).toEqual(['.claude-plugin/plugin.json', '.mcp.json']);
    const { r } = run(l);
    expect(lst(r).filter((f) => ['LST-001', 'LST-006'].includes(f.ruleId)).map((f) => f.ruleId)).toEqual(['LST-001', 'LST-006']);
  });

  it('a manifest over the read cap is not parsed; long strings are cut and reported with the other input caps', () => {
    const big = join(dir, 'big.json');
    writeFileSync(big, JSON.stringify({ pad: 'x'.repeat(LISTING_JSON_CAP) }));
    expect(loadOpenAiManifest(big).errors[0].message).toMatch(/over the 1 MiB read cap; not parsed/);
    const long = join(dir, 'plugin.json');
    writeFileSync(long, JSON.stringify({ name: 'n', extensions: { 'com.openai': { interface: { longDescription: 'y'.repeat(TEXT_CAP + 10) } } } }));
    const l = loadOpenAiManifest(long);
    expect(l.truncated).toEqual([{ where: 'plugin.json', length: TEXT_CAP + 10, cap: TEXT_CAP }]);
    const { s, r } = run(l);
    expect(s.limits?.truncated).toEqual(l.truncated);
    expect(lst(r).find((f) => /longDescription is/.test(f.message))?.message).toMatch(/max 4000/);
  });

  it.skipIf(process.platform === 'win32')('links are listed, never followed (README through a link is not read)', () => {
    writeFileSync(join(dir, 'outside.md'), 'secret text outside the plugin '.repeat(20));
    const plug = join(dir, 'plug');
    mkdirSync(plug);
    symlinkSync(join(dir, 'outside.md'), join(plug, 'README.md'));
    const l = loadPluginDir(plug);
    expect(l.plugin?.readme).toBeUndefined();
    expect(l.plugin?.files).toEqual([{ path: 'README.md', size: 0, kind: 'symlink' }]);
    expect(l.errors).toEqual([]);
    expect(lst(run(l).r).find((f) => f.ruleId === 'LST-013')?.message).toMatch(/symbolic links.*README\.md/);
  });

  it('a Codex manifest in .codex-plugin/ reads .mcp.json from the package root', () => {
    mkdirSync(join(dir, '.codex-plugin'));
    writeFileSync(join(dir, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'acme-notes', interface: { displayName: 'Acme Notes' }, mcpServers: './.mcp.json' }));
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { notes: { url: URL_ } } }));
    const l = loadOpenAiManifest(join(dir, '.codex-plugin', 'plugin.json'));
    expect(l.openai?.format).toBe('codex');
    expect(l.openai?.manifest.path).toBe('.codex-plugin/plugin.json');
    expect(l.openai?.mcp?.path).toBe('.mcp.json');
    // Codex requires capabilities, composerIcon and logo
    const msgs = lst(run(l).r).map((f) => f.message).join('\n');
    expect(msgs).toMatch(/^interface\.capabilities is missing \(required in the Codex format/m);
    expect(msgs).toMatch(/^interface\.composerIcon is missing \(required in the Codex format/m);
  });
});

describe('W6B helpers', () => {
  it('launcherOf finds the package and whether it is pinned', () => {
    expect(launcherOf(['npx', '-y', '@acme/notes-mcp@1.4.2'])).toEqual({ launcher: 'npx', spec: '@acme/notes-mcp@1.4.2', pinned: true });
    expect(launcherOf(['npx', '-y', '@acme/notes-mcp'])?.pinned).toBe(false);
    expect(launcherOf(['npx', '-y', 'notes-mcp@^1.4.0'])?.pinned).toBe(false);
    expect(launcherOf(['npx', '--package=notes-mcp@1.0.0', 'notes'])?.pinned).toBe(true);
    expect(launcherOf(['C:\\Program Files\\nodejs\\npx.cmd', 'notes-mcp@latest'])?.pinned).toBe(false);
    expect(launcherOf(['pnpm', 'dlx', 'notes-mcp@2.0.0'])?.pinned).toBe(true);
    expect(launcherOf(['uvx', '--from', 'acme-notes==1.2.3', 'acme-notes'])?.pinned).toBe(true);
    expect(launcherOf(['uvx', '-p', '3.12', 'acme-notes@1.2.3'])?.pinned).toBe(true);
    expect(launcherOf(['uvx', 'acme-notes>=1.2'])?.pinned).toBe(false);
    expect(launcherOf(['pipx', 'run', '--spec', 'acme-notes==1.0.0', 'acme'])?.pinned).toBe(true);
    expect(launcherOf(['uv', 'run', 'server.py'])).toEqual({ launcher: 'uv run', pinned: false });
    expect(launcherOf(['uv', 'run', '--frozen', 'server.py'])?.pinned).toBe(true);
    expect(launcherOf(['node', '${CLAUDE_PLUGIN_ROOT}/server.js'])).toBeUndefined();
    expect(launcherOf(['npx', '${CLAUDE_PLUGIN_ROOT}/server.js'])).toBeUndefined();
  });

  it('contrast follows WCAG 2 (black on white 21:1, #767676 on white about 4.5:1)', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrast('#767676', '#FFFFFF')).toBeCloseTo(4.54, 2);
    expect(contrast('#FFFFFF', '#FFFFFF')).toBe(1);
  });

  it('readmeProse drops fenced code and inline code; triggeredTools splits on commas', () => {
    expect(readmeProse('Install it:\n\n```bash\nnpm i acme\n```\n\nThen run `acme`.').split(/\s+/).filter(Boolean)).toEqual(['Install', 'it:', 'Then', 'run', '.']);
    expect(triggeredTools('search_notes, read_note,')).toEqual(['search_notes', 'read_note']);
    expect(triggeredTools(['a', 1, 'b'])).toEqual(['a', 'b']);
  });
});
