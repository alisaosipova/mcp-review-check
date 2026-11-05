// 1.1.0 Q3, A01-03: a command-line option overrides the config file's opposite or transport-specific key instead of
// failing with exit 2; --no-<switch> exists for every boolean config key; and a warning names a command-line switch
// that the chosen --format does not use (--quiet, --checklist, --diff-only).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatWarnings, OPPOSITES, runCli } from '../src/cli.js';

const GOOD = fileURLToPath(new URL('./fixtures/good-server.mjs', import.meta.url));
const BAD = fileURLToPath(new URL('./fixtures/bad-server.mjs', import.meta.url));
// Token-shaped strings are assembled at runtime so no scanner mistakes the test for a leak.
const FILE_TOKEN = ['sk', 'live', 'SYNTHq3file0000000001'].join('_');
const CLI_TOKEN = ['sk', 'live', 'SYNTHq3cli00000000001'].join('_');
const REFUSED = 'http://127.0.0.1:9/mcp';

let dir = '';
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mrc-q3-config-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
const config = (content: unknown) => {
  const p = join(dir, 'c.json');
  writeFileSync(p, JSON.stringify(content));
  return p;
};
const run = (args: string[]) => runCli(args, {}, false);
const stdioConfig = { stdio: process.execPath, args: [GOOD], env: { API_BASE: 'http://localhost:4000' }, cwd: '.', noLocal: true };

describe('A01-03 the command line overrides the file instead of conflicting with it', () => {
  it('a <url> on the command line does not use the stdio file\'s env and cwd: no exit 2, one note', async () => {
    const r = await run(['--config', config(stdioConfig), REFUSED, '--format', 'json']);
    expect(r.code, r.stderr).toBe(3); // the URL refuses the connection: the run got past validation
    expect(r.stderr).not.toMatch(/apply only to --stdio/);
    expect(r.stderr).toMatch(/not used from .*c\.json: key "env" \(the <url> on the command line is not a --stdio server\), key "cwd"/);
  });

  it('--local on the command line wins over the file\'s noLocal', async () => {
    const r = await run(['--config', config(stdioConfig), '--local', '--format', 'json']);
    expect(r.code, r.stderr).not.toBe(2);
    expect(r.stderr).not.toMatch(/either --local or --no-local/);
    expect(JSON.parse(r.stdout).server.localMode).toBe(true);
  });

  it('--no-local on the command line wins over the file\'s local', async () => {
    const r = await run(['--config', config({ ...stdioConfig, noLocal: undefined, local: true }), '--no-local', '--format', 'json']);
    expect(r.code, r.stderr).not.toBe(2);
    expect(JSON.parse(r.stdout).server.localMode).toBe(false);
  });

  it('both opposites from one source still conflict: the command line, or the file', async () => {
    const cli = await run(['--stdio', `node "${GOOD}"`, '--local', '--no-local', '--no-config']);
    expect(cli.code).toBe(2);
    expect(cli.stderr).toMatch(/give either --local or --no-local, not both/);
    const file = await run(['--config', config({ ...stdioConfig, local: true })]);
    expect(file.code).toBe(2);
    expect(file.stderr).toMatch(/give either --local or --no-local, not both \(from .*key "local", key "noLocal"\)|key "noLocal", key "local"/);
    const quiet = await run(['--stdio', `node "${GOOD}"`, '--quiet', '--no-quiet', '--no-config']);
    expect(quiet.code).toBe(2);
    expect(quiet.stderr).toMatch(/give either --quiet or --no-quiet, not both/);
  });

  it('--bearer replaces the file\'s Authorization header (with a note), and no token is shown', async () => {
    const p = config({ url: REFUSED, header: { Authorization: `Bearer ${FILE_TOKEN}`, 'X-Team': 'q3' } });
    const r = await run(['--config', p, '--bearer', CLI_TOKEN, '--format', 'json']);
    expect(r.code, r.stderr).toBe(3);
    expect(r.stderr).not.toMatch(/either with --bearer or with --header/);
    expect(r.stderr).toMatch(/not used from .*: the Authorization entry of key "header" \(--bearer given\)/);
    for (const out of [r.stdout, r.stderr]) { expect(out).not.toContain(FILE_TOKEN); expect(out).not.toContain(CLI_TOKEN); }
  });

  it('an Authorization --header on the command line replaces the file\'s bearer', async () => {
    const r = await run(['--config', config({ url: REFUSED, bearer: FILE_TOKEN }), '--header', `Authorization: Bearer ${CLI_TOKEN}`, '--format', 'json']);
    expect(r.code, r.stderr).toBe(3);
    expect(r.stderr).toMatch(/not used from .*: key "bearer" \(an Authorization --header given\)/);
    for (const out of [r.stdout, r.stderr]) { expect(out).not.toContain(FILE_TOKEN); expect(out).not.toContain(CLI_TOKEN); }
  });

  it('a --stdio command on the command line does not use the URL file\'s header, bearer and activeAuth', async () => {
    const p = config({ url: REFUSED, header: ['X-Team: q3'], bearer: FILE_TOKEN, activeAuth: true });
    const r = await run(['--config', p, '--stdio', `node "${GOOD}"`, '--format', 'json']);
    expect(r.code, r.stderr).not.toBe(2);
    expect(r.stderr).toMatch(/key "header" \(the --stdio server on the command line is not a <url>\), key "bearer" .*key "activeAuth"/);
    expect(r.stderr).not.toContain(FILE_TOKEN);
  });

  it('the server from the file and --env on the command line for a URL is still a usage error (one source asks for both)', async () => {
    const r = await run(['--config', config({ url: REFUSED }), '--env', 'A=1']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/--env and --cwd apply only to --stdio/);
  });
});

