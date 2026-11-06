// Release 1.3.0, block B3 (code scanning and the Action), review round 4:
// - A07-08: the SARIF of a run that failed (no connect, a --max-duration stop, a partial check) says so in
//   runs[0].invocations (executionSuccessful false, exitCode, toolExecutionNotifications), so code scanning does
//   not read the missing results as fixed; a complete run says executionSuccessful true with its exit code.
// - A12-02: the Action passes --target / --fail-on only when its input is set, or when no config file is present,
//   so the project's config file is not silently overridden; a notice names what decided.
// - A12-03: runAutomationDetails.id carries a stable slug per checked server, so two servers in one repository get
//   two code-scanning categories.
// The action script runs in bash with a fake CLI that records its argv (as in r3-p8-pipeline.test.ts).
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import _Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import { buildReport } from '../src/report/index.js';
import { toSarif } from '../src/report/sarif.js';
import { runRules } from '../src/rules/engine.js';
import { manualChecklist, RULES } from '../src/rules/index.js';
import type { Snapshot } from '../src/snapshot.js';
import { loadSnapshot } from './helpers.js';

const root = new URL('../', import.meta.url);
const fixture = (n: string) => fileURLToPath(new URL(`./fixtures/${n}`, import.meta.url));
const GOOD = `node ${fixture('good-server.mjs')}`;
const BAD = `node ${fixture('bad-server.mjs')}`;
const ENV = { ...process.env, MCP_REVIEW_CHECK_NO_CTA: '1', GITHUB_ACTIONS: '', GITHUB_STEP_SUMMARY: '' };

