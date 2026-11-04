// Review round 3, package P1 (1.0.1): CLI and config. A discovered config file only sets options (A01-01);
// --save-baseline after a failed connect (A01-02); listing-only drift (A01-04, A07-06); fingerprints that do not
// depend on --env values (A01-05); output collisions (A01-06); drift and save-time messages (A01-07); invalid-URL
// echo (A01-09); empty --bearer / --tool-args (A01-10); workflow commands in --verbose stderr (A07-04);
// --fail-on-incomplete in every format (A10-01); linear baseline and drift matching (improvement).
// Black box: runCli in process on the GOOD fixture, small scripted stdio servers and a local HTTP listener.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import { knownFindings, type FindingKey } from '../src/baseline.js';
import { compareTools, pinFingerprints, toolFingerprint, toolFingerprints } from '../src/report/drift.js';
import { emptySnapshot, type Snapshot } from '../src/snapshot.js';
import { listen, type Started } from './fixtures/http-bridge.js';

const GOOD = fileURLToPath(new URL('./fixtures/good-server.mjs', import.meta.url));
const PLUGIN = fileURLToPath(new URL('./fixtures/listing/plugin-valid', import.meta.url));
const good = ['--stdio', '--', process.execPath, GOOD];
/** A token-shaped string assembled at runtime, never a key-shaped literal in the source. */
const TOKEN = ['sk', 'live', 'SYNTH0123456789abcdef'].join('_');

let dir = '';
const servers: Started[] = [];
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mrc-r3-p1-')); });
afterEach(async () => {
  rmSync(dir, { recursive: true, force: true });
  for (const s of servers.splice(0)) await s.close();
});
const at = (...p: string[]) => join(dir, ...p);
const run = (args: string[], env: Record<string, string> = {}) => runCli(args, env, false);
const json = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

/** A listener that records every request's Authorization header and answers 401 (a partial check: auth-required). */
async function recorder(): Promise<{ url: string; auth: Array<string | undefined> }> {
  const auth: Array<string | undefined> = [];
  const s = await listen((req, res) => {
    auth.push(req.headers.authorization);
    req.resume();
    res.writeHead(401, { 'www-authenticate': 'Bearer' }).end();
  });
  servers.push(s);
  return { url: s.url, auth };
}

/** A plugin folder copy with a discovered .mcp-review-check.json. */
function pluginWithConfig(cfg: unknown): string {
  const p = at('plugin');
  mkdirSync(p);
  for (const f of ['.claude-plugin/plugin.json', '.mcp.json', 'README.md', 'LICENSE']) {
    const src = join(PLUGIN, f);
    if (!existsSync(src)) continue;
    mkdirSync(join(p, f, '..'), { recursive: true });
    writeFileSync(join(p, f), readFileSync(src));
  }
  writeFileSync(join(p, '.mcp-review-check.json'), JSON.stringify(cfg));
  return p;
}

