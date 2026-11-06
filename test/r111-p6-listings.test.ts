// 1.1.1, package P6 (review round 4): listings. A09-02 and A09-04 (linear pyproject header and env -S), A06-01 (the
// plugin.json mcpServers files; info only in 1.1.x and 1.2.x, rule severity since 1.3.0), A06-06 (dependency folders skipped), I-A06-7 (opendir walk),
// A06-07 (MAN-020/021 kept whole), A06-08 (--verbose dump redaction), I-A06-8 (guide) and the listing variant of the
// regex-complexity guard.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The entries each folder read returns, through readdirSync (the whole folder) or per opendirSync handle (counted
// readSync calls): the walk must not read a huge folder in full (I-A06-7).
const readdirSizes: number[] = [];
const opendirReads: number[] = [];
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  const readdirSync = ((...args: Parameters<typeof fs.readdirSync>) => {
    const r = fs.readdirSync(...args);
    readdirSizes.push(r.length);
    return r;
  }) as typeof fs.readdirSync;
  const opendirSync = ((...args: Parameters<typeof fs.opendirSync>) => {
    const d = fs.opendirSync(...args);
    const n = opendirReads.push(0) - 1;
    const read = d.readSync.bind(d);
    d.readSync = () => { const e = read(); if (e) opendirReads[n]++; return e; };
    return d;
  }) as typeof fs.opendirSync;
  return { ...fs, default: { ...fs, readdirSync, opendirSync }, readdirSync, opendirSync };
});

const { runCli } = await import('../src/cli.js');
const { attachListing, describeListing, loadOpenAiManifest, loadPluginDir, LISTING_FILES_CAP } = await import('../src/listing/index.js');
const load = await import('../src/listing/load.js');
const { manualChecklist, RULES, runRules } = await import('../src/rules/index.js');
const listing = await import('../src/rules/listing.js');
const { snap, tool } = await import('./helpers.js');
type Listing = import('../src/listing/types.js').Listing;
type PluginListing = import('../src/listing/types.js').PluginListing;

const REPO = fileURLToPath(new URL('../', import.meta.url));
const FIX = join(REPO, 'test', 'fixtures', 'listing');
const URL_ = 'https://mcp.acme.test/mcp';
const NOTE = '(reported at rule severity from 1.3.0)';

