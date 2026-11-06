// Review round 4, package P1 (1.2.0): CLI, config and outputs. A01-02, A01-03 (no baseline from a failed run), A01-04
// (listing-only and --fail-on-drift), A01-06 (NUL in a config value), A07-01 (listing warning line), A12-04 (parent
// directory created), A12-08 (warnings for typed options only), C-05 (an option and its value in one word), I-A01-2,
// I-A01-3 (no output over an input), I-A01-5 (UTF-16BE), I-A10-1 (writability checked before connecting), I-A10-3
// (did you mean for values), I-A10-6 (a shorter --help).
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import { ConfigError, loadConfig } from '../src/config.js';
import { startAuthServer } from './fixtures/auth-server.js';
import type { Started } from './fixtures/http-bridge.js';

const GOOD = fileURLToPath(new URL('./fixtures/good-server.mjs', import.meta.url));
const HANG = fileURLToPath(new URL('./fixtures/hang-server.mjs', import.meta.url));
const LISTING = fileURLToPath(new URL('./fixtures/listing/', import.meta.url));
const good = ['--stdio', '--', process.execPath, GOOD];

let dir: string;
const at = (name: string) => join(dir, name);
const run = (args: string[], env: NodeJS.ProcessEnv = {}) => runCli(args, env, false);
/** Lines that a GitHub runner would read as a workflow command. */
const commandLines = (stderr: string) => stderr.split('\n').filter((l) => /^\s*::/.test(l) || l.includes('##['));

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mrc-r111-p1-')); });
afterEach(() => {
  try { chmodSync(dir, 0o700); } catch { /* gone */ }
  rmSync(dir, { recursive: true, force: true });
});

/** A good-server baseline at `path`, written by a passing run. */
async function saveBaseline(path: string): Promise<string> {
  const r = await run(['--no-config', '--fail-on', 'never', '--save-baseline', path, ...good]);
  expect(r.code, r.stderr).toBe(0);
  return readFileSync(path, 'utf8');
}

describe('A01-02: a fatal or stopped run writes no output over the baseline', () => {
  it('A01-02 a stopped run with --json-output equal to --baseline leaves the baseline byte-identical', async () => {
    const b = at('b.json');
    const before = await saveBaseline(b);
    const r = await run(['--no-config', '--baseline', b, '--json-output', b, '--max-duration', '1500', '--timeout', '20000', '--stdio', '--', process.execPath, HANG]);
    expect(r.code, r.stderr).toBe(4);
    expect(readFileSync(b, 'utf8')).toBe(before);
    expect(r.stderr).toContain('warning: --json-output not written: the run was stopped by --max-duration; it names the baseline file, and the earlier baseline, if any, is kept');
    expect(r.stderr).not.toMatch(/JSON report written to/);
  }, 30000);

  it('A01-02 a fatal run with --format json --output equal to --baseline keeps it and prints the report', async () => {
    const b = at('b.json');
    const before = await saveBaseline(b);
    const r = await run(['--no-config', '--baseline', b, '--format', 'json', '--output', b, '--stdio', '--', process.execPath, '-e', 'process.exit(1)']);
    expect(r.code).toBe(3);
    expect(readFileSync(b, 'utf8')).toBe(before);
    expect(JSON.parse(r.stdout).coverage.toolLevel).toBe('connect-failed');
    expect(r.stderr).toContain('warning: --output not written: the run did not connect');
  });

  it('A01-02 --save-baseline and --json-output on one file: neither is written, and the message is true', async () => {
    const b = at('b3.json');
    const before = await saveBaseline(b);
    const r = await run(['--no-config', '--baseline', b, '--save-baseline', b, '--json-output', b, '--stdio', '--', process.execPath, '-e', 'process.exit(1)']);
    expect(r.code).toBe(3);
    expect(readFileSync(b, 'utf8')).toBe(before);
    expect(r.stderr).not.toMatch(/JSON report written to/);
  });

  it('A01-02 negative: --json-output to another file is still written by a fatal run, and a good run refreshes the baseline', async () => {
    const b = at('b.json');
    await saveBaseline(b);
    const r = await run(['--no-config', '--baseline', b, '--json-output', at('j.json'), '--stdio', '--', process.execPath, '-e', 'process.exit(1)']);
    expect(r.code).toBe(3);
    expect(JSON.parse(readFileSync(at('j.json'), 'utf8')).toolFingerprints).toBeNull();
    const ok = await run(['--no-config', '--baseline', b, '--format', 'json', '--output', b, ...good]);
    expect(ok.code, ok.stderr).toBe(0);
    expect(ok.stderr).not.toMatch(/not written/);
  });
});