describe('A01-01: a discovered config file may set options, never the server, outputs or credentials', () => {
  it('A01-01 a found stdio server is not started: --plugin-dir stays listing-only, with a warning naming the file and keys', async () => {
    const pwned = at('PWNED');
    const p = pluginWithConfig({ stdio: process.execPath, args: ['-e', `require('fs').writeFileSync(${JSON.stringify(pwned)}, 'ran')`], format: 'json', failOn: 'never' });
    const r = await run(['--plugin-dir', p, '--cwd', p]);
    // --cwd decides where the file is found; a listing-only run then rejects --cwd (exit 2), and nothing started.
    expect(existsSync(pwned)).toBe(false);
    expect(r.stderr).toMatch(/config file .*\.mcp-review-check\.json was found in the directory, not given with --config, so its keys "stdio", "args" are ignored/);
  });

  it('A01-01 run from inside the folder: the found server is ignored, options apply, and stderr names the file', async () => {
    const pwned = at('PWNED');
    const p = pluginWithConfig({ stdio: process.execPath, args: ['-e', `require('fs').writeFileSync(${JSON.stringify(pwned)}, 'ran')`], format: 'json', failOn: 'never', output: at('stolen.txt') });
    const cwd = process.cwd();
    process.chdir(p);
    try {
      const r = await run(['--plugin-dir', '.']);
      expect(r.code, r.stderr).toBe(0);
      expect(existsSync(pwned)).toBe(false);
      expect(existsSync(at('stolen.txt'))).toBe(false);
      expect(JSON.parse(r.stdout).server.listingOnly).toBe(true); // format json came from the file
      expect(r.stderr).toMatch(/keys "stdio", "args", "output" are ignored/);
      expect(r.stderr).toMatch(/^mcp-review-check: options from config file .*\.mcp-review-check\.json$/m);
    } finally { process.chdir(cwd); }
  });

  it('A01-01 $MCP_REVIEW_CHECK_TOKEN never goes to a URL from a found file', async () => {
    const l = await recorder();
    const p = pluginWithConfig({ url: l.url });
    const cwd = process.cwd();
    process.chdir(p);
    try {
      const r = await run(['--plugin-dir', '.'], { MCP_REVIEW_CHECK_TOKEN: TOKEN });
      expect(r.code, r.stderr).toBe(0);
      expect(l.auth).toEqual([]); // nothing connected at all
      expect(r.stderr).toMatch(/keys "url" are ignored/);
      expect(r.stdout + r.stderr).not.toContain(TOKEN);
      // Without --plugin-dir the run needs a target: a usage error, not a connection.
      const none = await run([], { MCP_REVIEW_CHECK_TOKEN: TOKEN });
      expect(none.code).toBe(2);
      expect(l.auth).toEqual([]);
    } finally { process.chdir(cwd); }
  });

  it('A01-01 a found file may not set env, cwd, header, bearer, active, activeAuth, jsonOutput or saveBaseline', async () => {
    writeFileSync(at('.mcp-review-check.json'), JSON.stringify({ env: { A: '1' }, cwd: '.', header: { 'X-A': 'b' }, bearer: TOKEN, active: true, activeAuth: true, jsonOutput: 'j.json', saveBaseline: 's.json', failOn: 'never' }));
    const r = await run(['--cwd', dir, '--format', 'json', ...good]);
    // --cwd on the command line is the user's (allowed); the file's keys are dropped, its failOn applies.
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).toMatch(/keys "env", "cwd", "header", "bearer", "active", "activeAuth", "jsonOutput", "saveBaseline" are ignored/);
    expect(existsSync(at('j.json')) || existsSync(at('s.json'))).toBe(false);
    expect(JSON.parse(r.stdout).summary.failed).toBe(false);
    expect(r.stderr).not.toContain(TOKEN);
  });

  it('A01-01 an explicit --config keeps full power and says the server came from it', async () => {
    const c = at('check.json');
    writeFileSync(c, JSON.stringify({ stdio: process.execPath, args: [GOOD], format: 'json', failOn: 'never', jsonOutput: 'out.json' }));
    const r = await run(['--config', c]);
    expect(r.code, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).server.serverInfo.name).toBe('acme-notes');
    expect(existsSync(at('out.json'))).toBe(true);
    expect(r.stderr).toContain(`mcp-review-check: options from --config ${c} (the server from its key "stdio")`);
    expect(r.stderr).not.toMatch(/are ignored/);
  });
});

describe('A01-02: --save-baseline is not written by a run that did not connect', () => {
  it('A01-02 exit 3 keeps the accepted baseline; --json-output is still written', async () => {
    const keep = at('keep.json');
    expect((await run(['--no-config', '--save-baseline', keep, '--fail-on', 'never', ...good])).code).toBe(0);
    const before = readFileSync(keep, 'utf8');
    const r = await run(['--no-config', '--stdio', `node ${at('nonexistent.mjs')}`, '--baseline', keep, '--save-baseline', keep, '--json-output', at('j.json')]);
    expect(r.code).toBe(3);
    expect(readFileSync(keep, 'utf8')).toBe(before);
    expect(r.stderr).toContain('warning: --save-baseline not written: the run did not connect; the earlier baseline, if any, is kept');
    expect(r.stderr).not.toMatch(/JSON report written to .*keep\.json/);
    expect(json(at('j.json')).toolFingerprints).toBeNull();
  });
});