let dir = '';
beforeEach(() => {
  // Scratch under the repo's ignored .captures/, not the system temp folder.
  mkdirSync(join(REPO, '.captures'), { recursive: true });
  dir = mkdtempSync(join(REPO, '.captures', 'r111-p6-'));
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const ms = (f: () => unknown): number => {
  const t0 = performance.now();
  f();
  return performance.now() - t0;
};
/** The best of three runs: a pause of a loaded machine or a GC does not decide a linear-time check. */
const best = (f: () => unknown): number => Math.min(ms(f), ms(f), ms(f));
function rulesOn(l: Listing, url: string | undefined = URL_) {
  const s = snap({ url, tools: [tool()], target: 'claude' });
  attachListing(s, l);
  return { s, r: runRules(s, RULES) };
}
const lst = (r: ReturnType<typeof runRules>) => r.findings.filter((f) => f.ruleId.startsWith('LST-'));
const copy = (name: string, from = 'plugin-valid') => {
  const root = join(dir, name);
  cpSync(join(FIX, from), root, { recursive: true });
  return root;
};
const write = (root: string, files: Record<string, string>) => {
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(join(root, f, '..'), { recursive: true });
    writeFileSync(join(root, f), body);
  }
};
const json = (stdout: string) => JSON.parse(stdout) as { findings: Array<{ ruleId: string; severity: string; message: string; path?: string }> };

describe('A09-02: the pyproject.toml table header is parsed in linear time', () => {
  /** The 1.1.0 header regex (quadratic), kept here as the reference for short lines only. */
  const OLD = /^\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/;

  it('a 256 KB line of "[a" and spaces runs in under 100 ms, with or without a trailing character', () => {
    listing.pyprojectSetsUvSource(`[a${' '.repeat(1024)}`); // warm-up: time the algorithm, not the JIT
    for (const tail of ['', 'x', ']']) {
      const line = `[a${' '.repeat(256 * 1024)}${tail}`;
      expect(best(() => listing.pyprojectSetsUvSource(line)), JSON.stringify(tail)).toBeLessThan(100);
    }
  });

  it('tomlHeader gives the 1.1.0 regex result on random short lines', () => {
    let x = 0x2545f491;
    const next = () => ((x ^= x << 13), (x ^= x >>> 17), (x ^= x << 5), x >>> 0);
    const alphabet = ['[', ']', ' ', '#', 'a', '.', '"', "'", '\t', 'x', ' ', '\r'];
    for (let n = 0; n < 50_000; n++) {
      const line = Array.from({ length: next() % 12 }, () => alphabet[next() % alphabet.length]).join('');
      const m = OLD.exec(line);
      expect(listing.tomlHeader(line), JSON.stringify(line)).toBe(m ? m[1].trim() : undefined);
    }
  });

  it('headers still switch tables: [[tool.uv.index]] is a source, [tool.pdm] index-url is not (negative)', () => {
    expect(listing.pyprojectSetsUvSource('[ [tool.uv.index] ]\n')).toBe(false);
    expect(listing.pyprojectSetsUvSource('[[ tool.uv.index ]] # corp\nurl = "https://x.test"\n')).toBe(true);
    expect(listing.pyprojectSetsUvSource('[tool.uv]\n[tool.pdm]\nindex-url = "https://x.test"\n')).toBe(false);
    expect(listing.pyprojectSetsUvSource('[tool.pdm]\n[ tool . uv ]\nindex-url = "https://x.test"\n')).toBe(true);
  });

  it('a 256 KB .npmrc of blank lines is matched in linear time, and a registry after them is still found', () => {
    const p: PluginListing = { ...pluginBase(), packageConfigs: [{ path: '.npmrc', text: `${'\n'.repeat(256 * 1024)}registry=https://registry.example.test/\n` }] };
    let r: ReturnType<typeof runRules> | undefined;
    // Bounds in seconds on a loaded machine; the 1.1.0 regex took about 24 s.
    expect(ms(() => { r = rulesOn({ plugin: p, errors: [], truncated: [] }).r; })).toBeLessThan(5000);
    expect(lst(r!).filter((f) => f.ruleId === 'LST-009').map((f) => f.severity)).toEqual(['error']);
    // Without a package source the 1.1.0 regex rescanned every blank line from each line start (about 24 s).
    const clean: PluginListing = { ...pluginBase(), packageConfigs: [{ path: '.npmrc', text: `${'\n'.repeat(256 * 1024)}save-exact=true\n` }] };
    expect(ms(() => { r = rulesOn({ plugin: clean, errors: [], truncated: [] }).r; })).toBeLessThan(5000);
    expect(lst(r!).filter((f) => f.ruleId === 'LST-009')).toEqual([]);
  });
});

describe('A09-04: env -S unwrapping is linear', () => {
  it('10,000 -S arguments run in under 100 ms', () => {
    const argv = ['env', ...Array(10_000).fill('-S'), 'npx', 'x'];
    listing.launcherOf(['env', ...Array(100).fill('-S'), 'npx', 'x']); // warm-up
    expect(best(() => listing.launcherOf(argv))).toBeLessThan(100);
    expect(best(() => listing.launcherOf(['env', ...Array(10_000).fill('-Snpx'), 'x']))).toBeLessThan(100);
  });

  it('five -S strings, four of them empty, still reach the launcher (no expansion limit to slip past)', () => {
    expect(listing.launcherOf(['env', '-S', '', '-S', '', '-S', '', '-S', '', '-S', 'npx evil'])).toMatchObject({ kind: 'npx', spec: 'evil', pinned: false });
    expect(listing.launcherOf(['env', '-S', '-S', '-S', '-S', '-S', '-S', 'npx evil'])).toMatchObject({ spec: 'evil' });
  });

  it('the stack unwrapping gives the 1.1.0 env result on random short argv (negative)', () => {
    // The 1.1.0 env branch (quadratic, correct on short input), kept as the reference.
    const words = (cmd: string) => {
      const w = cmd.trim().split(/\s+/).filter(Boolean).map((x) => x.replace(/^(["'])(.*)\1$/, '$2').replace(/^["']|["']$/g, ''));
      return w[0] === 'exec' ? w.slice(1) : w;
    };
    const oldEnv = (argv: string[]) => {
      let a = argv;
      let i = 1;
      for (; i < a.length; i++) {
        const w = a[i];
        if (w === '-S' || w === '--split-string') { a = ['env', ...words(a[i + 1] ?? ''), ...a.slice(i + 2)]; i = 0; continue; }
        if (w.startsWith('--split-string=')) { a = ['env', ...words(w.slice(15)), ...a.slice(i + 1)]; i = 0; continue; }
        if (w.startsWith('-S') && w.length > 2) { a = ['env', ...words(w.slice(2)), ...a.slice(i + 1)]; i = 0; continue; }
        if (w === '--') { i++; break; }
        if (w.startsWith('-')) { if (['-u', '--unset', '-C', '--chdir'].includes(w)) i++; continue; }
        if (/^[A-Za-z_][\w]*=/.test(w)) continue;
        break;
      }
      return a.slice(i);
    };
    let x = 0x1234567;
    const next = () => ((x ^= x << 13), (x ^= x >>> 17), (x ^= x << 5), x >>> 0);
    const parts = ['-S', '--split-string=', '--split-string', '"', "'", 'npx', 'exec', ' ', 'A=1', '--', '-u', 'x', '-'];
    const word = () => Array.from({ length: next() % 4 }, () => parts[next() % parts.length]).join('');
    for (let n = 0; n < 30_000; n++) {
      const argv = ['env', ...Array.from({ length: next() % 5 }, word)];
      // Only the env wrapper: what follows it is left to the next wrapper round, so compare one round.
      const got = oldEnv(argv);
      if (['env', 'cmd', 'sh', 'bash', 'zsh', 'dash', 'ash', 'ksh'].includes((got[0] ?? '').toLowerCase())) continue;
      expect(listing.unwrapArgv(argv), JSON.stringify(argv)).toEqual(got);
    }
  });

  it('options, K=V, -- and --split-string= behave as before (negative)', () => {
    expect(listing.unwrapArgv(['env', '-u', 'X', 'A=1', '--split-string=B=2 -C /x', '--', 'npx', 'p'])).toEqual(['npx', 'p']);
    expect(listing.unwrapArgv(['env', '-SA=1 uvx', 'q'])).toEqual(['uvx', 'q']);
    expect(listing.unwrapArgv(['env', 'A=1'])).toEqual([]);
  });

  it('up to four -S strings are still expanded (negative)', () => {
    expect(listing.launcherOf(['env', '-S', 'A=1 npx some-pkg'])).toMatchObject({ kind: 'npx', spec: 'some-pkg', pinned: false });
    expect(listing.launcherOf(['env', '-S', '-S', '-S', '-S', 'npx some-pkg'])).toMatchObject({ spec: 'some-pkg' });
  });
});

/** A plugin listing that passes every plugin rule (as plugin-valid). */
function pluginBase(): PluginListing {
  const l = loadPluginDir(join(FIX, 'plugin-valid'));
  return l.plugin!;
}

// 1.3.0 (block B2): what these files add is reported at the rule's own severity; the 1.1.x info level and its note
// are gone. test/r130-b2-listings.test.ts holds the 1.3.0 tests that fail on 1.2.0.
describe('A06-01: the files plugin.json names in mcpServers, at rule severity since 1.3.0', () => {
  it('the fixture: an unpinned npx gives an LST-008 error, ../outside.json and a missing file LST-006 errors', () => {
    const l = loadPluginDir(join(FIX, 'plugin-mcpfiles'));
    expect(l.plugin!.mcpFiles!.map((f) => [f.ref, f.problem ?? 'read'])).toEqual([['./config/mcp.json', 'read'], ['../outside.json', 'escapes'], ['./config/missing.json', 'not-found']]);
    expect(l.errors).toEqual([]);
    const f = lst(rulesOn(l).r);
    expect(f.some((x) => x.message.includes(NOTE))).toBe(false);
    const by = (id: string) => f.filter((x) => x.ruleId === id).map((x) => [x.severity, x.message]);
    expect(by('LST-008')).toEqual([['error', 'server "acme-extra" in config/mcp.json runs npx "some-unpinned-pkg" without an exact version (blocks: Unpinned npx launcher)']]);
    expect(by('LST-006')).toEqual([
      ['error', 'mcpServers names "../outside.json", which is outside the plugin folder (path escapes plugin folder), so it was not read'],
      ['error', 'mcpServers names "./config/missing.json", which does not exist in the plugin folder (Path not found), so it was not read'],
    ]);
    // LST-007 (http://) and LST-009 (.npmrc next to a launcher only the file uses) are errors; LST-011 (a literal under
    // a credential name) is the rule's warning. LST-015 stays quiet: .mcp.json points at the checked host.
    expect(by('LST-007').map((x) => x[0])).toEqual(['error']);
    expect(by('LST-009').map((x) => x[0])).toEqual(['error']);
    expect(by('LST-011').map((x) => x[0])).toEqual(['warning']);
    expect(by('LST-015')).toEqual([]);
  });

  it('LST-015 for a file server on another host is a warning, as for the same server in .mcp.json', () => {
    const root = copy('host', 'plugin-mcpfiles');
    write(root, { '.mcp.json': '{ "mcpServers": {} }' });
    const f = lst(rulesOn(loadPluginDir(root)).r).filter((x) => x.ruleId === 'LST-015');
    expect(f.map((x) => [x.severity, x.message])).toEqual([['warning', 'server "acme-remote" in config/mcp.json points at "http://mcp.other.test/mcp", not at the checked server host mcp.acme.test']]);
    write(root, { '.mcp.json': JSON.stringify({ mcpServers: { r: { type: 'http', url: 'https://mcp.other.test/mcp' } } }) });
    expect(lst(rulesOn(loadPluginDir(root)).r).filter((x) => x.ruleId === 'LST-015').map((x) => x.severity)).toEqual(['warning', 'warning']);
  });

  it('the CLI exits 1 at the default --fail-on and reports the LST-008 error', async () => {
    const out = await runCli(['--plugin-dir', join(FIX, 'plugin-mcpfiles'), '--target', 'claude', '--format', 'json', '--no-config'], {}, false);
    expect(out.code).toBe(1);
    expect(json(out.stdout).findings.filter((f) => f.ruleId === 'LST-008').map((f) => f.severity)).toEqual(['error']);
    expect(out.stderr).not.toMatch(/warning: --plugin-dir/);
  });

  it('the same server in .mcp.json keeps its rule severity (negative)', () => {
    const root = copy('own');
    write(root, { '.mcp.json': JSON.stringify({ mcpServers: { a: { command: 'npx', args: ['some-unpinned-pkg'] } } }) });
    const f = lst(rulesOn(loadPluginDir(root)).r).filter((x) => x.ruleId === 'LST-008');
    expect(f.map((x) => [x.severity, x.message.endsWith(NOTE)])).toEqual([['error', false]]);
  });

  it('a string mcpServers, a bad file, an absolute path, a non-./ path or a URL is an LST-006 error; a linked folder a warning', () => {
    const root = copy('shapes');
    const m = JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
    write(root, { 'bad.json': '{ "mcpServers": ', 'list.json': '[1, 2]', 'outside/x.json': '{"mcpServers":{"o":{"command":"npx","args":["p"]}}}' });
    mkdirSync(join(dir, 'elsewhere'));
    writeFileSync(join(dir, 'elsewhere', 'x.json'), '{"mcpServers":{"o":{"command":"npx","args":["p"]}}}');
    symlinkSync(join(dir, 'elsewhere'), join(root, 'linked'));
    const cases: Array<[unknown, string]> = [[['./bad.json'], 'error'], [['./list.json'], 'error'], [['/etc/x.json'], 'error'], [['outside/x.json'], 'error'], [['./linked/x.json'], 'warning'], [['https://x.test/m.json'], 'error'], ['./bad.json', 'error']];
    for (const [refs, level] of cases) {
      writeFileSync(join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ ...m, mcpServers: refs }));
      const l = loadPluginDir(root);
      expect(l.errors, JSON.stringify(refs)).toEqual([]);
      const f = lst(rulesOn(l).r);
      expect(f.filter((x) => x.ruleId === 'LST-006').map((x) => [x.severity, x.message.endsWith(NOTE)]), JSON.stringify(refs)).toEqual([[level, false]]);
      // No server of those files was read, so no other rule reports them.
      expect(f.filter((x) => ['LST-008', 'LST-009'].includes(x.ruleId)), JSON.stringify(refs)).toEqual([]);
    }
  });

  it('./.mcp.json is not read twice and a .mcpb path stays with LST-010', () => {
    const root = copy('dup');
    const m = JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
    writeFileSync(join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ ...m, mcpServers: ['./.mcp.json', './server.mcpb'] }));
    const l = loadPluginDir(root);
    expect(l.plugin!.mcpFiles).toEqual([]);
    expect(listing.pluginServers(l.plugin!).map((s) => s.name)).toEqual(['acme', 'acme-local']);
  });
});

