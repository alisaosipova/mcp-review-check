// W4D: the composite GitHub Action (action.yml, F168), the workflows' supply-chain guards (F145, F159) and the
// coverage thresholds (F156). No YAML parser is a dependency, so the files are read as text with the small helpers
// below; they rely on the two-space indentation the files use.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import config from '../vitest.config.js';

const root = new URL('../', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), 'utf8');
const ACTION = read('action.yml');
const WORKFLOWS = readdirSync(new URL('.github/workflows/', root)).filter((f) => f.endsWith('.yml'));

/** Keys one level below the top-level key `name:` (indented by two spaces). */
function childKeys(text: string, name: string): string[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l === `${name}:`);
  if (start < 0) return [];
  const keys: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (/^\S/.test(l)) break; // next top-level key
    const m = /^ {2}([A-Za-z0-9_-]+):/.exec(l);
    if (m) keys.push(m[1]!);
  }
  return keys;
}

/** The body of the first `run: |` block in action.yml, dedented. */
function actionScript(): string {
  const lines = ACTION.split(/\r?\n/);
  const start = lines.findIndex((l) => /^ +run: \|$/.test(l));
  const indent = lines[start]!.search(/\S/) + 2;
  const body: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (l.trim() && l.search(/\S/) < indent) break;
    body.push(l.slice(indent));
  }
  return body.join('\n');
}

/** Every `uses:` value in a workflow or action file. */
const usesOf = (text: string) => [...text.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)(.*)$/gm)].map((m) => ({ ref: m[1]!, comment: m[2]!.trim() }));