describe('A01-04 / A07-06: a listing-only run records and compares no tools', () => {
  it('A07-06 a listing-only --save-baseline writes toolFingerprints null and warns', async () => {
    const bl = at('bl.json');
    const r = await run(['--no-config', '--plugin-dir', PLUGIN, '--save-baseline', bl]);
    expect(r.code, r.stderr).toBe(0);
    expect(json(bl).toolFingerprints).toBeNull();
    expect(r.stderr).toMatch(/warning: --save-baseline: no server was checked \(a listing-only run\), so the baseline records no tool fingerprints/);
    // Used as a baseline against a server: not compared, no "added" tools.
    const s = await run(['--no-config', '--baseline', bl, '--format', 'json', '--fail-on', 'never', ...good]);
    expect(JSON.parse(s.stdout).baseline).toEqual({ toolChanges: null, notCompared: 'the baseline run did not list every tool, so it recorded no tool fingerprints' });
  });

  it('A07-06 a 1.0.0 listing-only baseline (toolFingerprints []) is read as no tool list', async () => {
    const bl = at('old.json');
    expect((await run(['--no-config', '--plugin-dir', PLUGIN, '--save-baseline', bl])).code).toBe(0);
    const doc = json(bl);
    doc.toolFingerprints = [];
    writeFileSync(bl, JSON.stringify(doc));
    const s = await run(['--no-config', '--baseline', bl, '--format', 'json', '--fail-on', 'never', ...good]);
    expect(JSON.parse(s.stdout).baseline.toolChanges).toBeNull();
  });

  it('A01-04 a listing-only --baseline run does not report every baseline tool as removed', async () => {
    const base = at('base.json');
    expect((await run(['--no-config', '--save-baseline', base, '--fail-on', 'never', ...good])).code).toBe(0);
    const r = await run(['--no-config', '--plugin-dir', PLUGIN, '--baseline', base, '--fail-on-drift', '--format', 'json']);
    const doc = JSON.parse(r.stdout);
    expect(doc.baseline.toolChanges).toBeNull();
    expect(doc.baseline.notCompared).toBe('this run did not list every tool: no server was checked (a listing-only run)');
    expect(r.stderr).toMatch(/--fail-on-drift: tool definitions not compared \(this run did not list every tool: no server was checked/);
  });
});

describe('A01-05: tool fingerprints do not depend on the run\'s non-secret --env values', () => {
  it('A01-05 a baseline saved without --env shows no drift for a run with --env WORKSPACE=Acme', async () => {
    const b = at('b.json');
    expect((await run(['--no-config', '--save-baseline', b, '--fail-on', 'never', ...good])).code).toBe(0);
    const r = await run(['--no-config', '--baseline', b, '--fail-on-drift', '--fail-on', 'never', '--format', 'json', '--env', 'WORKSPACE=Acme', ...good]);
    expect(r.code, r.stderr).toBe(0);
    const doc = JSON.parse(r.stdout);
    expect(doc.baseline.toolChanges).toEqual({ added: [], removed: [], changed: [] });
    expect(doc.findings.filter((f: { baselined: boolean }) => !f.baselined)).toEqual([]);
    expect(r.stdout).not.toContain('Acme'); // still redacted in the report
  });

  it('A01-05 a 1.0.0 baseline hashed with the --env value redacted still matches (no new drift on upgrade)', () => {
    const tool = { name: 't', description: 'Uses the Acme workspace', inputSchema: { type: 'object' } };
    const rules = { ...emptySnapshot({ kind: 'stdio', command: 'x', args: [] } as never, { target: 'all', active: false, activeAuth: false }), tools: [tool] } as Snapshot;
    rules.coverage = { ...rules.coverage, toolLevel: 'ok' };
    const report = { ...rules, tools: [{ ...tool, description: 'Uses the «redacted» workspace' }] } as Snapshot;
    const old = [toolFingerprint(report.tools[0] as Record<string, unknown>)]; // what 1.0.0 wrote
    pinFingerprints(report, rules);
    expect(toolFingerprints(report)![0].sha256).toBe(toolFingerprint(tool).sha256);
    expect(compareTools(old, report).toolChanges).toEqual({ added: [], removed: [], changed: [] });
    expect(compareTools([toolFingerprint(tool)], report).toolChanges).toEqual({ added: [], removed: [], changed: [] });
    expect(compareTools([toolFingerprint({ ...tool, description: 'other' })], report).toolChanges!.changed).toEqual([{ name: 't', fields: ['description'] }]);
  });
});

describe('A01-06: --output may not overwrite the --baseline file or the JSON report through another name', () => {
  it('A01-06 --baseline b.json --output b.json in text is a usage error; in json it is allowed', async () => {
    const b = at('b.json');
    expect((await run(['--no-config', '--save-baseline', b, '--fail-on', 'never', ...good])).code).toBe(0);
    const r = await run(['--no-config', '--baseline', b, '--output', b, ...good]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/--baseline and --output name the same file/);
    expect(json(b).tool.name).toBe('mcp-review-check');
    const j = await run(['--no-config', '--baseline', b, '--output', b, '--format', 'json', '--fail-on', 'never', ...good]);
    expect(j.code, j.stderr).toBe(0);
    expect((await run(['--no-config', '--baseline', b, '--save-baseline', b, '--fail-on', 'never', ...good])).code).toBe(0);
  });

  it('A01-06 a symlink between --output and --save-baseline is caught', async () => {
    writeFileSync(at('real.json'), '{}');
    symlinkSync(at('real.json'), at('link.txt'));
    const r = await run(['--no-config', '--output', at('link.txt'), '--save-baseline', at('real.json'), ...good]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/--save-baseline and --output name the same file/);
    // A symlinked directory to a file that does not exist yet.
    mkdirSync(at('d'));
    symlinkSync(at('d'), at('e'));
    const n = await run(['--no-config', '--output', at('e', 'x.json'), '--json-output', at('d', 'x.json'), ...good]);
    expect(n.code).toBe(2);
  });
});

describe('A01-07: the not-compared advice follows the side that failed', () => {
  it('A01-07 a partial run says to fix the run, and --save-baseline from it warns', async () => {
    const base = at('base.json');
    expect((await run(['--no-config', '--save-baseline', base, '--fail-on', 'never', ...good])).code).toBe(0);
    const hb = at('hb.json');
    // Answers initialize, and tools/list with an error: a partial check (list-failed) without waiting for a timeout.
    const listFails = at('list-fails.mjs');
    writeFileSync(listFails, `import readline from 'node:readline';
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\\n');
readline.createInterface({ input: process.stdin }).on('line', (l) => {
  const m = JSON.parse(l);
  if (m.id === undefined) return;
  if (m.method === 'initialize') send({ id: m.id, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'lf', version: '1' } } });
  else send({ id: m.id, error: { code: -32603, message: 'boom' } });
});
`);
    const r = await run(['--no-config', '--baseline', base, '--fail-on-drift', '--save-baseline', hb, '--stdio', '--', process.execPath, listFails]);
    expect(r.stderr).toMatch(/--fail-on-drift: tool definitions not compared \(this run did not list every tool: tools\/list failed\); fix this run \(see the coverage line\) before saving a baseline from it/);
    expect(r.stderr).not.toMatch(/re-save the baseline/);
    expect(r.stderr).toMatch(/warning: --save-baseline: tools\/list failed, so the baseline records no tool fingerprints/);
    // The baseline side keeps the re-save advice.
    const g = await run(['--no-config', '--baseline', hb, '--fail-on-drift', '--fail-on', 'never', ...good]);
    expect(g.stderr).toMatch(/the baseline run did not list every tool.*\); re-save the baseline with --save-baseline/);
  }, 240000);
});

