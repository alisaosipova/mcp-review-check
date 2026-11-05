// Q4 (1.1.0), release pipeline: the tag-release guard (Q4-GUARD), the npm provenance content check (Q4-PROVENANCE)
// and docker.yml chained to a successful Release run (Q4-DOCKER). The scripts run against a fake GitHub API / npm
// registry on 127.0.0.1, so no test reaches the network; the workflows are parsed (python3 yaml when present) and
// asserted on.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { decide, onMain } from '../scripts/release-guard.mjs';

const root = new URL('../', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), 'utf8');
const script = (name: string) => fileURLToPath(new URL(`scripts/${name}`, root));
const RELEASE_YML = read('.github/workflows/release.yml');

const python = spawnSync('python3', ['-I', '-c', 'import yaml'], { encoding: 'utf8' }).status === 0;
/** The workflow parsed by python3's yaml (JSON out); undefined where python3 or its yaml module is missing. */
function parseYaml(text: string): any {
  if (!python) return undefined;
  const r = spawnSync('python3', ['-I', '-c', 'import sys,yaml,json; print(json.dumps(yaml.safe_load(sys.stdin.read())))'], { input: text, encoding: 'utf8' });
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(r.stdout);
}

/** One job of a workflow, as text: from `  <name>:` to the next job or the end. */
function jobText(yml: string, name: string): string {
  const at = yml.indexOf(`\n  ${name}:\n`, yml.indexOf('\njobs:\n'));
  expect(at, name).toBeGreaterThan(-1);
  const next = yml.slice(at + 1).search(/\n {2}[a-z][\w-]*:\n/);
  return next < 0 ? yml.slice(at) : yml.slice(at, at + 1 + next);
}

const servers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((c) => c())); });

