// 1.3.0, block B2 (review round 4): listings. A06-01 second half (plugin.json mcpServers files at rule severity),
// A06-02 (ChatGPT mcpServers must be the root .mcp.json path), A06-03 (SVG icon without numeric dimensions), A06-04
// (quote-aware SVG start tag), A06-09 (screenshots need an MCP server with UI) and A06-10 (claude/anthropic as a whole
// word in a plugin name). Every positive test here fails on 1.2.0.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import { svgMeasure, svgSize, svgStartTag } from '../src/listing/image.js';
import { attachListing, loadOpenAiManifest, loadPluginDir, type Listing } from '../src/listing/index.js';
import { runRules } from '../src/rules/engine.js';
import { RULES } from '../src/rules/index.js';
import { emptySnapshot, type Snapshot } from '../src/snapshot.js';
import { snap, tool } from './helpers.js';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const FIX = join(REPO, 'test', 'fixtures', 'listing');
const URL_ = 'https://mcp.acme.test/mcp';

let dir = '';
beforeEach(() => {
  // Scratch under the repo's ignored .captures/, not the system temp folder.
  mkdirSync(join(REPO, '.captures'), { recursive: true });
  dir = mkdtempSync(join(REPO, '.captures', 'r130-b2-'));
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

type F = { ruleId: string; severity: string; message: string };
const listingOnly = (l: Listing, target: Snapshot['options']['target']): Snapshot =>
  attachListing(emptySnapshot({ kind: 'listing' }, { target, active: false, activeAuth: false }), l);
const withServer = (l: Listing, target: 'claude' | 'chatgpt', tools = [tool()]): Snapshot => attachListing(snap({ url: URL_, tools, target }), l);
const rule = (s: Snapshot, id: string): Array<[string, string]> =>
  runRules(s, RULES).findings.filter((f) => f.ruleId === id).map((f) => [f.severity, f.message]);
const copy = (from: string) => {
  const root = join(dir, from);
  cpSync(join(FIX, from), root, { recursive: true });
  return root;
};
const editJson = (file: string, edit: (j: Record<string, any>) => void) => {
  const j = JSON.parse(readFileSync(file, 'utf8'));
  edit(j);
  writeFileSync(file, JSON.stringify(j));
};

describe('A06-01 (second half): the plugin.json mcpServers files at rule severity', () => {
  it('the 1.1.1 fixture gives an LST-008 error and LST-006 errors, without the 1.1.x note', () => {
    const s = withServer(loadPluginDir(join(FIX, 'plugin-mcpfiles')), 'claude');
    expect(rule(s, 'LST-008')).toEqual([['error', 'server "acme-extra" in config/mcp.json runs npx "some-unpinned-pkg" without an exact version (blocks: Unpinned npx launcher)']]);
    expect(rule(s, 'LST-006').map((f) => f[0])).toEqual(['error', 'error']);
    expect(runRules(s, RULES).findings.filter((f) => /reported at rule severity/.test(f.message))).toEqual([]);
  });

  it('the CLI fails the run (exit 1) where 1.2.0 passed', async () => {
    const out = await runCli(['--plugin-dir', join(FIX, 'plugin-mcpfiles'), '--target', 'claude', '--format', 'json', '--no-config'], {}, false);
    expect(out.code).toBe(1);
    expect((JSON.parse(out.stdout).findings as F[]).filter((f) => f.ruleId === 'LST-008').map((f) => f.severity)).toEqual(['error']);
  });

  it('a linked folder stays a warning (this tool\'s guard), and a plugin without mcpServers files is unchanged (negative)', () => {
    const root = copy('plugin-valid');
    expect(rule(withServer(loadPluginDir(root), 'claude'), 'LST-006')).toEqual([]);
    mkdirSync(join(dir, 'elsewhere'));
    writeFileSync(join(dir, 'elsewhere', 'x.json'), '{"mcpServers":{"o":{"command":"npx","args":["p"]}}}');
    if (process.platform !== 'win32') {
      symlinkSync(join(dir, 'elsewhere'), join(root, 'linked'));
      editJson(join(root, '.claude-plugin', 'plugin.json'), (j) => { j.mcpServers = './linked/x.json'; });
      expect(rule(withServer(loadPluginDir(root), 'claude'), 'LST-006').map((f) => f[0])).toEqual(['warning']);
    }
  });
});

describe('A06-02: a ChatGPT manifest mcpServers that is not the root .mcp.json path', () => {
  it('an inline object is an LST-024 error, and its servers are read and checked (http URL, headers)', () => {
    const l = loadOpenAiManifest(join(FIX, 'openai-codex-inline', '.codex-plugin', 'plugin.json'));
    expect(l.openai!.format).toBe('codex');
    expect(l.openai!.mcp).toMatchObject({ path: '.codex-plugin/plugin.json' });
    const s = listingOnly(l, 'chatgpt');
    const f24 = rule(s, 'LST-024');
    expect(f24).toContainEqual(['error', '.codex-plugin/plugin.json has an inline mcpServers object; mcpServers must be a string path for the root .mcp.json ("./.mcp.json")']);
    expect(f24.some(([sev, m]) => sev === 'warning' && /server "notes" in \.codex-plugin\/plugin\.json url "http:\/\/mcp\.acme\.test\/mcp"/.test(m))).toBe(true);
    expect(rule(s, 'LST-023').some(([, m]) => /server "notes" .* has headers \(X-Api-Key\)/.test(m))).toBe(true);
    // The value under the credential-like header is never quoted.
    expect(JSON.stringify(runRules(s, RULES).findings)).not.toContain('canary-not-a-real-value');
  });

  it('a string path other than ./.mcp.json is an LST-024 error; the file is still read', () => {
    const root = copy('openai-valid');
    mkdirSync(join(root, 'cfg'));
    writeFileSync(join(root, 'cfg', 'servers.json'), readFileSync(join(root, 'mcp.json')));
    editJson(join(root, 'plugin.json'), (j) => { j.mcpServers = './cfg/servers.json'; });
    const l = loadOpenAiManifest(join(root, 'plugin.json'));
    expect(l.openai!.mcp).toMatchObject({ path: 'cfg/servers.json' });
    expect(rule(listingOnly(l, 'chatgpt'), 'LST-024')).toEqual([['error', 'plugin.json has mcpServers "./cfg/servers.json"; mcpServers must be a string path for the root .mcp.json ("./.mcp.json")']]);
  });

  it('an array is an error too', () => {
    const root = copy('openai-valid');
    editJson(join(root, 'plugin.json'), (j) => { j.mcpServers = ['./.mcp.json']; });
    expect(rule(listingOnly(loadOpenAiManifest(join(root, 'plugin.json')), 'chatgpt'), 'LST-024').map((f) => f[1])).toEqual([expect.stringMatching(/has mcpServers of type array; mcpServers must be a string path/)]);
  });

  it('"./.mcp.json", ".mcp.json", no mcpServers and a bare mcp.json are not reported (negative)', () => {
    for (const ref of ['./.mcp.json', '.mcp.json', undefined]) {
      const root = copy('openai-valid');
      writeFileSync(join(root, '.mcp.json'), readFileSync(join(root, 'mcp.json')));
      editJson(join(root, 'plugin.json'), (j) => { if (ref === undefined) delete j.mcpServers; else j.mcpServers = ref; });
      expect(rule(listingOnly(loadOpenAiManifest(join(root, 'plugin.json')), 'chatgpt'), 'LST-024'), String(ref)).toEqual([]);
      rmSync(root, { recursive: true, force: true });
    }
    expect(rule(listingOnly(loadOpenAiManifest(join(FIX, 'openai-mcp-only', 'mcp.json')), 'chatgpt'), 'LST-024').filter(([, m]) => /must be a string path/.test(m))).toEqual([]);
  });
});

describe('A06-03: an SVG icon without numeric dimensions', () => {
  const l = () => loadOpenAiManifest(join(FIX, 'openai-svg-icons', 'plugin.json'));
  it('is an LST-027 error with the documented wording; a non-px unit is a warning', () => {
    const f = rule(listingOnly(l(), 'chatgpt'), 'LST-027');
    expect(f).toContainEqual(['error', 'extensions.com.openai.interface.logo "./assets/nodims.svg" is an SVG without numeric dimensions; SVG must define a numeric viewBox or numeric width and height (MAN-019)']);
    expect(f.filter(([, m]) => m.includes('units.svg')).map((x) => x[0])).toEqual(['warning']);
  });

  it('an SVG with a > inside a quoted attribute is measured and passes (A06-04, negative for A06-03)', () => {
    const lst = l();
    expect(lst.openai!.images!.find((im) => im.key === 'composerIcon')).toMatchObject({ format: 'svg', width: 64, height: 64 });
    expect(rule(listingOnly(lst, 'chatgpt'), 'LST-027').filter(([, m]) => m.includes('quoted-gt.svg'))).toEqual([]);
  });

  it('an SVG whose start tag is not closed in the bytes read is a warning, not an error', () => {
    const root = copy('openai-svg-icons');
    writeFileSync(join(root, 'assets', 'nodims.svg'), `<svg xmlns="http://www.w3.org/2000/svg" data-x="${'a'.repeat(300 * 1024)}" width="64" height="64">`);
    const f = rule(listingOnly(loadOpenAiManifest(join(root, 'plugin.json')), 'chatgpt'), 'LST-027').filter(([, m]) => m.includes('nodims.svg'));
    expect(f.map((x) => x[0])).toEqual(['warning']);
  });
});

describe('A06-04: svgSize reads the start tag up to the first > outside quotes', () => {
  it('a > inside a quoted value does not end the tag', () => {
    expect(svgSize('<svg data-x="a>b" width="64" height="64">')).toEqual({ width: 64, height: 64 });
    expect(svgSize("<svg aria-label='x > y' viewBox='0 0 48 48'></svg>")).toEqual({ width: 48, height: 48 });
    expect(svgStartTag('<svg data-x="a>b" width="1">')).toBe(' data-x="a>b" width="1"');
  });

  it('reasons when there is no size; a plain SVG without size has none (negative)', () => {
    expect(svgMeasure('<svg width="64" height="64"')).toEqual({ why: 'no-start-tag' });
    expect(svgMeasure('<svg width="2em" height="2em">')).toEqual({ why: 'units' });
    expect(svgMeasure('<svg width="100%" height="100%">')).toEqual({});
    expect(svgMeasure('<svg>')).toEqual({});
  });

  it('stays linear on a long quoted value', () => {
    const t0 = performance.now();
    svgMeasure(`<svg a="${'>'.repeat(200_000)}" ${'x'.repeat(200_000)}`);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

describe('A06-09: screenshots need an MCP server with a UI template', () => {
  const MSG = /skills-only packages must not include interface\.screenshots/;
  it('a skills-only package with a valid screenshot is an LST-028 error', () => {
    const f = rule(listingOnly(loadOpenAiManifest(join(FIX, 'openai-skills-shots', 'plugin.json')), 'chatgpt'), 'LST-028');
    expect(f.filter(([, m]) => MSG.test(m)).map((x) => x[0])).toEqual(['error']);
  });

  it('with a server checked that has no UI template, screenshots are an error; with one they are not', () => {
    const root = copy('openai-skills-shots');
    writeFileSync(join(root, 'mcp.json'), readFileSync(join(FIX, 'openai-valid', 'mcp.json')));
    const l = loadOpenAiManifest(join(root, 'plugin.json'));
    const noUi = rule(withServer(l, 'chatgpt'), 'LST-028');
    expect(noUi).toEqual([['error', 'extensions.com.openai.interface.screenshots is set, but the checked server reports no UI output template; screenshots are allowed only with custom UI (MAN-024)']]);
    const ui = tool({ _meta: { 'openai/outputTemplate': 'ui://widget/notes.html' } });
    expect(rule(withServer(l, 'chatgpt', [ui]), 'LST-028')).toEqual([]);
  });

  it('a listing-only run with a server in mcp.json keeps the UI part manual (negative)', () => {
    const root = copy('openai-skills-shots');
    writeFileSync(join(root, 'mcp.json'), readFileSync(join(FIX, 'openai-valid', 'mcp.json')));
    const s = listingOnly(loadOpenAiManifest(join(root, 'plugin.json')), 'chatgpt');
    expect(rule(s, 'LST-028')).toEqual([]);
  });
});

describe('A06-10: claude or anthropic as a whole word in a plugin name', () => {
  const named = (name: string) => {
    const root = copy('plugin-valid');
    editJson(join(root, '.claude-plugin', 'plugin.json'), (j) => { j.name = name; });
    const f = rule(listingOnly(loadPluginDir(root), 'claude'), 'LST-002');
    rmSync(root, { recursive: true, force: true });
    return f;
  };
  it('my-claude-tool and mcp-for-anthropics are warnings', () => {
    expect(named('my-claude-tool')).toEqual([['warning', 'name "my-claude-tool" has "claude" as a whole word; the plugins reference warns on claude, anthropic or anthropics anywhere in a name']]);
    expect(named('mcp-for-anthropics').map((x) => x[0])).toEqual(['warning']);
  });

  it('a reserved prefix stays one error; claudette or acme-notes are not reported (negative)', () => {
    expect(named('claude-notes')).toEqual([['error', 'name "claude-notes" is reserved or passes as one of Anthropic\'s own']]);
    expect(named('claudette-notes')).toEqual([]);
    expect(named('acme-notes')).toEqual([]);
  });
});