describe('A06-06: dependency, VCS and build-cache folders are not walked', () => {
  it('the plugin-deps fixture: no LST-009 for node_modules/dep/.npmrc, no binary, no system file; the skipped folders at info', async () => {
    const l = loadPluginDir(join(FIX, 'plugin-deps'));
    expect(l.plugin!.packageConfigs).toEqual([]);
    expect(l.plugin!.files.filter((f) => /node_modules|\.venv|__pycache__/.test(f.path))).toEqual([]);
    expect(l.plugin!.skippedDirs).toEqual(['.venv', 'node_modules', 'src/__pycache__']);
    const out = await runCli(['--plugin-dir', join(FIX, 'plugin-deps'), '--target', 'claude', '--fail-on', 'warning', '--format', 'json', '--no-config'], {}, false);
    expect(out.code).toBe(0);
    expect(json(out.stdout).findings.filter((f) => f.ruleId.startsWith('LST-')).map((f) => `${f.ruleId} ${f.severity}`)).toEqual(['LST-013 info']);
  });

  it('a committed node_modules (not in the root .gitignore) is still walked and checked', () => {
    const root = copy('committed');
    write(root, { 'node_modules/dep/.npmrc': 'registry=https://registry.example.test/\n', '.gitignore': '# deps\n/dist\n' });
    const l = loadPluginDir(root);
    expect(l.plugin!.skippedDirs).toBeUndefined();
    expect(lst(rulesOn(l).r).filter((f) => f.ruleId === 'LST-009').map((f) => `${f.path} ${f.severity}`)).toEqual(['node_modules/dep/.npmrc error']);
    // A re-include after the ignore line wins too.
    write(root, { '.gitignore': 'node_modules/\n!node_modules\n' });
    expect(loadPluginDir(root).plugin!.skippedDirs).toBeUndefined();
  });

  it('gitignore forms: /name is root only, a/name a path, **/name and name/ any depth; .git is always skipped', () => {
    const rules = load.gitignoreRules('/venv\nsub/node_modules/\n**/__pycache__/\n.tox/\n*.pyc\ndist/\n');
    expect(rules.map((r) => r.path)).toEqual(['venv', 'sub/node_modules', '__pycache__', '.tox']);
    expect(['venv', 'a/venv', 'sub/node_modules', 'node_modules', 'x/y/__pycache__', 'a/.tox'].map((r) => load.ignoredBy(r, rules))).toEqual([true, false, true, false, true, true]);
    const root = copy('vcs');
    write(root, { 'lib/.git/config': '[core]\n' });
    expect(loadPluginDir(root).plugin!.skippedDirs).toEqual(['lib/.git']);
  });

  it('LST-013 does not count 600 ignored dependency files; the same files in lib/ still count (negative)', () => {
    const root = copy('count');
    write(root, { '.gitignore': 'node_modules/\n' });
    write(root, Object.fromEntries(Array.from({ length: 600 }, (_, i) => [`node_modules/dep/f${i}.js`, ''])));
    expect(lst(rulesOn(loadPluginDir(root)).r).filter((f) => f.ruleId === 'LST-013').map((f) => f.severity)).toEqual(['info']);
    write(root, Object.fromEntries(Array.from({ length: 600 }, (_, i) => [`lib/f${i}.js`, ''])));
    expect(lst(rulesOn(loadPluginDir(root)).r).filter((f) => f.ruleId === 'LST-013' && f.severity === 'warning').map((f) => f.message)).toEqual([expect.stringMatching(/over 512/)]);
  });

  it('a package config outside the skipped folders still counts, and a file named node_modules is listed (negative)', () => {
    const root = copy('vendor');
    write(root, { 'vendor/.npmrc': 'registry=https://registry.example.test/\n', 'docs/node_modules': 'a file, not a folder' });
    const l = loadPluginDir(root);
    expect(l.plugin!.files.map((f) => f.path)).toContain('docs/node_modules');
    expect(lst(rulesOn(l).r).filter((f) => f.ruleId === 'LST-009').map((f) => `${f.path} ${f.severity}`)).toEqual(['vendor/.npmrc error']);
  });
});

