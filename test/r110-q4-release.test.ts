// Q4 (1.1.0), release pipeline: the tag-release guard (Q4-GUARD), the npm provenance content check (Q4-PROVENANCE)
// and docker.yml chained to a successful Release run (Q4-DOCKER). The scripts run against a fake GitHub API / npm
// registry on 127.0.0.1, so no test reaches the network; the workflows are parsed (python3 yaml when present) and
// asserted on.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { decide, onMain } from '../scripts/release-guard.mjs';
import { checkProvenance } from '../scripts/verify-provenance.mjs';

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

// The shape of the attestations npm serves (as for mcp-review-check@1.0.0), for this run's values.
const WANT = { version: '1.1.0', sha512: 'b'.repeat(128), repository: 'alisaosipova/mcp-review-check', ref: 'refs/tags/v1.1.0', sha: 'c'.repeat(40), runId: '4242' };
function statement(over: { workflow?: Record<string, unknown>; commit?: string; uri?: string; invocationId?: string; sha512?: string; name?: string; event?: string } = {}) {
  const repo = `https://github.com/${WANT.repository}`;
  return {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{ name: over.name ?? `pkg:npm/mcp-review-check@${WANT.version}`, digest: { sha512: over.sha512 ?? WANT.sha512 } }],
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: {
      buildDefinition: {
        buildType: 'https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1',
        externalParameters: { workflow: { ref: WANT.ref, repository: repo, path: '.github/workflows/release.yml', ...over.workflow } },
        internalParameters: { github: { event_name: over.event ?? 'push', repository_id: '1', repository_owner_id: '2' } },
        resolvedDependencies: [{ uri: over.uri ?? `git+${repo}@${WANT.ref}`, digest: { gitCommit: over.commit ?? WANT.sha } }],
      },
      runDetails: { builder: { id: 'https://github.com/actions/runner/github-hosted' }, metadata: { invocationId: over.invocationId ?? `${repo}/actions/runs/${WANT.runId}/attempts/1` } },
    },
  };
}
const envelope = (predicateType: string, st: unknown) => ({ predicateType, bundle: { mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json', dsseEnvelope: { payloadType: 'application/vnd.in-toto+json', payload: Buffer.from(JSON.stringify(st)).toString('base64'), signatures: [] } } });
const doc = (st: unknown = statement()) => ({ attestations: [envelope('https://github.com/npm/attestation/tree/main/specs/publish/v0.1', { predicateType: 'https://github.com/npm/attestation/tree/main/specs/publish/v0.1' }), envelope('https://slsa.dev/provenance/v1', st)] });

describe('the provenance content check (Q4-PROVENANCE)', () => {
  it('accepts a provenance that names this repository, release.yml, the tag, the commit, the run and the tarball', () => {
    expect(checkProvenance(doc(), WANT)).toEqual([]);
    expect(checkProvenance(doc(statement({ invocationId: `https://github.com/${WANT.repository}/actions/runs/4242/attempts/3` })), WANT)).toEqual([]);
  });

  it('rejects each field that describes another build', () => {
    const one = (over: Parameters<typeof statement>[0]) => checkProvenance(doc(statement(over)), WANT);
    expect(one({ workflow: { repository: 'https://github.com/someone/fork' } })).toEqual(['workflow repository is "https://github.com/someone/fork", expected "https://github.com/alisaosipova/mcp-review-check"']);
    expect(one({ workflow: { path: '.github/workflows/ci.yml' } })).toEqual(['workflow path is ".github/workflows/ci.yml", expected ".github/workflows/release.yml"']);
    expect(one({ workflow: { ref: 'refs/heads/main' } })).toEqual(['workflow ref is "refs/heads/main", expected "refs/tags/v1.1.0"']);
    expect(one({ commit: 'd'.repeat(40) })).toEqual([`source commit is "${'d'.repeat(40)}", expected "${'c'.repeat(40)}"`]);
    expect(one({ uri: `git+https://github.com/${WANT.repository}@refs/heads/main` })).toEqual([`source uri is "git+https://github.com/${WANT.repository}@refs/heads/main", expected "git+https://github.com/${WANT.repository}@refs/tags/v1.1.0"`]);
    expect(one({ invocationId: `https://github.com/${WANT.repository}/actions/runs/1/attempts/1` })[0]).toMatch(/^invocationId is .*runs\/1\/attempts\/1", expected .*runs\/4242\/attempts\/<n>$/);
    expect(one({ invocationId: `https://github.com/${WANT.repository}/actions/runs/42420/attempts/1` })).toHaveLength(1); // a run id that starts with this one
    expect(one({ sha512: 'e'.repeat(128) })).toEqual([`subject sha512 is "${'e'.repeat(128)}", expected "${'b'.repeat(128)}"`]);
    expect(one({ name: 'pkg:npm/mcp-review-check@1.0.0' })).toEqual(['no subject pkg:npm/mcp-review-check@1.1.0 (found: pkg:npm/mcp-review-check@1.0.0)']);
    expect(one({ event: 'workflow_dispatch' })).toEqual(['event is "workflow_dispatch", expected "push"']);
  });

  it('rejects a document without an SLSA attestation or with an unreadable payload', () => {
    expect(checkProvenance({}, WANT)).toEqual(['the attestations document has no attestations list']);
    expect(checkProvenance({ attestations: [doc().attestations[0]] }, WANT)).toEqual(['no https://slsa.dev/provenance/v1 attestation (found: https://github.com/npm/attestation/tree/main/specs/publish/v0.1)']);
    const bad = envelope('https://slsa.dev/provenance/v1', {});
    bad.bundle.dsseEnvelope.payload = Buffer.from('not json').toString('base64');
    expect(checkProvenance({ attestations: [bad] }, WANT)).toEqual(['the SLSA attestation payload is not JSON']);
  });

  const registry = (body: () => unknown, seen: string[] = []) => serve((req, res) => {
    seen.push(req.url ?? '');
    if (req.url === '/-/npm/v1/attestations/mcp-review-check@1.1.0') return json(res, body());
    json(res, { error: 'not found' }, 404);
  });
  const tarball = () => script('verify-provenance.mjs'); // any file: its sha512 is what the statement must name
  const sha512 = () => createHash('sha512').update(readFileSync(tarball())).digest('hex');
  const env = (base: string) => ({ NPM_REGISTRY: base, GITHUB_REPOSITORY: WANT.repository, GITHUB_SHA: WANT.sha, GITHUB_REF: WANT.ref, GITHUB_REF_NAME: 'v1.1.0', GITHUB_RUN_ID: WANT.runId, PROVENANCE_ATTEMPTS: '1' });

  it('the script exits 0 when the registry\'s provenance matches the run and the tarball', async () => {
    const seen: string[] = [];
    const r = await runScript('verify-provenance.mjs', [tarball()], env(await registry(() => doc(statement({ sha512: sha512() })), seen)));
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain('the provenance names .github/workflows/release.yml at refs/tags/v1.1.0');
    expect(seen).toEqual(['/-/npm/v1/attestations/mcp-review-check@1.1.0']);
  }, 30000);

  it('the script exits 1 with one ::error:: per mismatch, and when the registry has no attestations', async () => {
    const r = await runScript('verify-provenance.mjs', [tarball()], env(await registry(() => doc(statement({ commit: 'd'.repeat(40) })))));
    expect(r.code, r.out).toBe(1);
    expect(r.out.match(/::error::/g)).toHaveLength(2); // the commit and the tarball's sha512
    expect(r.out).toContain('::error::mcp-review-check@1.1.0 provenance: source commit is');
    expect(r.out).toContain('::error::mcp-review-check@1.1.0 provenance: subject sha512 is');
    const missing = await runScript('verify-provenance.mjs', [tarball()], env(await serve((_q, res) => json(res, {}, 404))));
    expect(missing.code, missing.out).toBe(1);
    expect(missing.out).toContain('::error::mcp-review-check@1.1.0: the registry served no attestations (HTTP 404)');
  }, 30000);

  it('release.yml: a provenance job without write permissions runs the check between publish and gh-release', () => {
    const job = jobText(RELEASE_YML, 'provenance');
    expect(job).toMatch(/\n {4}needs: publish\n/);
    expect(job).toMatch(/run: node scripts\/verify-provenance\.mjs "\$RUNNER_TEMP"\/package\/mcp-review-check-\*\.tgz/);
    expect(job).not.toMatch(/: write|id-token/);
    expect(jobText(RELEASE_YML, 'gh-release')).toMatch(/\n {4}needs: provenance\n/);
    // The OIDC job still runs no repository code (no checkout, no node scripts/).
    expect(jobText(RELEASE_YML, 'publish')).not.toMatch(/actions\/checkout|node scripts\//);
    const y = parseYaml(RELEASE_YML);
    if (y) {
      expect(Object.keys(y.jobs)).toEqual(['guard', 'build', 'publish', 'provenance', 'gh-release']);
      expect(y.jobs.provenance.permissions).toEqual({ contents: 'read' });
      expect(y.jobs['gh-release'].needs).toBe('provenance');
    }
  });
});