describe('A01-09: an argument that is not a URL is not echoed', () => {
  it('A01-09 a value that lost its option (--header "X-Api-Key:" "$KEY") is not shown', async () => {
    const r = await run(['--no-config', '--header', 'X-Api-Key:', TOKEN]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('error: invalid URL (the value is not shown; is a value missing its option?)');
    expect(r.stderr).not.toContain(TOKEN);
    const u = await run(['--no-config', `http://[bad/${TOKEN}`]);
    expect(u.code).toBe(2);
    expect(u.stderr).toMatch(/invalid URL: http:\/\/\[bad\//);
    expect(u.stderr).not.toContain(TOKEN);
  });
});

describe('A01-10: an empty --bearer or --tool-args is said', () => {
  it('A01-10 --bearer "" warns that no token is sent; the behaviour is unchanged', async () => {
    const l = await recorder();
    const r = await run(['--no-config', l.url, '--bearer', ''], { MCP_REVIEW_CHECK_TOKEN: TOKEN });
    expect(r.stderr).toContain('warning: --bearer is empty, so no token is sent (not $MCP_REVIEW_CHECK_TOKEN either)');
    expect(l.auth.filter((a) => a?.includes(TOKEN))).toEqual([]);
    expect(r.stdout + r.stderr).not.toContain(TOKEN);
  });

  it('A01-10 --tool-args "" warns that no file is read', async () => {
    const r = await run(['--no-config', '--active', '--tool-args', '', '--fail-on', 'never', ...good]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).toContain('warning: --tool-args is empty, so no file is read');
  });
});

describe('A07-04: server stderr in --verbose cannot start a GitHub workflow command', () => {
  it('A07-04 leading ::, ##[ and ESC in the stdio stderr tail are neutralised', async () => {
    // Preloaded into the GOOD fixture: the server works, and its stderr carries workflow-command lines.
    const evil = at('evil.mjs');
    writeFileSync(evil, `process.stderr.write('::error title=TOOL-000::forged annotation\\n  ::warning::indented\\n::add-mask::foo\\n##[group]grp\\n\\x1b[31mred\\u202Ebidi\\n');\n`);
    const r = await run(['--no-config', '--verbose', '--no-color', '--fail-on', 'never', '--stdio', '--', process.execPath, '--import', pathToFileURL(evil).href, GOOD], { GITHUB_ACTIONS: 'true' });
    expect(r.code, r.stderr).toBe(0);
    const tail = r.stderr.slice(r.stderr.indexOf('[stdio stderr]'));
    expect(tail).toContain('\\u{3A}:error title=TOOL-000::forged annotation');
    expect(tail).toContain('  \\u{3A}:warning::indented');
    expect(tail).toContain('\\u{23}#[group]grp');
    expect(tail).toContain('\\u{1B}[31mred\\u{202E}bidi');
    expect(tail.split('\n').filter((l) => /^\s*(::|##\[)/.test(l))).toEqual([]);
  });
});

describe('A10-01: --fail-on-incomplete reads as failed in every format', () => {
  it('A10-01 text, json, junit and the GitHub annotation say FAIL on exit 3', async () => {
    const l = await recorder();
    // --fail-on never: the plain 401 also has an AUTH-004 error, which must not be what fails the run here.
    const text = await run(['--no-config', '--fail-on-incomplete', '--fail-on', 'never', '--quiet', l.url]);
    expect(text.code).toBe(3);
    expect(text.stdout).toMatch(/Result: FAIL \(--fail-on-incomplete\) · partial check: auth-required/);
    const j = await run(['--no-config', '--fail-on-incomplete', '--fail-on', 'never', '--format', 'json', l.url]);
    const doc = JSON.parse(j.stdout);
    expect(doc.summary.failed).toBe(true);
    expect(doc.summary.gate.reason).toBe('partial check: auth-required (--fail-on-incomplete)');
    const x = await run(['--no-config', '--fail-on-incomplete', '--fail-on', 'never', '--format', 'junit', l.url]);
    expect(x.code).toBe(3);
    expect(x.stdout).toMatch(/<testsuites name="mcp-review-check" tests="\d+" failures="0" errors="2"/);
    expect(x.stdout).toMatch(/<testcase classname="claude" name="mcp-review-check run">\n {6}<error message="partial check: auth-required[^"]*" type="incomplete"\/>/);
    const o = await run(['--no-config', '--fail-on-incomplete', '--fail-on', 'never', '--output', at('o.txt'), l.url]);
    expect(o.stderr).toMatch(/ · FAIL \(--fail-on-incomplete\) · partial check: auth-required · report written/);
    expect(o.stderr).not.toMatch(/PASS/);
    const gh = await run(['--no-config', '--fail-on-incomplete', '--format', 'json', l.url], { GITHUB_ACTIONS: 'true' });
    expect(gh.stderr).toMatch(/^::error title=mcp-review-check::Partial check: auth-required .*--fail-on-incomplete fails the run\.$/m);
    expect(gh.stderr).not.toMatch(/^::warning title=mcp-review-check::Partial check/m);
  });

  it('A10-01 without the flag a partial check still reads PASS, exit 0 (unchanged)', async () => {
    const l = await recorder();
    const j = await run(['--no-config', '--fail-on', 'never', '--format', 'json', l.url], { GITHUB_ACTIONS: 'true' });
    expect(j.code).toBe(0);
    expect(JSON.parse(j.stdout).summary.failed).toBe(false);
    expect(j.stderr).toMatch(/^::warning title=mcp-review-check::Partial check: .*--fail-on-incomplete fails the run on a partial check\.$/m);
    const x = await run(['--no-config', '--fail-on', 'never', '--format', 'junit', l.url]);
    expect(x.stdout).not.toContain('type="incomplete"');
  });
});

describe('improvement: linear baseline and drift matching', () => {
  // The spread-and-shift versions were quadratic (40k: 12 s and 6 s, four times 10k's 2.4 s and 1.4 s squared-ish);
  // the check is on the growth from 10k to 40k (quadratic is about 16x), after a warm-up run the best of five, over a 5 ms floor, so a loaded host passes.
  const best = (f: () => void) => { f(); return Math.min(...[0, 1, 2, 3, 4].map(() => { const t = performance.now(); f(); return performance.now() - t; })); };
  const keysOf = (n: number): FindingKey[] => Array.from({ length: n }, (_, i) => ({ ruleId: 'TOOL-001', platforms: ['claude'], tool: 'same', message: `m ${i % 3 ? 'a' : 'b'}` }));
  const snapOf = (n: number) => {
    const snap = { ...emptySnapshot({ kind: 'stdio', command: 'x', args: [] } as never, { target: 'all', active: false, activeAuth: false }), tools: Array.from({ length: n }, (_, i) => ({ name: 'dup', description: String(i) })) } as Snapshot;
    snap.coverage = { ...snap.coverage, toolLevel: 'ok' };
    return snap;
  };

  it('knownFindings grows about linearly for many findings on one subject', () => {
    const [small, big] = [keysOf(10000), keysOf(40000)];
    expect(knownFindings(big, big).every(Boolean)).toBe(true);
    const ratio = best(() => knownFindings(big, big)) / Math.max(5, best(() => knownFindings(small, small)));
    expect(ratio).toBeLessThan(10);
  }, 120000);

  it('compareTools grows about linearly for many tools with one name, and pairs them in order', () => {
    const [small, big] = [snapOf(10000), snapOf(40000)];
    const [fs, fb] = [toolFingerprints(small)!, toolFingerprints(big)!];
    const d = compareTools([...fb, toolFingerprint({ name: 'dup' })], big);
    expect(d.toolChanges).toEqual({ added: [], removed: ['dup'], changed: [] });
    const ratio = best(() => compareTools(fb, big)) / Math.max(5, best(() => compareTools(fs, small)));
    expect(ratio).toBeLessThan(10);
  }, 120000);

  it('knownFindings keeps its pairing: a repeat is new, the same wording is taken first', () => {
    const k = (message: string): FindingKey => ({ ruleId: 'R-1', platforms: ['claude'], tool: 't', message });
    expect(knownFindings([k('size 12 KB'), k('other')], [k('other'), k('size 13 KB')])).toEqual([true, true]);
    expect(knownFindings([k('a'), k('a')], [k('a')])).toEqual([true, false]);
    expect(knownFindings([k('x'), k('a')], [k('a')])).toEqual([false, true]);
  });
});