describe('I-A06-7: the walk does not read a huge folder in full', () => {
  it('a folder with 50,000 entries stops at the cap and no folder listing is read whole', () => {
    const root = copy('huge');
    const big = join(root, 'data');
    mkdirSync(big);
    for (let i = 0; i < 50_000; i++) writeFileSync(join(big, `f${i}`), '');
    readdirSizes.length = 0;
    opendirReads.length = 0;
    let l: Listing | undefined;
    const t = ms(() => { l = loadPluginDir(root); });
    expect(l!.plugin!.filesTruncated).toBe(true);
    expect(l!.plugin!.files.length).toBe(LISTING_FILES_CAP);
    const bound = LISTING_FILES_CAP + load.SKIPPED_DIRS.size + 1;
    expect(Math.max(0, ...readdirSizes)).toBeLessThanOrEqual(bound);
    expect(opendirReads.length).toBeGreaterThan(0);
    expect(Math.max(...opendirReads)).toBeLessThanOrEqual(bound);
    expect(t).toBeLessThan(5000);
  }, 60_000);
});

describe('A06-07: MAN-020 and MAN-021 stay whole when LST-022 read no server', () => {
  const man = (root: string) => {
    const s = snap({ url: URL_, tools: [tool()], target: 'chatgpt' });
    attachListing(s, loadOpenAiManifest(join(root, 'plugin.json')));
    return Object.fromEntries(manualChecklist(s).filter((i) => i.id === 'MAN-020' || i.id === 'MAN-021').map((i) => [i.id, i.text]));
  };

  it('a broken mcp.json keeps both items whole', () => {
    const root = copy('broken', 'openai-valid');
    writeFileSync(join(root, 'mcp.json'), '{ "mcpServers": { "a": { "url": "https://x.test/mcp" }, }');
    const items = man(root);
    expect(items['MAN-020']).toBe('Exactly 5 positive and 3 negative test cases; tools_triggered exist; release notes');
    expect(items['MAN-021']).toBe('Demo recording URL covering web, iOS and Android');
  });

  it('an mcp.json with no server keeps them whole; a valid one cuts MAN-021 to its residual (negative)', () => {
    const root = copy('empty', 'openai-valid');
    writeFileSync(join(root, 'mcp.json'), '{ "mcpServers": {} }');
    expect(man(root)['MAN-021']).toBe('Demo recording URL covering web, iOS and Android');
    expect(man(join(FIX, 'openai-valid'))['MAN-021']).toBe('Demo recording covers web, iOS and Android (the rest is checked by LST-022)');
  });
});

