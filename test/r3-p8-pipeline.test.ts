// Review round 3, package P8 (Pipeline): the composite action's script (action.yml) and the Docker image pipeline
// (Dockerfile, .github/workflows/docker.yml). The action script runs in bash with a fake CLI and fake npm/npx on
// PATH, so no test reaches the network.
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), 'utf8');
const ACTION = read('action.yml');
const DOCKERFILE = read('Dockerfile');
const DOCKER_YML = read('.github/workflows/docker.yml');

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

/** One job of docker.yml: from `  <name>:` to the next job or the end. */
function job(name: string): string {
  const at = DOCKER_YML.indexOf(`\n  ${name}:\n`, DOCKER_YML.indexOf("\njobs:\n"));
  const next = DOCKER_YML.slice(at + 1).search(/\n {2}[a-z][\w-]*:\n/);
  return next < 0 ? DOCKER_YML.slice(at) : DOCKER_YML.slice(at, at + 1 + next);
}

// Assembled at runtime, never a contiguous token-shaped literal.
const TOKEN = ['sk', 'live', 'SYNTH', 'p8', 'token', '0123456789'].join('_');

describe.skipIf(process.platform === 'win32')('action.yml script (review round 3, P8)', () => {
  /** Runs the script with a fake CLI that records its argv and whether a token reached it. */
  const run = (env: Record<string, string>, opts: { fakeNpm?: boolean; npmFails?: boolean } = {}) => {
    const dir = mkdtempSync(join(tmpdir(), 'r3-p8-action-'));
    try {
      const out = join(dir, 'out');
      writeFileSync(out, '');
      const log = join(dir, 'log');
      writeFileSync(log, '');
      const fakeCli = join(dir, 'fake-cli.mjs');
      writeFileSync(fakeCli, [
        "import { appendFileSync } from 'node:fs';",
        `appendFileSync(${JSON.stringify(log)}, 'cli ' + JSON.stringify({ argv: process.argv.slice(2), token: process.env.MCP_REVIEW_CHECK_TOKEN ? 'set' : 'unset' }) + '\\n');`,
      ].join('\n'));
      const bin = join(dir, 'bin');
      mkdirSync(bin);
      if (opts.fakeNpm) {
        // npx must not be used; if it is, it records the call and exits 0 instead of reaching the registry.
        writeFileSync(join(bin, 'npx'), `#!/usr/bin/env bash\necho "npx ignore=\${npm_config_ignore_scripts:-none} token=\${MCP_REVIEW_CHECK_TOKEN:+set}" >> ${JSON.stringify(log)}\nexit 0\n`);
        // npm install --prefix <dir> ...: records the environment it ran in and installs a bin shim that runs the fake CLI.
        writeFileSync(join(bin, 'npm'), [
          '#!/usr/bin/env bash',
          `echo "npm ignore=\${npm_config_ignore_scripts:-none} token=\${MCP_REVIEW_CHECK_TOKEN:+set} args=$*" >> ${JSON.stringify(log)}`,
          ...(opts.npmFails ? ['exit 1'] : []),
          'prefix=""; while [ $# -gt 0 ]; do [ "$1" = --prefix ] && prefix="$2"; shift; done',
          '[ -n "$prefix" ] || exit 1',
          'mkdir -p "$prefix/node_modules/.bin"',
          `printf '#!/usr/bin/env bash\\nexec node ${fakeCli} "$@"\\n' > "$prefix/node_modules/.bin/mcp-review-check"`,
          'chmod +x "$prefix/node_modules/.bin/mcp-review-check"',
        ].join('\n'));
        chmodSync(join(bin, 'npx'), 0o755);
        chmodSync(join(bin, 'npm'), 0o755);
      }
      const inputs = {
        INPUT_TARGET: '', INPUT_STDIO: 'node x.mjs', INPUT_PLATFORM: 'all', INPUT_FAIL_ON: 'error', INPUT_FAIL_ON_SPEC: 'false', INPUT_ACTIVE: 'false',
        INPUT_BEARER: '', INPUT_VERSION: '1.0', INPUT_CLI_PATH: fakeCli, INPUT_SARIF_FILE: join(dir, 'r.sarif'), INPUT_EXTRA_ARGS: '', ...env,
      };
      const r = spawnSync('bash', ['-c', actionScript()], {
        cwd: new URL('.', root), encoding: 'utf8', timeout: 60000,
        env: { PATH: `${bin}${delimiter}${process.env.PATH}`, HOME: process.env.HOME, GITHUB_OUTPUT: out, GITHUB_ACTIONS: 'true', RUNNER_TEMP: dir, ...inputs },
      });
      const lines = readFileSync(log, 'utf8').split('\n').filter(Boolean);
      const cli = lines.filter((l) => l.startsWith('cli ')).map((l) => JSON.parse(l.slice(4)) as { argv: string[]; token: string });
      const outputs = Object.fromEntries(readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => l.split(/=(.*)/s).slice(0, 2)));
      return { code: r.status, stdout: r.stdout, stderr: r.stderr, log: r.stdout + r.stderr, lines, cli, outputs };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it('A08-01: a multi-line extra-args (YAML block scalar) passes every line to the CLI', () => {
    const r = run({ INPUT_EXTRA_ARGS: '--timeout 60000\n--ignore TOOL-013\n  --fail-on-incomplete\r\n\t--max-duration 30\n' });
    expect(r.code, r.log).toBe(0);
    expect(r.cli).toHaveLength(1);
    const argv = r.cli[0]!.argv;
    expect(argv.join(' ')).toContain('--timeout 60000 --ignore TOOL-013 --fail-on-incomplete --max-duration 30 --stdio node x.mjs');
    // A CR from Windows line endings does not stick to a token.
    expect(argv.filter((a) => /[\r\n\t ]/.test(a) && a !== 'node x.mjs')).toEqual([]);
  });

  it('A08-01: extra-args is still split without globbing or quote removal, and an empty value adds nothing', () => {
    const r = run({ INPUT_EXTRA_ARGS: '--ignore "*"\n--config ./x.json' });
    expect(r.cli[0]!.argv).toEqual(expect.arrayContaining(['--ignore', '"*"', '--config', './x.json']));
    const empty = run({ INPUT_EXTRA_ARGS: '' });
    expect(empty.code, empty.log).toBe(0);
    expect(empty.cli[0]!.argv.slice(-2)).toEqual(['--stdio', 'node x.mjs']);
  });

  it('A08-02: installs the npm package with install scripts off and without the token, then runs it with the token', () => {
    const r = run({ INPUT_CLI_PATH: '', INPUT_BEARER: TOKEN }, { fakeNpm: true });
    expect(r.code, r.log).toBe(0);
    expect(r.lines.filter((l) => l.startsWith('npx '))).toEqual([]);
    const npm = r.lines.filter((l) => l.startsWith('npm '));
    expect(npm).toHaveLength(1);
    expect(npm[0]).toMatch(/^npm ignore=true token= args=install /);
    expect(npm[0]).toContain('--ignore-scripts');
    expect(npm[0]).toContain('mcp-review-check@1.0');
    expect(r.cli).toHaveLength(1);
    expect(r.cli[0]!.token).toBe('set');
    // Only the ::add-mask:: command names the token (the runner masks it from then on).
    expect(r.log.split('\n').filter((l) => l.includes(TOKEN))).toEqual([`::add-mask::${TOKEN}`]);
  });

  it('A08-02: a token the job already exported does not reach the install either, but reaches the CLI', () => {
    const r = run({ INPUT_CLI_PATH: '', MCP_REVIEW_CHECK_TOKEN: TOKEN }, { fakeNpm: true });
    expect(r.code, r.log).toBe(0);
    expect(r.lines.filter((l) => l.startsWith('npm '))[0]).toMatch(/^npm ignore=true token= /);
    expect(r.cli[0]!.token).toBe('set');
    // The bearer input is exported only after the install.
    const s = actionScript();
    expect(s).not.toMatch(/\bnpx\b/);
    expect(s.indexOf('export MCP_REVIEW_CHECK_TOKEN')).toBeGreaterThan(s.indexOf('npm install'));
  });

  it('A08-02: a failed install fails the step with exit 3 and a message', () => {
    const r = run({ INPUT_CLI_PATH: '', INPUT_VERSION: '9.9.9' }, { fakeNpm: true, npmFails: true });
    expect(r.code).toBe(3);
    expect(r.log).toMatch(/::error title=mcp-review-check::could not install mcp-review-check@9\.9\.9/);
    expect(r.outputs).toEqual({ 'exit-code': '3', 'sarif-file': '', 'report-json': '' });
    expect(r.cli).toEqual([]);
  });

  it('A08-06: a bearer with CR or LF is rejected before anything is echoed, and no part of it reaches the log', () => {
    for (const sep of ['\n', '\r', '\r\n']) {
      const first = ['SYNTH', 'first', 'part'].join('-');
      const second = ['SYNTH', 'second', 'part'].join('-');
      const r = run({ INPUT_BEARER: `${first}${sep}${second}` });
      expect(r.code, JSON.stringify(sep)).toBe(2);
      expect(r.log).toMatch(/::error title=mcp-review-check::bearer must not contain CR or LF \(the value is not shown\)/);
      expect(r.log).not.toContain(first);
      expect(r.log).not.toContain(second);
      expect(r.log).not.toContain('::add-mask::');
      expect(r.cli).toEqual([]);
      expect(r.outputs['exit-code']).toBe('2');
    }
  });

  it('A08-06: a single-line bearer is still masked and passed through the environment', () => {
    const r = run({ INPUT_BEARER: TOKEN });
    expect(r.code, r.log).toBe(0);
    expect(r.stdout).toContain(`::add-mask::${TOKEN}`);
    expect(r.cli[0]!.token).toBe('set');
    expect(r.cli[0]!.argv.join(' ')).not.toContain(TOKEN);
  });
});

describe('Docker image (review round 3, P8)', () => {
  it('A08-04: the Dockerfile documents running as the host user so a mounted output folder is writable', () => {
    expect(DOCKERFILE).toMatch(/--user "\$\(id -u\):\$\(id -g\)"/);
    expect(DOCKERFILE).toMatch(/-v "\$PWD\/out:\/out"/);
    // Still non-root by default.
    expect(DOCKERFILE).toMatch(/^USER reviewer$/m);
  });

  it('A08-04: the smoke test writes a report into a host mount as the runner user', () => {
    const build = job('build');
    expect(build).toMatch(/mkdir -p "\$RUNNER_TEMP\/out"/);
    expect(build).toMatch(/--user "\$\(id -u\):\$\(id -g\)" -v "\$RUNNER_TEMP\/out:\/out"/);
    expect(build).toMatch(/--output \/out\/report\.json/);
    expect(build).toMatch(/test -s "\$RUNNER_TEMP\/out\/report\.json"/);
  });

  it('A08-05: one build for both platforms, smoke-tested per platform, handed to the push job by digest', () => {
    const build = job('build');
    const push = job('push');
    // Exactly one image build in the whole workflow, in the job that cannot write packages.
    expect(DOCKER_YML.match(/uses: docker\/build-push-action@/g)).toHaveLength(1);
    expect(build).toMatch(/uses: docker\/build-push-action@[0-9a-f]{40}/);
    expect(build).toMatch(/platforms: linux\/amd64,linux\/arm64/);
    expect(build).not.toMatch(/packages: write/);
    // The image goes to a registry on the runner only, pinned by digest.
    expect(build).toMatch(/image: registry:2@sha256:[0-9a-f]{64}/);
    expect(build).toMatch(/outputs: type=registry,name=localhost:5000\/mcp-review-check:test,oci-mediatypes=true/);
    expect(build).not.toMatch(/load: true|push: true/);
    expect(build).toMatch(/uses: docker\/setup-qemu-action@[0-9a-f]{40} # v\d/);
    // Every platform is executed, against the digest that is then exported.
    expect(build).toMatch(/for platform in linux\/amd64 linux\/arm64; do/);
    expect(build).toMatch(/--platform "\$platform"/);
    expect(build).toMatch(/image="localhost:5000\/mcp-review-check@\$DIGEST"/);
    expect(build).toMatch(/skopeo copy --all --preserve-digests/);
    expect(build).toMatch(/uses: actions\/upload-artifact@[0-9a-f]{40}/);
    expect(build).toMatch(/digest: \$\{\{ steps\.image\.outputs\.digest \}\}/);
    // The push job builds nothing: it copies the tested archive and checks the digest it pushed.
    expect(push).toMatch(/needs: build/);
    expect(push).toMatch(/packages: write/);
    expect(push).not.toMatch(/build-push-action|docker build|buildx build/);
    expect(push).toMatch(/uses: actions\/download-artifact@[0-9a-f]{40}/);
    expect(push).toMatch(/DIGEST: \$\{\{ needs\.build\.outputs\.digest \}\}/);
    expect(push).toMatch(/skopeo copy --all --preserve-digests/);
    expect(push).toMatch(/\[ "\$pushed" = "\$DIGEST" \]/);
    // The registry password goes over stdin, not argv.
    expect(push).toMatch(/--password-stdin/);
    expect(push).not.toMatch(/--dest-creds/);
  });

  it('A08-05: the workflow header no longer claims more than it checks', () => {
    expect(DOCKER_YML).toMatch(/same image, by digest/);
  });
});
