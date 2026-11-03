// Regression tests for the W6H review fixes (wave 6, 0.4.0): server-controlled keys against lookup tables (SPEC-021),
// a snapshot budget stop as a partial check, JSON syntax errors that do not quote the file, --fail-on-drift that never
// passes silently, and file inputs that must be regular files of bounded size.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hold = vi.hoisted(() => ({ budget: undefined as number | undefined }));
vi.mock('../src/connect.js', async (orig) => {
  const actual = await orig<typeof import('../src/connect.js')>();
  return { ...actual, buildSnapshot: (o: Parameters<typeof actual.buildSnapshot>[0]) => actual.buildSnapshot(hold.budget ? { ...o, snapshotBudget: hold.budget } : o) };
});

import { runCli } from '../src/cli.js';
import { readBaseline } from '../src/baseline.js';
import { loadConfig } from '../src/config.js';
import { INPUT_FILE_CAP, readInputFile } from '../src/input-file.js';
import { loadOpenAiManifest, loadPluginDir } from '../src/listing/load.js';
import { SPEC_021 } from '../src/rules/spec.js';
import { evaluate, snap as snapOf } from './helpers.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const GOOD = join(FIXTURES, 'good-server.mjs');
const MANY = join(FIXTURES, 'many-tools-server.mjs');
const server = (file: string) => ['--stdio', '--', process.execPath, file];
const synth = () => ['sk', 'live', 'SYNTH0123456789abcdef'].join('_');

let dir = '';
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mrc-w6h-')); hold.budget = undefined; });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('item 1: SPEC-021 looks methods up without the prototype chain', () => {
  it('constructor, toString, valueOf, hasOwnProperty and __proto__ produce no finding', () => {
    const names = ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__', 'isPrototypeOf'];
    const s = snapOf({
      set: (x) => {
        x.transport.modernResults = [{ method: 'tools/call', result: { inputRequests: Object.fromEntries(names.map((n, i) => [`r${i}`, { method: n }])) } }];
      },
    });
    expect(evaluate(SPEC_021, s)).toEqual([]);
  });

  it('the registered methods still produce a finding', () => {
    const s = snapOf({
      set: (x) => { x.transport.modernResults = [{ method: 'tools/call', result: { inputRequests: { a: { method: 'roots/list' } } } }]; },
    });
    expect(evaluate(SPEC_021, s).map((f) => f.message).join('\n')).toMatch(/asks the client for roots\/list: Roots/);
  });
});