describe('A01-03: no baseline from a partial run under --fail-on-incomplete', () => {
  let s: Started;
  beforeEach(async () => { s = await startAuthServer(); });
  afterEach(async () => { await s.close(); });

  it('A01-03 auth required with --fail-on-incomplete and --save-baseline: exit 3, no baseline created', async () => {
    const b = at('b2.json');
    const r = await run(['--no-config', s.url, '--fail-on-incomplete', '--save-baseline', b, '--timeout', '5000']);
    expect(r.code).toBe(3);
    expect(existsSync(b)).toBe(false);
    expect(r.stderr).toContain('warning: --save-baseline not written: the check is partial (auth-required) and --fail-on-incomplete is set');
  });

  it('A01-03 negative: without --fail-on-incomplete the partial baseline is written, with its warning', async () => {
    const b = at('b2.json');
    const r = await run(['--no-config', s.url, '--save-baseline', b, '--timeout', '5000']);
    expect(r.code).not.toBe(3);
    expect(existsSync(b)).toBe(true);
    expect(r.stderr).toMatch(/warning: --save-baseline: the check is partial \(auth-required\)/);
  });
});

describe('A01-04: a listing-only run and --fail-on-drift', () => {
  const plugin = join(LISTING, 'plugin-valid');

  it('A01-04 --fail-on-drift on the command line is a usage error in a listing-only run', async () => {
    const b = at('b.json');
    await saveBaseline(b);
    const r = await run(['--no-config', '--plugin-dir', plugin, '--baseline', b, '--fail-on-drift']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('error: --fail-on-drift needs a <url> or --stdio target; a listing-only run lists no tools');
  });

  it('A01-04 failOnDrift from a config file is dropped with a note in a listing-only run, and kept for a server run', async () => {
    const b = at('b.json');
    await saveBaseline(b);
    const c = at('c.json');
    writeFileSync(c, JSON.stringify({ baseline: b, failOnDrift: true }));
    const r = await run(['--config', c, '--plugin-dir', plugin]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).toContain('key "failOnDrift" (a listing-only run lists no tools)');
    expect(r.stderr).not.toMatch(/--fail-on-drift: tool definitions not compared/);
    // A server run with the same file still compares (no change: exit 0, no note about failOnDrift).
    const s = await run(['--config', c, ...good]);
    expect(s.code, s.stderr).toBe(0);
    expect(s.stderr).not.toContain('key "failOnDrift"');
  });

  it('A01-04 a listing-only baseline is named as such for a server run', async () => {
    const bl = at('bl.json');
    expect((await run(['--no-config', '--plugin-dir', plugin, '--save-baseline', bl])).code).toBe(0);
    const r = await run(['--no-config', '--baseline', bl, '--fail-on-drift', '--fail-on', 'never', ...good]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('the baseline is a listing-only report (no server was checked)');
    expect(r.stderr).not.toContain('the baseline run did not list every tool');
  });
});

describe('A01-06: a NUL character in a config value', () => {
  const secret = 'S3cr\u0000etTokenValue123';
  it('A01-06 a NUL in bearer and in cwd is exit 2, and the message does not show the value', async () => {
    for (const [key, cfg] of [['bearer', { url: 'http://127.0.0.1:9/mcp', bearer: secret }], ['cwd', { stdio: 'node x.mjs', cwd: 'a\u0000b' }]] as const) {
      const c = at(`${key}.json`);
      writeFileSync(c, JSON.stringify(cfg));
      const r = await run(['--config', c]);
      expect(r.code, key).toBe(2);
      expect(r.stderr).toContain(`key "${key}" must not contain a NUL character (the value is not shown)`);
      expect(r.stderr).not.toMatch(/S3cr|etTokenValue|fatal:/);
    }
  });

  it('A01-06 also a NUL in a stdio argument, an env value and an env name; a clean file loads', () => {
    for (const doc of [{ stdio: ['node', `--api-key=${secret}`] }, { stdio: 'node', args: [secret] }, { env: { K: secret } }, { env: { [secret]: 'v' } }, { header: [`X: ${secret}`] }]) {
      const c = at('c.json');
      writeFileSync(c, JSON.stringify(doc));
      expect(() => loadConfig(c, true)).toThrow(ConfigError);
      try { loadConfig(c, true); } catch (e) { expect((e as Error).message).not.toContain('etTokenValue'); }
    }
    writeFileSync(at('ok.json'), JSON.stringify({ env: { K: 'v' }, stdio: 'node x.mjs' }));
    expect(loadConfig(at('ok.json'), true).options.env).toEqual(['K=v']);
  });
});

describe('A07-01: the listing warning line', () => {
  it('A07-01 a manifest whose mcpServers holds a newline and ::error starts no workflow command on stderr', async () => {
    const pkg = at('pkg');
    cpSync(join(LISTING, 'openai-valid'), pkg, { recursive: true });
    const manifest = JSON.parse(readFileSync(join(pkg, 'plugin.json'), 'utf8'));
    manifest.mcpServers = './x\u001b[31mRED\n::error title=Injected::forged annotation\n##[error]legacy';
    writeFileSync(join(pkg, 'plugin.json'), JSON.stringify(manifest));
    const r = await run(['--no-config', '--format', 'json', '--openai-manifest', join(pkg, 'plugin.json')], { GITHUB_ACTIONS: 'true' });
    const warning = r.stderr.split('\n').find((l) => l.startsWith('warning: --openai-manifest'));
    expect(warning).toBeDefined();
    expect(warning).toContain('\\u{A}');
    expect(r.stderr).not.toContain('\x1b');
    expect(commandLines(r.stderr).filter((l) => !/^::(error|warning|notice) title=(LST|mcp-review-check)/.test(l))).toEqual([]);
  });
});

describe('A12-04: the parent directory of an output is created', () => {
  it('A12-04 the documented first-baseline command in an empty repository exits 0 and writes .mcp-review-check/baseline.json', async () => {
    const b = join(dir, '.mcp-review-check', 'baseline.json');
    const r = await run(['--no-config', '--target', 'claude', '--fail-on', 'never', '--save-baseline', b, ...good]);
    expect(r.code, r.stderr).toBe(0);
    expect(JSON.parse(readFileSync(b, 'utf8')).tool.name).toBe('mcp-review-check');
  });

  it('A12-04 --output and --json-output in new folders too', async () => {
    const r = await run(['--no-config', '--format', 'sarif', '--output', at('reports/x.sarif'), '--json-output', at('out/deep/r.json'), ...good]);
    expect(r.code, r.stderr).toBe(0);
    expect(JSON.parse(readFileSync(at('reports/x.sarif'), 'utf8')).version).toBe('2.1.0');
    expect(existsSync(at('out/deep/r.json'))).toBe(true);
  });
});

describe('A12-08: --sarif-location and --tool-args warnings only for options typed on the command line', () => {
  it('A12-08 a config file with sarifLocation and --format text prints no warning; the flag does', async () => {
    const c = at('c.json');
    writeFileSync(c, JSON.stringify({ sarifLocation: 'servers/a', quiet: true }));
    const r = await run(['--config', c, '--format', 'json', ...good]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).not.toMatch(/--sarif-location applies only/);
    const flag = await run(['--no-config', '--sarif-location', 'servers/a', '--format', 'json', ...good]);
    expect(flag.stderr).toContain('warning: --sarif-location applies only to --format sarif');
  });

  it('A12-08 toolArgs from a config file without --active prints no warning; --tool-args typed does', async () => {
    writeFileSync(at('args.json'), '{"search": {"q": "x"}}');
    const c = at('c.json');
    writeFileSync(c, JSON.stringify({ toolArgs: 'args.json' }));
    const r = await run(['--config', c, '--format', 'json', ...good]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).not.toMatch(/--tool-args has no effect/);
    const flag = await run(['--no-config', '--tool-args', at('args.json'), '--format', 'json', ...good]);
    expect(flag.stderr).toContain('warning: --tool-args has no effect without --active');
  });
});

describe('C-05: an option and its value in one argument', () => {
  it('C-05 "--stdio node x.mjs" as one word says how to split it, never "did you mean --stdio"', async () => {
    const r = await run(['--stdio node x.mjs']);
    expect(r.code).toBe(2);
    expect(r.stderr).toBe('error: --stdio and its value were passed as one argument; pass two arguments or write --stdio=<value>\nRun with --help for usage.\n');
    expect(r.stderr).not.toContain('x.mjs');
    const sw = await run(['--quiet --no-quiet', '--list-rules']);
    expect(sw.stderr).toContain('error: --quiet and the text after it were passed as one argument');
    expect(sw.stderr).not.toMatch(/did you mean --quiet\?/);
    // negative: a real typo still gets its suggestion
    expect((await run(['--formt', 'json', '--list-rules'])).stderr).toMatch(/unknown option --formt; did you mean --format\?/);
  });
});

describe('I-A01-2: a config file\'s server replaced by the command line is named', () => {
  it('I-A01-2 stderr names key "url" when the command line gives a server', async () => {
    const c = at('c.json');
    writeFileSync(c, JSON.stringify({ url: 'http://127.0.0.1:9/mcp', failOn: 'never' }));
    const r = await run(['--config', c, ...good]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).toContain('key "url" (a server is given on the command line)');
    writeFileSync(c, JSON.stringify({ stdio: 'node x.mjs' }));
    expect((await run(['--config', c, ...good])).stderr).toContain('key "stdio" (a server is given on the command line)');
    // negative: the file's own server gives no such note
    writeFileSync(c, JSON.stringify({ stdio: [process.execPath, GOOD] }));
    expect((await run(['--config', c])).stderr).not.toContain('a server is given on the command line');
  });
});

describe('I-A01-3: no output overwrites an input', () => {
  it('I-A01-3 --output equal to the --config file is exit 2 and leaves the file unchanged', async () => {
    const c = at('c.json');
    const text = JSON.stringify({ stdio: [process.execPath, GOOD] });
    writeFileSync(c, text);
    const r = await run(['--config', c, '--output', c]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('--output and --config name the same file');
    expect(readFileSync(c, 'utf8')).toBe(text);
  });

  it('I-A01-3 --json-output over --tool-args, --save-baseline over the manifest, --output over a plugin README', async () => {
    writeFileSync(at('args.json'), '{}');
    expect((await run(['--no-config', '--tool-args', at('args.json'), '--json-output', at('args.json'), ...good])).stderr).toContain('--json-output and --tool-args name the same file');
    const pkg = at('pkg');
    cpSync(join(LISTING, 'openai-valid'), pkg, { recursive: true });
    expect((await run(['--no-config', '--openai-manifest', join(pkg, 'plugin.json'), '--save-baseline', join(pkg, 'plugin.json'), ...good])).stderr).toContain('--save-baseline and --openai-manifest name the same file');
    const plugin = at('plugin');
    cpSync(join(LISTING, 'plugin-valid'), plugin, { recursive: true });
    writeFileSync(join(plugin, 'README.md'), '# readme');
    const r = await run(['--no-config', '--plugin-dir', plugin, '--format', 'markdown', '--output', join(plugin, 'README.md')]);
    expect(r.code).toBe(2);
    expect(readFileSync(join(plugin, 'README.md'), 'utf8')).toBe('# readme');
    // negative: another file in the plugin folder is fine
    expect((await run(['--no-config', '--plugin-dir', plugin, '--output', join(plugin, 'report.md')])).code).toBe(0);
  });

  it('I-A01-3 --output equal to $GITHUB_STEP_SUMMARY exits 0 and writes the report once', async () => {
    const summary = at('summary.md');
    writeFileSync(summary, '');
    const r = await run(['--no-config', '--format', 'markdown', '--output', summary, ...good], { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summary });
    expect(r.code, r.stderr).toBe(0);
    const md = readFileSync(summary, 'utf8');
    expect(md.match(/^mcp-review-check \d+\.\d+\.\d+ \u00b7 rules /gm)?.length).toBe(1);
    expect(r.stderr).toContain('the report is not appended to $GITHUB_STEP_SUMMARY, as --output writes that file');
  });
});

describe('I-A01-5: UTF-16BE with a BOM', () => {
  it('I-A01-5 an FE FF config file loads; so does an FE FF --tool-args file', async () => {
    const be = (text: string) => Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(text, 'utf16le').swap16()]);
    writeFileSync(at('c.json'), be('{"failOn": "warning", "ignore": ["TOOL-011"]}'));
    const cfg = loadConfig(at('c.json'), true);
    expect(cfg.options['fail-on']).toBe('warning');
    expect(cfg.options.ignore).toEqual(['TOOL-011']);
    writeFileSync(at('args.json'), be('{"search": {"q": "\u00fc"}}'));
    const r = await run(['--no-config', '--tool-args', at('args.json'), '--format', 'json', ...good]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).not.toMatch(/cannot read --tool-args/);
  });
});

describe('I-A10-1: output paths are checked before connecting', () => {
  /** A stdio "server" that leaves a marker file when it is started. */
  const marker = () => at('started');
  const server = () => ['--stdio', '--', process.execPath, '-e', `require("fs").writeFileSync(${JSON.stringify(marker())}, "x")`];

  it('I-A10-1 a directory path through a file gives exit 2 and no server process is started', async () => {
    writeFileSync(at('file'), 'x');
    for (const flag of ['--output', '--json-output', '--save-baseline']) {
      const r = await run(['--no-config', flag, at('file/r.json'), ...server()]);
      expect(r.code, flag).toBe(2);
      expect(r.stderr).toContain(`cannot write ${flag} `);
      expect(r.stderr).toContain('(checked before connecting; no report was written)');
      expect(r.stdout).toBe('');
    }
    expect(existsSync(marker())).toBe(false);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('I-A10-1 an unwritable directory gives exit 2 and no server process is started', async () => {
    const ro = at('ro');
    mkdirSync(ro);
    chmodSync(ro, 0o500);
    const r = await run(['--no-config', '--output', join(ro, 'sub', 'r.txt'), ...server()]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('its directory is not writable');
    expect(existsSync(marker())).toBe(false);
    chmodSync(ro, 0o700);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('I-A10-1 an existing writable file in a read-only directory, and /dev/null, are accepted', async () => {
    const ro = at('ro2');
    mkdirSync(ro);
    writeFileSync(join(ro, 'r.json'), '');
    chmodSync(ro, 0o500);
    const r = await run(['--no-config', '--json-output', join(ro, 'r.json'), '--output', '/dev/null', '--stdio', '--', process.execPath, GOOD]);
    chmodSync(ro, 0o700);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).not.toMatch(/cannot write/);
  });

  it('I-A10-1 an output that is a directory is refused; a writable new folder is not', async () => {
    mkdirSync(at('d'));
    expect((await run(['--no-config', '--output', at('d'), ...good])).stderr).toContain('it is a directory');
    expect((await run(['--no-config', '--output', at('new/r.txt'), ...good])).code).toBe(0);
  });
});

describe('I-A10-3: did you mean for enumerated values', () => {
  it('I-A10-3 --format jsn, --target claud and --fail-on warnings get a suggestion; a far value none', async () => {
    expect((await run(['--format', 'jsn', ...good])).stderr).toContain('error: --format must be text, json, markdown, sarif or junit; did you mean json?');
    expect((await run(['--target', 'claud', ...good])).stderr).toContain('error: --target must be claude, chatgpt or all; did you mean claude?');
    expect((await run(['--fail-on', 'warnings', ...good])).stderr).toContain('error: --fail-on must be error, warning or never; did you mean warning?');
    const far = await run(['--format', 'S3cretValueX', ...good]);
    expect(far.stderr).not.toMatch(/did you mean/);
    expect(far.stderr).not.toContain('S3cretValueX');
  });
});

describe('I-A10-6: a shorter --help', () => {
  it('I-A10-6 --help lists --stdio under Options, folds the --no-* switches and is at most 90 lines', async () => {
    const help = (await run(['--help'])).stdout;
    expect(help.split('\n').length).toBeLessThanOrEqual(90);
    const options = help.match(/^Options:\n([\s\S]*?)\n\n/m)?.[1] ?? '';
    expect(options).toMatch(/^ {2}--stdio "<command>" +\S/m);
    expect(options).toMatch(/^ {2}--no-<switch> +Turn off a config file's switch: fail-on-spec, fail-on-incomplete, fail-on-drift, diff-only,/m);
    expect(options).not.toMatch(/^ {2}--no-quiet/m);
  });
});

describe('I-A02-3 handoff: --verbose names the proxy route', () => {
  it('prints one proxy: line without credentials', async () => {
    const pass = ['SYNTH', 'proxy', 'secret'].join('-');
    const r = await run(['--no-config', '--verbose', '--timeout', '2000', 'http://127.0.0.1:9/mcp'], { HTTP_PROXY: `http://user:${pass}@127.0.0.1:9` });
    const lines = r.stderr.split('\n').filter((l) => l.startsWith('proxy: '));
    expect(lines).toEqual(['proxy: http://127.0.0.1:9/ via HTTP_PROXY (plain forwarding)']);
    expect(r.stderr).not.toContain(pass);
  });
});