describe('A06-08: the --verbose listing dump redacts a one-string command and URL userinfo after --flag=', () => {
  const dump = () => {
    const p = pluginBase();
    p.mcp = { path: '.mcp.json', json: { mcpServers: {
      a: { command: 'node server.js --api-key sk-live-abcdefgh12345678XYZ --password=hunter2hunter2' },
      c: { command: 'node server.js --header "Authorization: Bearer hdrsecret123456" --api-key "abc def123secret"' },
      d: { command: 'node server.js --api-key "unterminated opensecret99' },
      b: { command: 'node', args: ['server.js', '--db=postgres://admin:pw123456@db.internal/x', 'see https://u:p4ssw0rd@h.test/x for docs'] },
    } } };
    return JSON.stringify(describeListing({ plugin: p, errors: [], truncated: [] }));
  };

  it('no credential is printed', () => {
    const d = dump();
    for (const secret of ['sk-live-abcdefgh12345678XYZ', 'hunter2hunter2', 'pw123456', 'p4ssw0rd', 'hdrsecret123456', 'def123secret', 'opensecret99']) expect(d).not.toContain(secret);
  });

  it('the rest of the values stays readable (negative)', () => {
    const d = dump();
    for (const kept of ['node server.js --api-key [redacted] --password=[redacted]', '--db=postgres://db.internal/x', 'see https://h.test/x for docs', 'node server.js --header \\"Authorization: [redacted]\\" --api-key [redacted]']) expect(d).toContain(kept);
  });
});

