// Regression tests for the W5A-cli package (wave 5, 0.3.0): --json-output <file> and --save-baseline <file> write the
// --format json document (baselined marks included) besides the primary output, redacted the same way; a file that
// cannot be written is exit 2. The baseline loop: --save-baseline once, --baseline on later runs.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';

const BAD = fileURLToPath(new URL('./fixtures/bad-server.mjs', import.meta.url));
const LEAKY = fileURLToPath(new URL('./fixtures/leaky-server.mjs', import.meta.url));
const SECRET = 'sk-live-W5AJSONOUTSECRET01';
const server = ['--no-config', '--stdio', '--', process.execPath, BAD];

let dir = '';
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mrc-w5a-json-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
const run = (args: string[]) => runCli(args, {}, false);
/** A JSON report without what changes between two runs. */
const stable = (text: string) => { const d = JSON.parse(text); delete d.startedAt; delete d.durationMs; return d; };

describe('--json-output: the JSON report besides another format', () => {
  it('with --format text the file is the --format json document; stdout keeps the text report', async () => {
    const out = join(dir, 'r.json');
    const text = await run(['--format', 'text', '--fail-on', 'never', '--json-output', out, ...server]);
    expect(text.code, text.stderr).toBe(0);
    expect(text.stdout).toMatch(/^Score /m);
    expect(text.stderr).toContain(`mcp-review-check: JSON report written to ${out}`);
    const json = await run(['--format', 'json', '--fail-on', 'never', ...server]);
    expect(stable(readFileSync(out, 'utf8'))).toEqual(stable(json.stdout));
  });

  it('with --format sarif --output, both files are written and the summary line names both', async () => {
    const sarif = join(dir, 'r.sarif');
    const out = join(dir, 'r.json');
    const r = await run(['--format', 'sarif', '--output', sarif, '--json-output', out, ...server]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(new RegExp(`report written to .*r\\.sarif · JSON report written to .*r\\.json`));
    expect(JSON.parse(readFileSync(sarif, 'utf8')).version).toBe('2.1.0');
    expect(JSON.parse(readFileSync(out, 'utf8')).schemaVersion).toBe(1);
  });

  it('is redacted like every other output', async () => {
    const out = join(dir, 'r.json');
    const r = await run(['--format', 'markdown', '--fail-on', 'never', '--json-output', out, '--no-config', '--env', `API_TOKEN=${SECRET}`, '--stdio', '--', process.execPath, LEAKY, '--api-key', SECRET]);
    expect(r.code, r.stderr).toBe(0);
    const doc = readFileSync(out, 'utf8');
    expect(doc).toContain('leaky');
    expect(doc).not.toContain(SECRET);
    expect(r.stdout + r.stderr).not.toContain(SECRET);
  });

  it('an unwritable file is exit 2 with the report still printed; an empty path or the --output file is a usage error', async () => {
    const r = await run(['--format', 'text', '--json-output', join(dir, 'no', 'such', 'dir', 'r.json'), ...server]);
    expect(r.code).toBe(2);
    expect(r.stdout).toMatch(/^Score /m);
    expect(r.stderr).toMatch(/error: cannot write --json-output .*r\.json/);
    expect((await run(['--json-output', '', ...server])).stderr).toMatch(/--json-output needs a file path/);
    const same = join(dir, 'x');
    const clash = await run(['--format', 'text', '--output', same, '--save-baseline', same, ...server]);
    expect(clash.code).toBe(2);
    expect(clash.stderr).toMatch(/--save-baseline and --output name the same file/);
  });
});

describe('--save-baseline then --baseline: the baseline loop', () => {
  it('the first run saves every finding; the next run with --baseline passes and marks them baselined', async () => {
    const base = join(dir, 'baseline.json');
    const first = await run(['--fail-on', 'never', '--save-baseline', base, ...server]);
    expect(first.code, first.stderr).toBe(0);
    const saved = JSON.parse(readFileSync(base, 'utf8'));
    expect(saved.findings.length).toBeGreaterThan(0);

    const again = join(dir, 'again.json');
    const second = await run(['--baseline', base, '--json-output', again, ...server]);
    expect(second.code, second.stderr).toBe(0); // every error is known
    const doc = JSON.parse(readFileSync(again, 'utf8'));
    expect(doc.summary.baselined).toBeGreaterThan(0);
    expect(doc.findings.filter((f: any) => f.ruleId !== 'SRV-020').every((f: any) => f.baselined === true)).toBe(true);
    // Without the baseline the same server fails.
    expect((await run(server)).code).toBe(1);
  });

  it('--save-baseline and --json-output together write the same document; the key works in the config file', async () => {
    const a = join(dir, 'a.json');
    const b = join(dir, 'b.json');
    const r = await run(['--fail-on', 'never', '--save-baseline', a, '--json-output', b, ...server]);
    expect(r.code).toBe(0);
    expect(readFileSync(a, 'utf8')).toBe(readFileSync(b, 'utf8'));
    const cfg = join(dir, 'cfg.json');
    writeFileSync(cfg, JSON.stringify({ stdio: process.execPath, args: [BAD], failOn: 'never', saveBaseline: 'from-config.json' }));
    const c = await run(['--config', cfg]);
    expect(c.code, c.stderr).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, 'from-config.json'), 'utf8')).tool.name).toBe('mcp-review-check');
  });
});