function schemaValidator(): any {
  const schema = JSON.parse(readFileSync(new URL('./fixtures/sarif-schema-2.1.0.json', import.meta.url), 'utf8'));
  delete schema.$schema;
  schema.$id = schema.id;
  delete schema.id;
  const Ajv = ((_Ajv as unknown as { default?: unknown }).default ?? _Ajv) as new (o: object) => any;
  const ajv = new Ajv({ strict: false, allErrors: true });
  ajv.addFormat('uri', (x: string) => /^[a-z][a-z0-9+.-]*:[^\s<>"{}|\\^`]*$/i.test(x) && !/[^\x21-\x7e]/.test(x));
  ajv.addFormat('uri-reference', (x: string) => !/[^\x21-\x7e]/.test(x) && !/[<>"{}|\\^`]/.test(x));
  ajv.addFormat('date-time', (x: string) => !Number.isNaN(Date.parse(x)));
  return ajv.compile(schema);
}
const validate = schemaValidator();
const valid = (doc: unknown) => { const ok = validate(doc); expect(validate.errors ?? []).toEqual([]); expect(ok).toBe(true); };

async function sarif(args: string[]): Promise<{ code: number; doc: any }> {
  const r = await runCli(['--no-config', '--format', 'sarif', ...args], ENV, false);
  return { code: r.code, doc: JSON.parse(r.stdout) };
}

describe('A07-08: SARIF invocations say whether the analysis completed', () => {
  it('a failed connect (exit 3): executionSuccessful false, exitCode 3, a notification with the cause; valid SARIF', async () => {
    const { code, doc } = await sarif(['--timeout', '2000', 'http://127.0.0.1:9/mcp']);
    expect(code).toBe(3);
    const inv = doc.runs[0].invocations;
    expect(inv).toHaveLength(1);
    expect(inv[0].executionSuccessful).toBe(false);
    expect(inv[0].exitCode).toBe(3);
    expect(inv[0].toolExecutionNotifications[0].level).toBe('error');
    expect(inv[0].toolExecutionNotifications[0].message.text).toMatch(/^the server could not be checked: /);
    valid(doc);
  });

  it('a --max-duration stop (exit 4): executionSuccessful false, exitCode 4, the stop named', async () => {
    const { code, doc } = await sarif(['--max-duration', '1500', '--stdio', `node ${fixture('hang-server.mjs')}`]);
    expect(code).toBe(4);
    const inv = doc.runs[0].invocations[0];
    expect(inv.executionSuccessful).toBe(false);
    expect(inv.exitCode).toBe(4);
    expect(inv.toolExecutionNotifications.map((n: any) => n.message.text).join('\n')).toMatch(/stopped by --max-duration \(1500 ms\) during /);
    valid(doc);
  }, 30000);

  it('a complete run: executionSuccessful true with the exit code, also exit 1 (a finding is not a failed run), and no notification', async () => {
    const good = await sarif(['--stdio', GOOD]);
    expect(good.code).toBe(0);
    expect(good.doc.runs[0].invocations).toEqual([{ executionSuccessful: true, exitCode: 0 }]);
    const bad = await sarif(['--stdio', BAD]);
    expect(bad.code).toBe(1);
    expect(bad.doc.runs[0].invocations).toEqual([{ executionSuccessful: true, exitCode: 1 }]);
    valid(bad.doc);
  }, 30000);

  it('a partial check (no token, exit 0 below --fail-on) is not a successful execution; the reason is named', () => {
    const s: Snapshot = loadSnapshot('minimal-http');
    s.coverage = { toolLevel: 'auth-required', reason: 'the server answered 401 without a token' };
    const doc = toSarif(buildReport(s, runRules(s, RULES), manualChecklist(s), 'error', new Date('2026-11-06T10:00:00Z'), 10), undefined, { exitCode: 0 });
    const inv = (doc.runs as any[])[0].invocations[0];
    expect(inv.executionSuccessful).toBe(false);
    expect(inv.exitCode).toBe(0);
    expect(inv.toolExecutionNotifications[0].message.text).toBe('partial check (auth-required): the server answered 401 without a token; tool checks were skipped');
    valid(doc);
  });

  it('with --baseline the SARIF carries the invocation too', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'r130-b3-base-'));
    try {
      const base = join(dir, 'b.json');
      expect((await runCli(['--no-config', '--fail-on', 'never', '--save-baseline', base, '--stdio', BAD], ENV, false)).code).toBe(0);
      const { code, doc } = await sarif(['--baseline', base, '--stdio', BAD]);
      expect(code).toBe(0);
      expect(doc.runs[0].invocations).toEqual([{ executionSuccessful: true, exitCode: 0 }]);
      expect(doc.runs[0].results.every((r: any) => r.baselineState === 'unchanged')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);
});

describe('A12-03: one code-scanning category per checked server', () => {
  const category = (doc: any) => String(doc.runs[0].automationDetails.id).replace(/[^/]*$/, '');
  const http = (url: string) => {
    const s: Snapshot = loadSnapshot('minimal-http');
    s.target = { kind: 'http', urlAsEntered: url, url: new URL(url) };
    return toSarif(buildReport(s, runRules(s, RULES), manualChecklist(s), 'error', new Date(), 10));
  };

  it('two servers get two categories; one server keeps its category from run to run', async () => {
    const a1 = http('https://a.example.test/mcp');
    const a2 = http('https://a.example.test/mcp');
    const b = http('https://b.example.test/mcp');
    expect(category(a1)).toBe(category(a2));
    expect(category(a1)).not.toBe(category(b));
    expect(category(a1)).toMatch(/^mcp-review-check\/\.mcp-review-check\/a\.example\.test-mcp-[0-9a-f]{8}\/$/);
    const good = await sarif(['--stdio', GOOD]);
    const good2 = await sarif(['--stdio', GOOD]);
    const bad = await sarif(['--stdio', BAD]);
    expect(category(good.doc)).toBe(category(good2.doc));
    expect(category(good.doc)).not.toBe(category(bad.doc));
    expect(category(good.doc)).toMatch(/^mcp-review-check\/\.mcp-review-check\/stdio-node-[a-z0-9._-]+-[0-9a-f]{8}\/$/);
  }, 30000);

  it('the slug holds no credential, query or secret, and the id stays valid SARIF', () => {
    const doc = http('https://user:SYNTH-pw-b3@a.example.test/mcp?api_key=SYNTH-key-b3&x=1');
    const id = String((doc.runs as any[])[0].automationDetails.id);
    expect(id).not.toMatch(/SYNTH|user|api_key/);
    expect(id.split('/')).toHaveLength(4);
    valid(doc);
  });
});

/** The body of the run step's `run: |` block in action.yml, dedented. */
function actionScript(): string {
  const lines = readFileSync(new URL('action.yml', root), 'utf8').split(/\r?\n/);
  const start = lines.findIndex((l) => /^ +run: \|$/.test(l));
  const indent = lines[start]!.search(/\S/) + 2;
  const body: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (l.trim() && l.search(/\S/) < indent) break;
    body.push(l.slice(indent));
  }
  return body.join('\n');
}

describe.skipIf(process.platform === 'win32')('A12-02: the Action does not override the config file with its defaults', () => {
  /** Runs the step in a fresh workspace (`files` written there) with a fake CLI; returns its argv and the log. */
  const run = (inputs: Record<string, string>, files: Record<string, string> = {}, cli?: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'r130-b3-action-'));
    try {
      const ws = join(dir, 'ws');
      mkdirSync(ws);
      for (const [name, text] of Object.entries(files)) { mkdirSync(join(ws, name, '..'), { recursive: true }); writeFileSync(join(ws, name), text); }
      const out = join(dir, 'out');
      writeFileSync(out, '');
      const log = join(dir, 'argv.json');
      const fake = join(dir, 'fake-cli.mjs');
      writeFileSync(fake, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)));`);
      const r = spawnSync('bash', ['-c', actionScript()], {
        cwd: ws, encoding: 'utf8', timeout: 60000,
        env: {
          PATH: process.env.PATH, HOME: process.env.HOME, GITHUB_OUTPUT: out, GITHUB_ACTIONS: 'true', RUNNER_TEMP: dir, MCP_REVIEW_CHECK_NO_CTA: '1',
          INPUT_TARGET: '', INPUT_STDIO: 'node x.mjs', INPUT_PLATFORM: '', INPUT_FAIL_ON: '', INPUT_FAIL_ON_SPEC: 'false', INPUT_ACTIVE: 'false',
          INPUT_BEARER: '', INPUT_VERSION: '1.3', INPUT_CLI_PATH: cli ?? fake, INPUT_SARIF_FILE: join(dir, 'r.sarif'), INPUT_EXTRA_ARGS: '', ...inputs,
        },
      });
      let argv: string[] = [];
      try { argv = JSON.parse(readFileSync(log, 'utf8')); } catch { /* the real CLI ran */ }
      const outputs = Object.fromEntries(readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => l.split(/=(.*)/s).slice(0, 2)));
      const report = outputs['report-json'] ? JSON.parse(readFileSync(outputs['report-json'], 'utf8')) : undefined;
      return { code: r.status, log: r.stdout + r.stderr, argv, report };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const opt = (argv: string[], name: string) => { const i = argv.lastIndexOf(name); return i < 0 ? undefined : argv[i + 1]; };
  const CFG = JSON.stringify({ target: 'claude', failOn: 'warning' });

  it('declares platform and fail-on with an empty default, documented as "config file, else all / error"', () => {
    const action = readFileSync(new URL('action.yml', root), 'utf8');
    for (const [input, key, dflt] of [['platform', 'target', 'all'], ['fail-on', 'failOn', 'error']]) {
      const m = new RegExp(`^ {2}${input}:\\n {4}description: (.*)\\n {4}required: false\\n {4}default: (.*)$`, 'm').exec(action);
      expect(m?.[2], input).toBe("''");
      expect(m?.[1], input).toContain(`the config file''s \`${key}\``);
      expect(m?.[1], input).toContain(`else ${dflt}`);
    }
  });

  it('a discovered config file and empty inputs: no --target / --fail-on, and a notice; without a file the old defaults', () => {
    const withFile = run({}, { 'mcp-review-check.config.json': CFG });
    expect(withFile.code, withFile.log).toBe(0);
    expect(withFile.argv).not.toContain('--target');
    expect(withFile.argv).not.toContain('--fail-on');
    expect(withFile.log).toMatch(/^::notice title=mcp-review-check::the config file decides --target and --fail-on /m);
    const dotFile = run({}, { '.mcp-review-check.json': CFG });
    expect(dotFile.argv).not.toContain('--target');
    const none = run({});
    expect(none.code, none.log).toBe(0);
    expect([opt(none.argv, '--target'), opt(none.argv, '--fail-on')]).toEqual(['all', 'error']);
    expect(none.log).not.toContain('::notice');
  });

  it('a set input always wins over the file, without a notice; "both" is still all', () => {
    const set = run({ INPUT_PLATFORM: 'both', INPUT_FAIL_ON: 'never' }, { 'mcp-review-check.config.json': CFG });
    expect([opt(set.argv, '--target'), opt(set.argv, '--fail-on')]).toEqual(['all', 'never']);
    expect(set.log).not.toContain('::notice');
    const one = run({ INPUT_FAIL_ON: 'warning' }, { 'mcp-review-check.config.json': CFG });
    expect(one.argv).not.toContain('--target');
    expect(opt(one.argv, '--fail-on')).toBe('warning');
    expect(one.log).toMatch(/::notice title=mcp-review-check::the config file decides --target \(/);
  });

  it('--config, --cwd and --no-config in extra-args decide which file counts; --target in extra-args is not named in the notice', () => {
    const named = run({ INPUT_EXTRA_ARGS: '--config conf/x.json' }, { 'conf/x.json': CFG });
    expect(named.argv).not.toContain('--fail-on');
    expect(named.log).toContain('::notice');
    const eq = run({ INPUT_EXTRA_ARGS: '--config=conf/x.json --target claude' }, { 'conf/x.json': CFG });
    expect(eq.argv.filter((a) => a === '--target')).toHaveLength(1);
    expect(eq.log).toMatch(/::notice title=mcp-review-check::the config file decides --fail-on \(/);
    const cwd = run({ INPUT_EXTRA_ARGS: '--cwd srv' }, { 'srv/mcp-review-check.config.json': CFG });
    expect(cwd.argv).not.toContain('--fail-on');
    const off = run({ INPUT_EXTRA_ARGS: '--no-config' }, { 'mcp-review-check.config.json': CFG });
    expect([opt(off.argv, '--target'), opt(off.argv, '--fail-on')]).toEqual(['all', 'error']);
    expect(off.log).not.toContain('::notice');
  });

  const cliPath = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  it('with the built CLI, the file\'s target and failOn gate the run (A12-02 repro)', () => {
    // bad-server has errors: under the old defaults (--fail-on error) this run exited 1 and gated claude and chatgpt.
    const r = run({ INPUT_STDIO: BAD }, { 'mcp-review-check.config.json': JSON.stringify({ target: 'claude', failOn: 'never' }) }, cliPath);
    expect(r.code, r.log).toBe(0);
    expect(r.report.summary.gate.platforms).toEqual(['claude']);
    expect(r.report.summary.failed).toBe(false);
  }, 60000);
});