async function serve(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
  const srv = createServer(handler);
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  servers.push(() => new Promise<void>((r) => { srv.closeAllConnections(); srv.close(() => r()); }));
  return `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
}

const json = (res: ServerResponse, body: unknown, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

/** Run a script with `env` (on top of a PATH-only environment); resolves with its exit code and output. */
function runScript(name: string, args: string[], env: Record<string, string>): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [script(name), ...args], { env: { PATH: process.env.PATH ?? '', ...env } });
    let out = '';
    p.stdout.on('data', (c) => { out += c; });
    p.stderr.on('data', (c) => { out += c; });
    p.on('close', (code) => resolve({ code, out }));
  });
}

const SHA = 'a'.repeat(40);
const run = (o: Partial<{ status: string; conclusion: string | null; event: string; head_branch: string }>) => ({ status: 'completed', conclusion: 'success', event: 'push', head_branch: 'main', html_url: 'https://github.invalid/run/1', ...o });

describe('the tag-release guard (Q4-GUARD)', () => {
  it('onMain: identical and behind are on main; ahead, diverged and unknown are not', () => {
    expect(['identical', 'behind', 'ahead', 'diverged', undefined].map(onMain)).toEqual([true, true, false, false, false]);
  });

  it('passes a commit on main with a successful CI run of a push to main', () => {
    expect(decide({ compareStatus: 'identical', runs: [run({})], sha: SHA, tag: 'v1.1.0' }).verdict).toBe('pass');
    expect(decide({ compareStatus: 'behind', runs: [run({ conclusion: 'failure' }), run({})], sha: SHA, tag: 'v1.1.0' }).verdict).toBe('pass');
  });

  it('fails a commit that is not on main, whatever its CI says, and says what to do', () => {
    const d = decide({ compareStatus: 'ahead', runs: [run({})], sha: SHA, tag: 'v1.1.0' });
    expect(d).toEqual({ verdict: 'fail', message: expect.stringMatching(/^v1\.1\.0 points at a{12}, which is not on main \(compare status: ahead\)\. Merge/) });
    expect(decide({ compareStatus: 'diverged', runs: [run({})], sha: SHA, tag: 'v1.1.0' }).verdict).toBe('fail');
    expect(decide({ compareStatus: undefined, runs: [run({})], sha: SHA, tag: 'v1.1.0' }).message).toContain('compare status: unknown');
  });

  it('fails a commit whose CI failed or never ran, and does not count pull request or branch runs', () => {
    expect(decide({ compareStatus: 'identical', runs: [run({ conclusion: 'failure' })], sha: SHA, tag: 'v1.1.0' }).message).toMatch(/CI did not pass for v1\.1\.0 .*failure/);
    expect(decide({ compareStatus: 'identical', runs: [], sha: SHA, tag: 'v1.1.0' }).message).toMatch(/no CI run of a push to main/);
    expect(decide({ compareStatus: 'identical', runs: [run({ event: 'pull_request' }), run({ head_branch: 'feature' })], sha: SHA, tag: 'v1.1.0' }).verdict).toBe('fail');
  });

  it('waits while a CI run of the commit is still in progress', () => {
    expect(decide({ compareStatus: 'identical', runs: [run({ status: 'in_progress', conclusion: null })], sha: SHA, tag: 'v1.1.0' }).verdict).toBe('wait');
  });

  const api = (compareStatus: string, runs: unknown[], seen: string[] = []) => serve((req, res) => {
    seen.push(`${req.url} ${req.headers.authorization}`);
    if (req.url === `/repos/o/r/compare/main...${SHA}`) return json(res, { status: compareStatus });
    if (req.url === `/repos/o/r/actions/workflows/ci.yml/runs?head_sha=${SHA}&per_page=100`) return json(res, { workflow_runs: runs });
    json(res, { message: 'Not Found' }, 404);
  });
  const token = ['ghs', 'SYNTH', 'q4guard'].join('_');
  const env = (base: string) => ({ GITHUB_API_URL: base, GITHUB_REPOSITORY: 'o/r', GITHUB_SHA: SHA, GITHUB_REF_NAME: 'v1.1.0', GH_TOKEN: token, RELEASE_GUARD_WAIT_SECONDS: '0' });

  it('the script exits 0 for a green commit on main, with the token on every request and not in its output', async () => {
    const seen: string[] = [];
    const r = await runScript('release-guard.mjs', [], env(await api('identical', [run({})], seen)));
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain('is on main and CI passed');
    expect(r.out).not.toContain(token);
    expect(seen.length).toBe(2);
    expect(seen.every((s) => s.endsWith(`Bearer ${token}`))).toBe(true);
  }, 30000);

  it('the script exits 1 with a ::error:: for a commit off main, a red CI and a CI still running past the wait', async () => {
    for (const [status, runs, msg] of [
      ['diverged', [run({})], /::error::v1\.1\.0 points at .* not on main/],
      ['identical', [run({ conclusion: 'cancelled' })], /::error::CI did not pass/],
      ['identical', [run({ status: 'queued', conclusion: null })], /::error::CI is still running .* after 0 s/],
    ] as const) {
      const r = await runScript('release-guard.mjs', [], env(await api(status, [...runs])));
      expect(r.code, r.out).toBe(1);
      expect(r.out).toMatch(msg);
    }
  }, 30000);

  it('release.yml: the guard job runs first, can only read, and the build job needs it', () => {
    const guard = jobText(RELEASE_YML, 'guard');
    expect(guard).toMatch(/run: node scripts\/release-guard\.mjs/);
    expect(guard).toMatch(/GH_TOKEN: \$\{\{ github\.token \}\}/);
    expect(guard).toMatch(/actions: read/);
    expect(guard).not.toMatch(/: write/);
    expect(jobText(RELEASE_YML, 'build')).toMatch(/\n {4}needs: guard\n/);
    const y = parseYaml(RELEASE_YML);
    if (y) {
      expect(Object.keys(y.jobs)[0]).toBe('guard');
      expect(y.jobs.guard.permissions).toEqual({ contents: 'read', actions: 'read' });
      expect(y.jobs.build.needs).toBe('guard');
    }
  });
});