describe('action.yml (F168)', () => {
  it('is a composite action with the documented inputs and outputs', () => {
    expect(ACTION).toMatch(/^runs:\n {2}using: composite$/m);
    expect(childKeys(ACTION, 'inputs')).toEqual(expect.arrayContaining([
      'target', 'stdio', 'platform', 'fail-on', 'fail-on-spec', 'active', 'bearer', 'version', 'sarif-file', 'upload-sarif', 'extra-args',
    ]));
    // The report outputs (score, verdict, counts) are checked in test/remediation-w5d-action.test.ts.
    expect(childKeys(ACTION, 'outputs')).toEqual(expect.arrayContaining(['exit-code', 'sarif-file']));
  });

  it('defaults to the CLI defaults and to the current minor release', () => {
    const def = (input: string) => new RegExp(`^ {2}${input}:\\n(?: {4}.*\\n)*? {4}default: (.*)$`, 'm').exec(ACTION)?.[1];
    // 1.3.0 (A12-02): empty, so a config file's target and failOn apply; without a config file the step passes all and
    // error (test/r130-b3-sarif-action.test.ts).
    expect(def('platform')).toBe("''");
    expect(def('fail-on')).toBe("''");
    expect(def('active')).toBe("'false'");
    expect(def('upload-sarif')).toBe("'true'");
    expect(def('sarif-file')).toBe('mcp-review-check.sarif');
    const [major, minor] = (JSON.parse(read('package.json')) as { version: string }).version.split('.').map(Number);
    // CONTRIBUTING.md: the default is the minor being released; a patch release keeps it. Between the action change
    // and the release commit that bumps package.json it may already name the next minor.
    expect([`'${major}.${minor}'`, `'${major}.${minor! + 1}'`]).toContain(def('version'));
  });

  it('pins every action by commit SHA, in action.yml and in every workflow', () => {
    for (const [file, text] of [['action.yml', ACTION], ...WORKFLOWS.map((f) => [f, read(`.github/workflows/${f}`)])] as const) {
      for (const { ref, comment } of usesOf(text)) {
        if (ref === './') continue; // the action itself, in ci.yml
        expect(ref, `${file}: ${ref}`).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
        expect(comment, `${file}: ${ref} names its version`).toMatch(/^# v\d/);
      }
    }
    expect(usesOf(ACTION).map((u) => u.ref.split('@')[0])).toEqual(['github/codeql-action/upload-sarif']);
  });

  it('passes inputs to the script through env only, and the token never on the command line', () => {
    // ${{ }} inside a run script is expanded before bash parses it: an input could inject shell code.
    expect(actionScript()).not.toContain('${{');
    expect(actionScript()).not.toMatch(/--bearer/);
    expect(actionScript()).toMatch(/export MCP_REVIEW_CHECK_TOKEN="\$INPUT_BEARER"/);
    expect(ACTION).toMatch(/^ {8}INPUT_BEARER: \$\{\{ inputs\.bearer \}\}$/m);
  });

  it('runs the CLI once with SARIF output and uploads it even when the check fails', () => {
    expect(actionScript().match(/"\$\{cli\[@\]\}"/g)).toHaveLength(1);
    expect(actionScript()).toMatch(/--format sarif --output "\$INPUT_SARIF_FILE"/);
    expect(ACTION).toMatch(/- if: always\(\) && inputs\.upload-sarif == 'true' && steps\.run\.outputs\.sarif-file != ''\n\s+uses: github\/codeql-action\/upload-sarif@/);
    // The exit-code contract, 4 included for --max-duration stops.
    expect(ACTION).toMatch(/4 stopped by --max-duration/);
    expect(actionScript()).toMatch(/exit "\$code"$/m);
  });

  // The script itself, in bash, with the CLI from dist/ (built by the global setup). Windows CI runs it in the
  // "action" job of ci.yml instead (Git Bash).
  describe.skipIf(process.platform === 'win32')('script', () => {
    const run = (env: Record<string, string>) => {
      const dir = mkdtempSync(join(tmpdir(), 'w4d-action-'));
      try {
        const out = join(dir, 'out');
        writeFileSync(out, '');
        const inputs = {
          INPUT_TARGET: '', INPUT_STDIO: '', INPUT_PLATFORM: 'all', INPUT_FAIL_ON: 'error', INPUT_FAIL_ON_SPEC: 'false', INPUT_ACTIVE: 'false',
          INPUT_BEARER: '', INPUT_VERSION: '0.2', INPUT_CLI_PATH: 'dist/cli.js', INPUT_SARIF_FILE: join(dir, 'r.sarif'), INPUT_EXTRA_ARGS: '', ...env,
        };
        const r = spawnSync('bash', ['-c', actionScript()], {
          cwd: new URL('.', root), encoding: 'utf8', timeout: 60000,
          env: { PATH: process.env.PATH, HOME: process.env.HOME, GITHUB_OUTPUT: out, GITHUB_ACTIONS: 'true', RUNNER_TEMP: dir, MCP_REVIEW_CHECK_NO_CTA: '1', ...inputs },
        });
        const outputs = Object.fromEntries(readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => l.split(/=(.*)/s).slice(0, 2)));
        return { code: r.status, log: r.stdout + r.stderr, outputs, sarif: outputs['sarif-file'] ? JSON.parse(readFileSync(outputs['sarif-file'], 'utf8')) : undefined };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    };

    it('needs exactly one of target and stdio (exit 2, no SARIF)', () => {
      for (const env of [{} as Record<string, string>, { INPUT_TARGET: 'https://mcp.example.com/mcp', INPUT_STDIO: 'node x.js' }]) {
        const r = run(env);
        expect(r.code).toBe(2);
        expect(r.log).toMatch(/::error title=mcp-review-check::give/);
        expect(r.outputs).toEqual({ 'exit-code': '2', 'sarif-file': '', 'report-json': '' });
      }
    });

    it('rejects a version that is not a version or range, so it cannot install another package', () => {
      for (const version of ['npm:other-package', 'github:x/y', '../evil', 'https://e.example/x.tgz']) {
        const r = run({ INPUT_STDIO: 'node x.js', INPUT_CLI_PATH: '', INPUT_VERSION: version });
        expect(r.code, version).toBe(2);
        expect(r.log).toMatch(/version must be an npm version or range/);
      }
    });

    // The action passes --json-output (0.3.0): until the built CLI has it, the CLI exits 2 on the unknown option.
    it.skipIf(!spawnSync(process.execPath, ['dist/cli.js', '--help'], { cwd: new URL('.', root), encoding: 'utf8' }).stdout?.includes('--json-output'))('writes the SARIF report and the outputs, exits with the CLI code, keeps the token off argv', () => {
      const r = run({ INPUT_STDIO: 'node test/fixtures/good-server.mjs', INPUT_PLATFORM: 'both', INPUT_BEARER: 'SYNTH-w4d-token-1234', INPUT_EXTRA_ARGS: '  --timeout 20000  ' });
      expect(r.code, r.log).toBe(0);
      expect(r.outputs['exit-code']).toBe('0');
      expect(r.sarif.version).toBe('2.1.0');
      expect(r.log).toContain('::add-mask::SYNTH-w4d-token-1234');
      expect(JSON.stringify(r.sarif)).not.toContain('SYNTH-w4d-token-1234');
    });
  });
});

describe('workflows (F145, F159)', () => {
  it('release.yml checks that the published version carries provenance, after both publish steps', () => {
    const release = read('.github/workflows/release.yml');
    const verify = release.indexOf('- name: Published version carries npm provenance');
    // 0.4.0 removed the NPM_TOKEN first-release step: publishing goes only through trusted publishing.
    expect(release).not.toContain('NPM_TOKEN');
    expect(verify).toBeGreaterThan(release.indexOf('- name: Publish to npm (trusted publishing)'));
    expect(release.indexOf('- name: Publish to npm (trusted publishing)')).toBeGreaterThan(-1);
    expect(verify).toBeLessThan(release.indexOf('\n  gh-release:'));
    expect(release.slice(verify)).toMatch(/npm view "mcp-review-check@\$version" --json/);
    expect(release.slice(verify)).toMatch(/dist\?\.attestations/);
  });

  it('npm audit is off the pull-request path: on pushes in ci.yml and weekly in audit.yml', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/if: github\.event_name != 'pull_request'\n\s+run: npm audit --omit=dev --audit-level=high/);
    const audit = read('.github/workflows/audit.yml');
    expect(audit).toMatch(/schedule:\n\s+- cron: '[^']+'/);
    expect(audit).toMatch(/^ {2}workflow_dispatch:/m);
    expect(audit).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(audit).toMatch(/run: npm audit --omit=dev --audit-level=high/);
  });

  it('every workflow declares minimal top-level permissions', () => {
    for (const f of WORKFLOWS) expect(read(`.github/workflows/${f}`), f).toMatch(/^permissions:\n {2}contents: read$/m);
  });
});

describe('coverage thresholds (F156)', () => {
  it('are set for lines, functions, statements and branches', () => {
    const t = config.test?.coverage && 'thresholds' in config.test.coverage ? config.test.coverage.thresholds : undefined;
    for (const k of ['lines', 'functions', 'statements', 'branches'] as const) {
      expect(typeof t?.[k], k).toBe('number');
      expect(t![k]).toBeGreaterThan(0);
    }
  });
});