describe('A01-03 --no-<switch> for every boolean config key', () => {
  it('every boolean config key has an opposite switch on the command line', () => {
    const booleans = ['failOnSpec', 'failOnIncomplete', 'failOnDrift', 'diffOnly', 'local', 'noLocal', 'active', 'activeAuth', 'noColor', 'verbose', 'quiet', 'checklist'];
    const flags = new Set(OPPOSITES.flat());
    for (const key of booleans) {
      const opt = key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      const other = OPPOSITES.find((p) => p.includes(opt));
      expect(other, key).toBeDefined();
      expect(flags.has(opt)).toBe(true);
    }
  });

  it('--no-fail-on-spec turns off the file\'s failOnSpec', async () => {
    const p = config({ stdio: process.execPath, args: [BAD], failOnSpec: true });
    const on = JSON.parse((await run(['--config', p, '--format', 'json'])).stdout);
    expect(on.summary.gate.platforms).toContain('spec');
    const off = await run(['--config', p, '--no-fail-on-spec', '--format', 'json']);
    expect(off.code, off.stderr).not.toBe(2);
    expect(JSON.parse(off.stdout).summary.gate.platforms).not.toContain('spec');
  });

  it('--no-quiet turns off the file\'s quiet; --no-checklist its checklist', async () => {
    const p = config({ stdio: process.execPath, args: [GOOD], quiet: true, checklist: true });
    const quiet = await run(['--config', p]);
    expect(quiet.stdout).not.toMatch(/MAN-\d+/); // --quiet drops the checklist even with checklist
    const loud = await run(['--config', p, '--no-quiet', '--no-checklist']);
    expect(loud.code, loud.stderr).not.toBe(2);
    expect(loud.stdout).toMatch(/manual items?: --checklist to show/);
  });

  it('--color and --no-color together are a usage error; each is accepted alone', async () => {
    expect((await run(['--stdio', `node "${GOOD}"`, '--color', '--no-color', '--no-config'])).code).toBe(2);
    expect((await run(['--stdio', `node "${GOOD}"`, '--color', '--no-config'])).code).not.toBe(2);
  });
});

describe('warnings for a switch the chosen --format does not use', () => {
  it('--checklist with --format json and --quiet with --format sarif warn; the run still completes', async () => {
    const json = await run(['--stdio', `node "${GOOD}"`, '--checklist', '--format', 'json', '--no-config']);
    expect(json.code, json.stderr).not.toBe(2);
    expect(json.stderr).toContain('warning: --checklist applies only to --format text; --format json does not use it');
    const sarif = await run(['--stdio', `node "${GOOD}"`, '--quiet', '--format', 'sarif', '--no-config']);
    expect(sarif.stderr).toContain('warning: --quiet applies only to --format text; --format sarif does not use it');
  });

  it('the same keys from a config file get no warning (one file serves several formats)', async () => {
    const r = await run(['--config', config({ stdio: process.execPath, args: [GOOD], quiet: true, checklist: true }), '--format', 'json']);
    expect(r.stderr).not.toMatch(/applies only to --format/);
  });

  it('formatWarnings: --diff-only is used by text, markdown and the GitHub job summary', () => {
    const given = new Set(['diff-only', 'quiet']);
    const values = { 'diff-only': true, quiet: true };
    expect(formatWarnings('text', given, values, {})).toBe('');
    expect(formatWarnings('markdown', given, values, {})).toBe('warning: --quiet applies only to --format text; --format markdown does not use it\n');
    expect(formatWarnings('junit', given, values, {})).toContain('warning: --diff-only applies only to --format text and markdown; --format junit does not use it');
    expect(formatWarnings('junit', given, values, { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: '/x' })).not.toContain('--diff-only');
    expect(formatWarnings('json', new Set(), values, {})).toBe('');
  });
});
