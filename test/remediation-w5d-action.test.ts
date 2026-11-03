// W5D: the GitHub Action's report outputs (score, verdict, counts, new findings from a --json-output report), the
// Node 22.12 minimum (F151) and the release text in CONTRIBUTING.md. Like the W4D test, the YAML files are read as
// text: no YAML parser is a dependency, and the helpers rely on the two-space indentation the files use.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), 'utf8');
const ACTION = read('action.yml');
const CI = read('.github/workflows/ci.yml');
const PKG = JSON.parse(read('package.json')) as { version: string; engines: { node: string }; devDependencies: Record<string, string> };

/** Keys one level below the top-level key `name:`. */
function childKeys(text: string, name: string): string[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l === `${name}:`);
  const keys: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (/^\S/.test(l)) break;
    const m = /^ {2}([A-Za-z0-9_-]+):/.exec(l);
    if (m) keys.push(m[1]!);
  }
  return keys;
}

/** The action's steps under `runs: steps:`, each as its text (a step starts with `    - `). */
function actionSteps(): string[] {
  const body = ACTION.slice(ACTION.indexOf('\n  steps:\n') + 9).split('\n');
  const out: string[] = [];
  for (const l of body) {
    if (/^ {4}- /.test(l)) out.push(l);
    else if (out.length && (/^ {5,}/.test(l) || /^ {4}#/.test(l) || !l.trim())) out[out.length - 1] += `\n${l}`;
  }
  return out;
}

/** The dedented `run: |` script of a step's text. */
function script(step: string): string {
  const lines = step.split('\n');
  const start = lines.findIndex((l) => /^ +run: \|$/.test(l));
  const indent = lines[start]!.search(/\S/) + 2;
  const body: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (l.trim() && l.search(/\S/) < indent) break;
    body.push(l.slice(indent));
  }
  return body.join('\n');
}

const steps = actionSteps();
const runStep = steps.find((s) => /- id: run\n/.test(`${s}\n`))!;
const reportStep = steps.find((s) => /- id: report\n/.test(`${s}\n`))!;

const OUTPUTS = ['exit-code', 'sarif-file', 'report-json', 'score', 'verdict', 'verdict-claude', 'verdict-chatgpt', 'errors', 'warnings', 'new-findings'];

describe('action.yml outputs (wave 5)', () => {
  it('declares the report outputs, each read from the run or the report step', () => {
    expect(childKeys(ACTION, 'outputs')).toEqual(OUTPUTS);
    for (const o of OUTPUTS) {
      const from = ['exit-code', 'sarif-file', 'report-json'].includes(o) ? 'run' : 'report';
      expect(ACTION, o).toMatch(new RegExp(`^ {2}${o}:\\n {4}description: .+\\n {4}value: \\$\\{\\{ steps\\.${from}\\.outputs\\.${o} \\}\\}$`, 'm'));
    }
  });

  it('defaults version to the minor that has --json-output: package.json MAJOR.MINOR, or the next minor before the bump', () => {
    const def = /^ {2}version:\n(?: {4}.*\n)*? {4}default: '(.*)'$/m.exec(ACTION)?.[1];
    expect(def).toBe('0.3');
    const [major, minor] = PKG.version.split('.').map(Number);
    expect([`${major}.${minor}`, `${major}.${minor! + 1}`]).toContain(def);
  });

  it('runs the CLI once, writing SARIF and the JSON report in the same run', () => {
    const s = script(runStep);
    expect(s.match(/"\$\{cli\[@\]\}"/g)).toHaveLength(1);
    expect(s).toMatch(/--format sarif --output "\$INPUT_SARIF_FILE" --json-output "\$json_file"/);
    expect(s).toMatch(/json_file="\$\{RUNNER_TEMP:-/);
    expect(s).toMatch(/rm -f -- "\$INPUT_SARIF_FILE" "\$json_file"/);
    expect(s).toMatch(/echo "report-json=\$json_file" >> "\$GITHUB_OUTPUT"/);
    expect(s).toContain('Node 22.12 or newer');
  });

  it('reads the outputs in an always() step after the run and before the upload, with no ${{ }} in its script', () => {
    expect(steps.indexOf(runStep)).toBe(0);
    expect(steps.indexOf(reportStep)).toBe(1);
    expect(steps[2]).toMatch(/uses: github\/codeql-action\/upload-sarif@/);
    expect(reportStep).toMatch(/^ {6}if: always\(\)$/m);
    expect(reportStep).toMatch(/^ {8}REPORT_JSON: \$\{\{ steps\.run\.outputs\.report-json \}\}$/m);
    expect(reportStep).not.toMatch(/continue-on-error/);
    for (const s of steps.filter((x) => /run: \|/.test(x))) expect(script(s)).not.toContain('${{');
  });

  // The report step in bash, on JSON reports from dist/ (built by the global setup). Windows CI runs it in the
  // "action" job of ci.yml (Git Bash).
  describe.skipIf(process.platform === 'win32')('report step', () => {
    let dir: string;
    const cli = (...args: string[]) => spawnSync(process.execPath, ['dist/cli.js', ...args], { cwd: new URL('.', root), encoding: 'utf8', timeout: 60000, env: { ...process.env, GITHUB_ACTIONS: '', MCP_REVIEW_CHECK_NO_CTA: '1' } });
    const outputsOf = (file: string) => Object.fromEntries(readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => l.split(/=(.*)/s).slice(0, 2)));
    const report = (reportJson: string | undefined, path = process.env.PATH) => {
      const out = join(dir, `out-${Math.random().toString(36).slice(2)}`);
      writeFileSync(out, '');
      const r = spawnSync(BASH, ['-c', script(reportStep)], {
        encoding: 'utf8', timeout: 30000,
        env: { PATH: path, HOME: process.env.HOME, GITHUB_OUTPUT: out, ...(reportJson === undefined ? {} : { REPORT_JSON: reportJson }) },
      });
      return { code: r.status, log: r.stdout + r.stderr, outputs: outputsOf(out) };
    };
    const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();
    const EMPTY = { score: '', verdict: '', 'verdict-claude': '', 'verdict-chatgpt': '', errors: '', warnings: '', 'new-findings': '' };

    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), 'w5d-action-'));
      expect(cli('--stdio', 'node test/fixtures/good-server.mjs', '--format', 'json', '--output', join(dir, 'good.json')).status).toBe(0);
      expect(cli('--stdio', 'node test/fixtures/bad-server.mjs', '--target', 'claude', '--format', 'json', '--output', join(dir, 'bad.json')).status).toBe(1);
      // The same server against its own report as the baseline: every finding is known, so none is new.
      expect(cli('--stdio', 'node test/fixtures/bad-server.mjs', '--target', 'claude', '--format', 'json', '--output', join(dir, 'bad-baselined.json'), '--baseline', join(dir, 'bad.json')).status).toBe(0);
      writeFileSync(join(dir, 'broken.json'), '{"summary": ');
    }, 120000);
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it('a clean server: a numeric score, PASS, both platform verdicts and zero errors', () => {
      const r = report(join(dir, 'good.json'));
      const json = JSON.parse(readFileSync(join(dir, 'good.json'), 'utf8'));
      expect(r.code, r.log).toBe(0);
      expect(r.outputs.score).toMatch(/^\d+$/);
      expect(Number(r.outputs.score)).toBe(json.summary.score);
      expect(r.outputs.verdict).toBe('PASS');
      expect(r.outputs['verdict-claude']).toBe(json.summary.verdicts.claude.verdict);
      expect(r.outputs['verdict-chatgpt']).toBe(json.summary.verdicts.chatgpt.verdict);
      expect(r.outputs.errors).toBe('0');
      expect(r.outputs.warnings).toBe(String(json.summary.warnings));
      expect(r.outputs['new-findings']).toBe(String(json.findings.length));
    });

    it('a server with errors: FAIL, the claude verdict only, the counts of the report', () => {
      const r = report(join(dir, 'bad.json'));
      const json = JSON.parse(readFileSync(join(dir, 'bad.json'), 'utf8'));
      expect(r.code, r.log).toBe(0);
      expect(r.outputs.verdict).toBe('FAIL');
      expect(r.outputs['verdict-claude']).toBe('BLOCKED');
      expect(r.outputs['verdict-chatgpt']).toBe('');
      expect(Number(r.outputs.errors)).toBeGreaterThan(0);
      expect(r.outputs.errors).toBe(String(json.summary.errors));
      expect(r.outputs['new-findings']).toBe(String(json.findings.length));
    });

    it('with a baseline: new-findings is the findings minus summary.baselined', () => {
      const json = JSON.parse(readFileSync(join(dir, 'bad-baselined.json'), 'utf8'));
      expect(json.summary.baselined).toBeGreaterThan(0);
      const r = report(join(dir, 'bad-baselined.json'));
      expect(r.outputs['new-findings']).toBe(String(json.findings.length - json.summary.baselined));
      expect(r.outputs['new-findings']).toBe('0');
      expect(r.outputs.verdict).toBe('PASS');
    });

    it('a --max-duration stop reads INCOMPLETE; a null score is empty', () => {
      const json = JSON.parse(readFileSync(join(dir, 'good.json'), 'utf8'));
      json.limits = { ...(json.limits ?? {}), stopped: { phase: 'tools/list' } };
      json.summary = { ...json.summary, score: null, failed: true };
      writeFileSync(join(dir, 'stopped.json'), JSON.stringify(json));
      const r = report(join(dir, 'stopped.json'));
      expect(r.outputs.verdict).toBe('INCOMPLETE');
      expect(r.outputs.score).toBe('');
    });

    it('no report (exit 2), a missing file, a broken file or no node: every output empty, and the step passes', () => {
      for (const [what, file] of [['no path', ''], ['unset', undefined], ['missing', join(dir, 'none.json')], ['broken', join(dir, 'broken.json')]] as const) {
        const r = report(file);
        expect(r.code, `${what}: ${r.log}`).toBe(0);
        expect(r.outputs, what).toEqual(EMPTY);
      }
      expect(report(join(dir, 'broken.json')).log).toMatch(/::warning title=mcp-review-check::could not read the JSON report/);
      // bash without node on PATH (the run step has already failed with the usage error).
      // The script uses only bash builtins besides node, so a PATH without node is an empty directory.
      // Not on macOS: the GitHub macOS runner's bash still resolves node with such a PATH (CI run 41397409044),
      // which is a property of that environment, not of the script.
      if (process.platform !== 'darwin') expect(report(join(dir, 'good.json'), mkdtempSync(join(dir, 'bin-'))).outputs).toEqual(EMPTY);
    });

    it('a report value cannot add an output line', () => {
      const json = JSON.parse(readFileSync(join(dir, 'good.json'), 'utf8'));
      json.summary.verdicts.claude.verdict = 'PASS\nscore=1';
      json.summary.score = '7\nverdict=PASS';
      writeFileSync(join(dir, 'hostile.json'), JSON.stringify(json));
      const r = report(join(dir, 'hostile.json'));
      expect(r.outputs['verdict-claude']).toBe('');
      expect(r.outputs.score).toBe('');
      expect(Object.keys(r.outputs).sort()).toEqual(Object.keys(EMPTY).sort());
    });
  });

  // Both steps end to end, once the CLI has --json-output (W5A, 0.3.0): until then the run step's CLI rejects the
  // option with exit 2, as mcp-review-check 0.2 from npm would.
  const help = spawnSync(process.execPath, [new URL('dist/cli.js', root).pathname, '--help'], { encoding: 'utf8' }).stdout ?? '';
  describe.skipIf(process.platform === 'win32' || !help.includes('--json-output'))('run and report steps with the built CLI', () => {
    it('the good server sets a numeric score and PASS', () => {
      const dir = mkdtempSync(join(tmpdir(), 'w5d-e2e-'));
      try {
        const out = join(dir, 'out');
        writeFileSync(out, '');
        const env = {
          PATH: process.env.PATH, HOME: process.env.HOME, GITHUB_OUTPUT: out, GITHUB_ACTIONS: 'true', RUNNER_TEMP: dir, MCP_REVIEW_CHECK_NO_CTA: '1',
          INPUT_TARGET: '', INPUT_STDIO: 'node test/fixtures/good-server.mjs', INPUT_PLATFORM: 'all', INPUT_FAIL_ON: 'error', INPUT_FAIL_ON_SPEC: 'false',
          INPUT_ACTIVE: 'false', INPUT_BEARER: '', INPUT_VERSION: '0.3', INPUT_CLI_PATH: 'dist/cli.js', INPUT_SARIF_FILE: join(dir, 'r.sarif'), INPUT_EXTRA_ARGS: '',
        };
        const run = spawnSync('bash', ['-c', script(runStep)], { cwd: new URL('.', root), encoding: 'utf8', timeout: 60000, env });
        expect(run.status, run.stdout + run.stderr).toBe(0);
        const first = Object.fromEntries(readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => l.split(/=(.*)/s).slice(0, 2)));
        expect(first['report-json']).toMatch(/mcp-review-check-\d+\.json$/);
        const rep = spawnSync('bash', ['-c', script(reportStep)], { encoding: 'utf8', timeout: 30000, env: { ...env, REPORT_JSON: first['report-json'] } });
        expect(rep.status, rep.stdout + rep.stderr).toBe(0);
        const all = Object.fromEntries(readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => l.split(/=(.*)/s).slice(0, 2)));
        expect(all.score).toMatch(/^\d+$/);
        expect(all.verdict).toBe('PASS');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});

describe('CI self-test of the action outputs', () => {
  it('asserts a numeric score and a non-empty verdict for the good server, and FAIL with errors for the bad one', () => {
    expect(CI).toMatch(/GOOD_SCORE: \$\{\{ steps\.good\.outputs\.score \}\}/);
    expect(CI).toMatch(/GOOD_VERDICT: \$\{\{ steps\.good\.outputs\.verdict \}\}/);
    expect(CI).toMatch(/BAD_VERDICT: \$\{\{ steps\.bad\.outputs\.verdict \}\}/);
    expect(CI).toMatch(/\[\[ "\$GOOD_SCORE" =~ \^\[0-9\]\+\$ \]\]/);
    expect(CI).toMatch(/test -n "\$GOOD_VERDICT"/);
    expect(CI).toMatch(/test "\$BAD_VERDICT" = FAIL/);
  });
});

describe('Node 22.12 minimum (F151)', () => {
  it('package.json engines and @types/node follow the oldest supported Node', () => {
    expect(PKG.engines.node).toBe('>=22.12');
    expect(PKG.devDependencies['@types/node']).toMatch(/^\^22\./);
    const lock = JSON.parse(read('package-lock.json')) as { packages: Record<string, { version?: string; engines?: { node: string } }> };
    expect(lock.packages['']!.engines!.node).toBe('>=22.12');
    expect(lock.packages['node_modules/@types/node']!.version).toMatch(/^22\./);
  });

  it('CI tests Node 22 and 24 on every OS, without Node 20 or exclusions', () => {
    expect(CI).toMatch(/^ {8}node: \['22', '24'\]$/m);
    expect(CI).not.toMatch(/exclude:/);
    expect(CI).not.toMatch(/20\.19/);
    for (const f of ['.github/dependabot.yml', '.github/workflows/release.yml', 'action.yml', 'CONTRIBUTING.md']) expect(read(f), f).not.toMatch(/20\.19|Node 20\b/);
  });
});

describe('CONTRIBUTING.md release text (wave 5)', () => {
  const text = read('CONTRIBUTING.md');
  it('states the release cadence, trusted publishing and no NPM_TOKEN fallback (0.4.0)', () => {
    expect(text).toContain('Node 22.12 or newer');
    expect(text).toMatch(/each feature or coherent feature set is its own minor release/i);
    expect(text).toMatch(/trusted publishing/);
    expect(text).toMatch(/2026-11-02/);
    expect(text).toMatch(/environment `npm`/);
    expect(text).not.toMatch(/NPM_TOKEN[^\n]*fallback/);
    expect(text).toMatch(/Do not create an `NPM_TOKEN` secret/);
  });
});