describe('item 2: a snapshot budget stop is a partial check, not a --max-duration stop', () => {
  const budgetRun = (extra: string[] = [], env: NodeJS.ProcessEnv = {}) => {
    hold.budget = 20000;
    return runCli([...extra, ...server(MANY)], env, false);
  };

  it('the skipped reasons and the Result line say "snapshot budget exhausted"; exit 0 at --fail-on never, never 4', async () => {
    const r = await budgetRun(['--fail-on', 'never', '--format', 'json']);
    expect(r.code).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.skipped.length).toBeGreaterThan(0);
    expect(j.skipped.map((s: { reason: string }) => s.reason).some((x: string) => /^snapshot budget exhausted/.test(x))).toBe(true);
    expect(JSON.stringify(j.skipped)).not.toMatch(/--max-duration/);
    expect(j.summary.failed).toBe(false);
    const t = await budgetRun(['--fail-on', 'never']);
    expect(t.stdout).toMatch(/INCOMPLETE \(snapshot budget exhausted \(during \w[\w ]*\)\)/);
    expect(t.stdout).not.toMatch(/--max-duration/);
  });

  it('follows the --fail-on gate over the findings, and --fail-on-incomplete makes it exit 3', async () => {
    expect((await budgetRun(['--fail-on', 'never', '--fail-on-incomplete'])).code).toBe(3);
    const gated = await budgetRun(['--fail-on', 'warning']);
    expect([0, 1]).toContain(gated.code);
    expect(gated.code).not.toBe(4);
  });

  it('JUnit and the GitHub annotation name the budget', async () => {
    const x = await budgetRun(['--fail-on', 'never', '--format', 'junit']);
    expect(x.stdout).toMatch(/snapshot budget exhausted \(during/);
    expect(x.stdout).not.toMatch(/max-duration/);
    const g = await budgetRun(['--fail-on', 'never'], { GITHUB_ACTIONS: 'true' });
    expect(g.stderr).toMatch(/::warning title=mcp-review-check::Partial check: stopped \(snapshot budget exhausted during/);
    expect(g.stderr).not.toMatch(/::error title=mcp-review-check::Stopped by --max-duration/);
  });
});

describe('item 3: a JSON syntax error never quotes the file', () => {
  const broken = () => `{\n  "mcpServers": { "x": { "env": { "TOKEN": "${synth()}" } } \n  "oops": ${synth()} }`;

  it('a plugin .mcp.json gives a fixed message with at most line and column', () => {
    writeFileSync(join(dir, '.mcp.json'), broken());
    const l = loadPluginDir(dir);
    const msgs = l.errors.map((e) => e.message).join('\n') + JSON.stringify(l.plugin?.mcp);
    expect(msgs).not.toContain('SYNTH');
    expect(l.errors[0].message).toMatch(/^is not valid JSON( \(line \d+, column \d+\))?$/);
  });

  it('a manifest with invalid UTF-8 is "not valid UTF-8" and is not parsed', () => {
    const f = join(dir, 'mcp.json');
    writeFileSync(f, Buffer.concat([Buffer.from('{"a":"'), Buffer.from([0xff, 0xfe, 0xc3]), Buffer.from('"}')]));
    expect(loadOpenAiManifest(f).errors.map((e) => e.message)).toContain('is not valid UTF-8');
  });

  it('--baseline and --config errors do not quote the file either', () => {
    const f = join(dir, 'c.json');
    writeFileSync(f, broken());
    expect(() => readBaseline(f)).toThrow(/^--baseline is not valid JSON/);
    try { readBaseline(f); } catch (e) { expect((e as Error).message).not.toContain('SYNTH'); }
    try { loadConfig(f, true); } catch (e) { expect((e as Error).message).not.toContain('SYNTH'); }
  });
});

describe('item 4: --fail-on-drift does not pass silently when the tools were not compared', () => {
  const save = async () => {
    const file = join(dir, 'base.json');
    const r = await runCli(['--format', 'json', ...server(GOOD)], {}, false);
    writeFileSync(file, r.stdout);
    return { file, doc: JSON.parse(r.stdout) as Record<string, unknown> };
  };

  it('a baseline without fingerprints: exit 1 and the stderr warning; without the flag nothing changes', async () => {
    const { file, doc } = await save();
    delete doc.toolFingerprints;
    writeFileSync(file, JSON.stringify(doc));
    const gated = await runCli(['--baseline', file, '--fail-on-drift', ...server(GOOD)], {}, false);
    expect(gated.code).toBe(1);
    expect(gated.stderr).toMatch(/--fail-on-drift: tool definitions not compared \(tool fingerprints were not recorded in the baseline.*\); re-save the baseline with --save-baseline/);
    const plain = await runCli(['--baseline', file, ...server(GOOD)], {}, false);
    expect(plain.code).toBe(0);
    expect(plain.stderr).not.toMatch(/--fail-on-drift/);
  });

  it('a baseline that recorded null fingerprints is not compared either', async () => {
    const { file, doc } = await save();
    doc.toolFingerprints = null;
    writeFileSync(file, JSON.stringify(doc));
    const r = await runCli(['--baseline', file, '--fail-on-drift', ...server(GOOD)], {}, false);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/tool definitions not compared \(the baseline run did not list every tool/);
  });

  it('a made comparison with no change still exits 0 without a warning', async () => {
    const { file } = await save();
    const r = await runCli(['--baseline', file, '--fail-on-drift', ...server(GOOD)], {}, false);
    expect(r.code).toBe(0);
    expect(r.stderr).not.toMatch(/not compared/);
  });
});

describe.skipIf(process.platform === 'win32')('item 5: file inputs must be regular files of bounded size', () => {
  const fifo = (name: string) => { const p = join(dir, name); execFileSync('mkfifo', [p]); return p; };

  it('--baseline given a FIFO, a directory or a huge file is exit 2 naming the flag, without hanging', async () => {
    const q = await runCli(['--baseline', fifo('b.fifo'), ...server(GOOD)], {}, false);
    expect(q.code).toBe(2);
    expect(q.stderr).toMatch(/cannot read --baseline: it is not a regular file/);
    const d = await runCli(['--baseline', dir, ...server(GOOD)], {}, false);
    expect(d.code).toBe(2);
    expect(d.stderr).toMatch(/cannot read --baseline: it is a directory/);
    const big = join(dir, 'big.json');
    writeFileSync(big, '');
    truncateSync(big, INPUT_FILE_CAP + 1);
    const b = await runCli(['--baseline', big, ...server(GOOD)], {}, false);
    expect(b.code).toBe(2);
    expect(b.stderr).toMatch(/cannot read --baseline: it is larger than 16 MiB/);
  });

  it('--config given a FIFO is exit 2 naming the flag; a discovered FIFO config too', async () => {
    const q = await runCli(['--config', fifo('c.fifo'), ...server(GOOD)], {}, false);
    expect(q.code).toBe(2);
    expect(q.stderr).toMatch(/cannot read --config .*c\.fifo: it is not a regular file/);
    execFileSync('mkfifo', [join(dir, 'mcp-review-check.config.json')]);
    const found = await runCli(['--cwd', dir, ...server(GOOD)], {}, false);
    expect(found.code).toBe(2);
    expect(found.stderr).toMatch(/cannot read config file .*mcp-review-check\.config\.json: it is not a regular file/);
  });

  it('--openai-manifest given a FIFO is exit 2 naming the flag', async () => {
    const r = await runCli(['--openai-manifest', fifo('m.fifo'), ...server(GOOD)], {}, false);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/--openai-manifest must be a file, not a pipe, device or other special file/);
  });

  it('a FIFO inside --plugin-dir is recorded as an error and never opened', () => {
    execFileSync('mkfifo', [join(dir, '.mcp.json')]);
    mkdirSync(join(dir, '.claude-plugin'));
    execFileSync('mkfifo', [join(dir, '.claude-plugin', 'plugin.json')]);
    const l = loadPluginDir(dir);
    expect(l.errors.map((e) => e.message)).toContain('is not a regular file');
  });

  it('readInputFile reads a regular file and honours the cap argument', () => {
    const f = join(dir, 'ok.json');
    writeFileSync(f, '{"a":1}');
    expect(readInputFile(f).toString()).toBe('{"a":1}');
    expect(() => readInputFile(f, 3)).toThrow(expect.objectContaining({ code: 'E2BIG' }));
  });
});