describe('I-A06-8: the listings guide says which files --plugin-dir reads', () => {
  const guide = readFileSync(join(REPO, 'docs', 'guide', 'listings.md'), 'utf8');
  it('has the section, linked from the --plugin-dir paragraph, naming every skipped folder', () => {
    expect(guide).toMatch(/^## Which files --plugin-dir reads$/m);
    expect(guide).toContain('](#which-files---plugin-dir-reads)');
    const section = guide.slice(guide.indexOf('## Which files --plugin-dir reads'));
    for (const d of load.SKIPPED_DIRS) expect(section, d).toContain(`\`${d}\``);
    for (const f of load.PACKAGE_CONFIG_FILES) expect(section, f).toContain(`\`${f}\``);
    // 1.3.0: the 1.1.x info note is gone from the guide.
    expect(section).not.toContain(NOTE);
  });
});

describe('regex-complexity guard: every LST rule over large plugin-controlled input', () => {
  const SIZE = 200 * 1024;
  const UNITS = ['[index\n', '-S"', "-S'\"", '--split-string=', ' ', '\n', ' \n', '[a ', '[[', '-S', '-S ', '`', '```', '~~~\n', '"', "'", '.', '=', '{', '[', 'uv ', 'a+', '://', '@a:', 'registry ', '\\', '${', '<', 'a.', '-'];
  for (const unit of UNITS) {
    it(`unit ${JSON.stringify(unit)} in pyproject.toml, .npmrc, README, plugin.json and .mcp.json args runs each rule in under 1 s`, () => {
      const big = unit.repeat(Math.ceil(SIZE / unit.length));
      const p = pluginBase();
      p.manifest = { path: '.claude-plugin/plugin.json', json: { ...(p.manifest!.json as object), name: big, description: big, version: big, icon: big, documentationUrl: big, mcpServers: [big, `./${big}.json`] } };
      p.mcp = { path: '.mcp.json', json: { mcpServers: {
        a: { command: 'env', args: [...big.split('\n').slice(0, 30_000), '-S', big, 'npx', big] },
        b: { command: `npx ${big}`, env: { API_TOKEN: big }, headers: { Authorization: big } },
        c: { type: 'http', url: `https://${big}` },
      } } };
      p.mcpFiles = [{ ref: './x.json', path: 'x.json', json: { mcpServers: { d: { command: 'uv', args: ['run', ...Array(5000).fill(big.slice(0, 40))] } } } }];
      p.readme = { path: 'README.md', text: big };
      p.packageConfigs = [{ path: 'pyproject.toml', text: `# uv\n${big}` }, { path: '.npmrc', text: big }, { path: 'bunfig.toml', text: `[${big}` }];
      const s = snap({ url: URL_, tools: [tool()], target: 'claude' });
      attachListing(s, { plugin: p, errors: [], truncated: [] });
      for (const rule of listing.listingRules.filter((r) => r.needs.includes('plugin-dir'))) {
        const t = ms(() => runRules(s, [rule]));
        expect(t, rule.id).toBeLessThan(1000);
      }
      // The dump walks every string of the input (30,000 args here): a looser bound, still far below a quadratic scan
      // (seconds on a loaded machine, minutes when quadratic).
      expect(ms(() => describeListing({ plugin: p, errors: [], truncated: [] })), 'describeListing').toBeLessThan(5000);
    });
  }
});
