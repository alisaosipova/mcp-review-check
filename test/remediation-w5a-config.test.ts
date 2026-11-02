// Regression tests for the W5A-cli package (wave 5, 0.3.0): the config file. --config <file>, or
// mcp-review-check.config.json / .mcp-review-check.json discovered in --cwd or the working directory, --no-config;
// keys are camelCase long option names, validated like the flags; a flag wins over the file; errors name the file and
// the key and never a value. Unit: loadConfig and findConfig; black box: runCli on the BAD and the leaky stdio fixtures.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import { ConfigError, findConfig, loadConfig } from '../src/config.js';

const BAD = fileURLToPath(new URL('./fixtures/bad-server.mjs', import.meta.url));
const LEAKY = fileURLToPath(new URL('./fixtures/leaky-server.mjs', import.meta.url));
const SECRET = 'sk-live-W5ACONFIGSECRET0001';

let dir = '';
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mrc-w5a-config-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
const file = (name: string, content: unknown) => {
  const p = join(dir, name);
  writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content));
  return p;
};
const run = (args: string[]) => runCli(args, {}, false);
const badServer = { stdio: process.execPath, args: [BAD] };

describe('loadConfig: camelCase keys turned into the values the flags give', () => {
  it('maps each kind: strings, numbers, switches, lists, header and env objects, paths relative to the file', () => {
    const p = file('c.json', {
      target: 'claude', failOn: 'warning', timeout: 60000, maxDuration: '5000', failOnSpec: true, active: false,
      ignore: 'TOOL-013', header: { 'X-Team': 'blue' }, env: ['A=1'], output: 'out/report.md', sarifLocation: 'x/y',
      url: 'https://mcp.example.com/mcp',
    });
    const c = loadConfig(p, true);
    expect(c.options).toEqual({
      target: 'claude', 'fail-on': 'warning', timeout: '60000', 'max-duration': '5000', 'fail-on-spec': true,
      ignore: ['TOOL-013'], header: ['X-Team: blue'], env: ['A=1'], output: join(dir, 'out/report.md'), 'sarif-location': 'x/y',
    });
    expect(c.keys['fail-on']).toBe('failOn');
    expect(c.url).toBe('https://mcp.example.com/mcp');
    expect(c.warnings.join('')).toMatch(/holds header values.*MCP_REVIEW_CHECK_TOKEN/);
    expect(c.warnings.join('')).not.toContain('blue');
  });

  it('the server: stdio as one command line, stdio + args verbatim, or a stdio array', () => {
    expect(loadConfig(file('a.json', { stdio: 'node "my server.js"' }), true)).toMatchObject({ stdio: 'node "my server.js"' });
    expect(loadConfig(file('b.json', { stdio: 'node', args: ['my server.js'] }), true).command).toEqual(['node', 'my server.js']);
    expect(loadConfig(file('c.json', { stdio: ['node', 'a.js'], args: ['--x'] }), true).command).toEqual(['node', 'a.js', '--x']);
  });

  it.each([
    ['an unknown key', { failOnn: SECRET }, /unknown key "failOnn"/],
    ['a kebab-case key', { 'fail-on': SECRET }, /unknown key "fail-on"; did you mean "failOn"\?/],
    ['a wrong type', { timeout: [SECRET] }, /key "timeout" must be a number \(the value is not shown\)/],
    ['a switch that is not a boolean', { active: SECRET }, /key "active" must be true or false/],
    ['an array of numbers for ignore', { ignore: [1] }, /key "ignore" must be a string or an array of strings/],
    ['url and stdio', { url: 'https://a.example/mcp', stdio: 'node s.js' }, /either key "url" or key "stdio"/],
    ['args without stdio', { args: [SECRET] }, /key "args" needs key "stdio"/],
    ['an array', [SECRET], /must contain a JSON object/],
    ['not JSON', `{"bearer": "${SECRET}",`, /is not valid JSON/],
  ])('%s is a ConfigError naming the file and the key, never the value', (_, content, message) => {
    const p = file('bad.json', content);
    let err: unknown;
    try { loadConfig(p, true); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ConfigError);
    expect((err as Error).message).toMatch(message);
    expect((err as Error).message).toContain(`--config ${p}`);
    expect((err as Error).message).not.toContain(SECRET);
  });

  it('findConfig takes mcp-review-check.config.json before .mcp-review-check.json, and nothing in an empty directory', () => {
    expect(findConfig(dir)).toBeUndefined();
    const dot = file('.mcp-review-check.json', {});
    expect(findConfig(dir)).toBe(dot);
    const main = file('mcp-review-check.config.json', {});
    expect(findConfig(dir)).toBe(main);
  });
});

describe('the CLI reads the config file', () => {
  it('discovers it in --cwd: the server, --format and --fail-on come from the file', async () => {
    file('mcp-review-check.config.json', { ...badServer, format: 'json', failOn: 'never', target: 'claude' });
    const r = await run(['--cwd', dir]);
    expect(r.code, r.stderr).toBe(0);
    const doc = JSON.parse(r.stdout);
    expect(doc.target).toBe('claude');
    expect(doc.findings.length).toBeGreaterThan(0);
  });

  it('a flag overrides the file: --fail-on error fails, --format text replaces json; a CLI target replaces the file server', async () => {
    file('.mcp-review-check.json', { url: 'https://unused.example.invalid/mcp', format: 'json', failOn: 'never' });
    const r = await run(['--cwd', dir, '--fail-on', 'error', '--format', 'text', '--stdio', '--', process.execPath, BAD]);
    expect(r.code, r.stderr).toBe(1);
    expect(r.stdout).toMatch(/^Score /m);
  });

  it('a list given on the command line replaces the file list', async () => {
    file('mcp-review-check.config.json', { ...badServer, format: 'json', failOn: 'never', ignore: ['TOOL-002'] });
    const fromFile = JSON.parse((await run(['--cwd', dir])).stdout);
    expect(fromFile.ignored.map((f: any) => f.ruleId)).toContain('TOOL-002');
    const flag = JSON.parse((await run(['--cwd', dir, '--ignore', 'TOOL-006'])).stdout);
    expect(flag.ignored.map((f: any) => f.ruleId)).not.toContain('TOOL-002');
    expect(flag.ignored.map((f: any) => f.ruleId)).toContain('TOOL-006');
  });

  it('--config names a file anywhere; its paths are relative to it', async () => {
    mkdirSync(join(dir, 'conf'));
    const p = file('conf/check.json', { ...badServer, failOn: 'never', format: 'markdown', output: 'report.md' });
    const r = await run(['--config', p]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).toContain(`report written to ${join(dir, 'conf', 'report.md')}`);
    expect(readFileSync(join(dir, 'conf', 'report.md'), 'utf8')).toMatch(/^# /m);
  });

  it('--no-config skips discovery; --config with --no-config and a missing --config file are usage errors', async () => {
    file('mcp-review-check.config.json', { ...badServer });
    const skipped = await run(['--cwd', dir, '--no-config']);
    expect(skipped.code).toBe(2);
    expect(skipped.stderr).toMatch(/give exactly one of <url> or --stdio/);
    expect((await run(['--config', 'x.json', '--no-config', '--stdio', 'node s.js'])).stderr).toMatch(/either --config or --no-config/);
    const missing = await run(['--config', join(dir, 'nope.json'), '--stdio', 'node s.js']);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toMatch(/cannot read --config .*nope\.json: no such file/);
  });

  it('an unknown key is exit 2 naming the key and the file, not the value', async () => {
    const p = file('mcp-review-check.config.json', { ...badServer, bearerToken: SECRET });
    const r = await run(['--cwd', dir]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(`error: config file ${p}: unknown key "bearerToken"`);
    expect(r.stderr).not.toContain(SECRET);
  });

  it('a value the flag would reject is the flag error, with the file and the key and without the value', async () => {
    const p = file('mcp-review-check.config.json', { ...badServer, failOn: SECRET });
    const r = await run(['--cwd', dir]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(`error: --fail-on must be error, warning or never (from ${p}: key "failOn")`);
    expect(r.stderr).not.toContain(SECRET);
    const url = file('u.json', { url: `ftp://user:${SECRET}@host/mcp` });
    const u = await run(['--config', url]);
    expect(u.stderr).toMatch(/URL must use http or https \(from .*u\.json: key "url"\)/);
    expect(u.stderr).not.toContain(SECRET);
  });

  it('bearer in the file warns without the value; with a stdio server it is the --bearer usage error, named', async () => {
    file('mcp-review-check.config.json', { ...badServer, bearer: SECRET });
    const r = await run(['--cwd', dir]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/warning: config file .* holds bearer values: .*\$MCP_REVIEW_CHECK_TOKEN/);
    expect(r.stderr).toMatch(/--bearer and --header apply only to <url> \(from .*: key "bearer"/);
    expect(r.stderr).not.toContain(SECRET);
  });

  it('env values from the file are redacted in the report and the --json-output file like --env values', async () => {
    file('mcp-review-check.config.json', { stdio: process.execPath, args: [LEAKY], env: { API_TOKEN: SECRET }, format: 'json', failOn: 'never', jsonOutput: 'r.json' });
    const r = await run(['--cwd', dir]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain('leaky'); // the server ran and its echo reached the report
    expect(r.stdout + r.stderr).not.toContain(SECRET);
    expect(existsSync(join(dir, 'r.json'))).toBe(true);
    expect(readFileSync(join(dir, 'r.json'), 'utf8')).not.toContain(SECRET);
  });

  it('--help and --list-rules ignore a broken config file', async () => {
    file('mcp-review-check.config.json', '{ broken');
    expect((await run(['--help', '--cwd', dir])).code).toBe(0);
    expect((await run(['--list-rules', 'TOOL-00', '--cwd', dir])).code).toBe(0);
  });
});
