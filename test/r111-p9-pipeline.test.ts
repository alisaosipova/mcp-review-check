// Review round 4, package P9 (pipeline): the pre-commit hook, the tree check against npm-shrinkwrap.json, the pack and
// Docker smokes, the pinned build images, the image attestation, the publish job's npm and Dependabot. The workflows
// cannot run here, so their text is checked; scripts/check-tree.mjs runs against fixture trees.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), 'utf8');
const CHECK_TREE = fileURLToPath(new URL('scripts/check-tree.mjs', root));

/** One job of a workflow: from `  <name>:` to the next job or the end. */
function job(file: string, name: string): string {
  const text = read(`.github/workflows/${file}`);
  const at = text.indexOf(`\n  ${name}:\n`, text.indexOf('\njobs:\n'));
  if (at < 0) return '';
  const next = text.slice(at + 1).search(/\n {2}[a-z][\w-]*:\n/);
  return next < 0 ? text.slice(at) : text.slice(at, at + 1 + next);
}

/** The `version` input default of action.yml. */
const actionVersion = () => read('action.yml').match(/^ {2}version:\n(?: {4}.*\n)*? {4}default: '([^']+)'/m)?.[1];

describe('pre-commit hook (A08-01)', () => {
  const hooks = read('.pre-commit-hooks.yaml');

  it('runs the published package through npx at the action\'s default version and builds nothing', () => {
    expect(hooks).toMatch(/^- id: mcp-review-check$/m);
    expect(hooks).toMatch(/^ {2}language: system$/m);
    expect(hooks).not.toMatch(/^ {2}language: node$/m);
    const entry = hooks.match(/^ {2}entry: (.+)$/m)?.[1];
    expect(actionVersion()).toMatch(/^\d+\.\d+$/);
    expect(entry).toBe(`npx --yes mcp-review-check@${actionVersion()}`);
    expect(hooks).toMatch(/^ {2}pass_filenames: false$/m);
  });

  it('a CI job installs the hook with pre-commit from the tested commit and runs it on a clean and a failing server', () => {
    const ci = job('ci.yml', 'pre-commit');
    expect(ci).toMatch(/timeout-minutes: \d+/);
    expect(ci).toMatch(/pipx install pre-commit==\d+\.\d+\.\d+/);
    expect(ci).toMatch(/pre-commit validate-manifest \.pre-commit-hooks\.yaml/);
    expect(ci).toMatch(/repo: %s\\n {4}rev: %s/);
    expect(ci).toMatch(/"\$GITHUB_WORKSPACE" "\$sha"/);
    expect(ci).toMatch(/fixture good\n\s+pre-commit run --all-files\n/);
    expect(ci).toMatch(/fixture bad\n\s+if pre-commit run --all-files; then/);
    // The stub npx refuses anything but the hook's own call, and the call names the action's default version.
    expect(ci).toMatch(/\[\[ "\\\$2" == mcp-review-check@\* \]\] \|\| \{ echo "unexpected npx/);
    expect(ci).toMatch(/test "\$\(sort -u "\$RUNNER_TEMP\/npx-calls"\)" = "\$want"/);
  });
});

describe('the shipped dependency tree (A08-02, I-A08-3)', () => {
  it('the pack smoke runs npm ci in the extracted tarball, checks the tree and runs that copy', () => {
    const pkg = job('ci.yml', 'package');
    expect(pkg).not.toMatch(/npm install "\$RUNNER_TEMP"\/mcp-review-check-\*\.tgz/);
    expect(pkg).toMatch(/tar -xzf "\$RUNNER_TEMP"\/mcp-review-check-\*\.tgz -C "\$RUNNER_TEMP\/smoke"/);
    expect(pkg).toMatch(/npm pkg delete devDependencies\n\s+npm ci --omit=dev --ignore-scripts/);
    expect(pkg).toMatch(/node scripts\/check-tree\.mjs "\$RUNNER_TEMP\/smoke\/package"/);
    expect(pkg).toMatch(/node "\$RUNNER_TEMP\/smoke\/package\/dist\/cli\.js" --stdio/);
  });

  it('the Docker smoke checks the tree of the global install on every platform', () => {
    expect(job('docker.yml', 'build')).toMatch(/for platform in [\s\S]*-v "\$PWD\/scripts:\/scripts:ro" --entrypoint node "\$image" \/scripts\/check-tree\.mjs \/usr\/local\/lib\/node_modules\/mcp-review-check[\s\S]*done/);
  });

  describe('scripts/check-tree.mjs', () => {
    let dir = '';
    afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

    const pkgJson = (at: string, name: string, version: string) => {
      mkdirSync(at, { recursive: true });
      writeFileSync(join(at, 'package.json'), JSON.stringify({ name, version }));
    };
    /** A package dir with a shrinkwrap naming zod 4.1.0, a 1.0.0 and a's nested b 2.0.0. */
    const fixture = () => {
      dir = mkdtempSync(join(tmpdir(), 'r111-p9-tree-'));
      const pkg = join(dir, 'prefix', 'node_modules', 'mcp-review-check');
      pkgJson(pkg, 'mcp-review-check', '9.9.9');
      writeFileSync(join(pkg, 'npm-shrinkwrap.json'), JSON.stringify({
        name: 'mcp-review-check', version: '9.9.9', lockfileVersion: 3, requires: true,
        packages: {
          '': { name: 'mcp-review-check', version: '9.9.9' },
          'node_modules/zod': { version: '4.1.0' },
          'node_modules/@s/a': { version: '1.0.0' },
          'node_modules/@s/a/node_modules/b': { version: '2.0.0' },
          'node_modules/fsevents': { version: '2.3.3', optional: true },
        },
      }));
      return pkg;
    };
    const check = (pkg: string) => spawnSync(process.execPath, [CHECK_TREE, pkg], { encoding: 'utf8' });

    it('passes a nested tree that equals the shrinkwrap (an optional package for another OS may be absent)', () => {
      const pkg = fixture();
      pkgJson(join(pkg, 'node_modules', 'zod'), 'zod', '4.1.0');
      pkgJson(join(pkg, 'node_modules', '@s', 'a'), '@s/a', '1.0.0');
      pkgJson(join(pkg, 'node_modules', '@s', 'a', 'node_modules', 'b'), 'b', '2.0.0');
      const r = check(pkg);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain('check-tree: 4 packages match npm-shrinkwrap.json');
    });

    it('passes a hoisted tree (an install with --prefix), found as Node finds it', () => {
      const pkg = fixture();
      const top = dirname(pkg);
      pkgJson(join(top, 'zod'), 'zod', '4.1.0');
      pkgJson(join(top, '@s', 'a'), '@s/a', '1.0.0');
      pkgJson(join(top, 'b'), 'b', '2.0.0');
      const r = check(pkg);
      expect(r.status, r.stderr).toBe(0);
    });

    it('fails on another version, a missing package and an extra package, naming each', () => {
      const pkg = fixture();
      pkgJson(join(pkg, 'node_modules', 'zod'), 'zod', '4.99.0');
      pkgJson(join(pkg, 'node_modules', '@s', 'a'), '@s/a', '1.0.0');
      pkgJson(join(pkg, 'node_modules', 'left-pad'), 'left-pad', '1.3.0');
      const r = check(pkg);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('check-tree: mismatch node_modules/zod: installed 4.99.0, shrinkwrap 4.1.0');
      expect(r.stderr).toContain('check-tree: missing node_modules/@s/a/node_modules/b: shrinkwrap 2.0.0');
      expect(r.stderr).toContain('check-tree: extra node_modules/left-pad: installed 1.3.0, not in the shrinkwrap');
      expect(r.stderr).toContain('check-tree: 3 of 4 packages differ from npm-shrinkwrap.json');
    });

    it('a nested pin is not satisfied by a hoisted copy of another version', () => {
      const pkg = fixture();
      pkgJson(join(pkg, 'node_modules', 'zod'), 'zod', '4.1.0');
      pkgJson(join(pkg, 'node_modules', '@s', 'a'), '@s/a', '1.0.0');
      pkgJson(join(pkg, 'node_modules', 'b'), 'b', '3.0.0');
      const r = check(pkg);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('mismatch node_modules/@s/a/node_modules/b: installed 3.0.0, shrinkwrap 2.0.0');
    });

    it('is a usage error without a directory or without a shrinkwrap', () => {
      expect(spawnSync(process.execPath, [CHECK_TREE], { encoding: 'utf8' }).status).toBe(2);
      dir = mkdtempSync(join(tmpdir(), 'r111-p9-tree-'));
      const r = check(dir);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/npm-shrinkwrap\.json does not exist/);
    });
  });
});

describe('image build and publish (A08-04, I-A08-1, I-A08-2, I-A08-4)', () => {
  it('binfmt and BuildKit are pinned by digest, with the resolution date', () => {
    const build = job('docker.yml', 'build');
    expect(build).toMatch(/uses: docker\/setup-qemu-action@[0-9a-f]{40} # v[\d.]+\n\s+with:\n\s+image: tonistiigi\/binfmt:qemu-v[\d.]+@sha256:[0-9a-f]{64}\n/);
    expect(build).toMatch(/driver-opts: \|\n\s+network=host\n\s+image=moby\/buildkit:v[\d.]+@sha256:[0-9a-f]{64}\n/);
    expect(build).toMatch(/read from registry-1\.docker\.io on \d{4}-\d{2}-\d{2}/);
  });

  it('the push job attests the pushed digest, with id-token and attestations write in that job only', () => {
    const push = job('docker.yml', 'push');
    expect(push).toMatch(/uses: actions\/attest-build-provenance@[0-9a-f]{40} # v[\d.]+\n\s+with:\n\s+subject-name: \$\{\{ env\.IMAGE \}\}\n\s+subject-digest: \$\{\{ needs\.build\.outputs\.digest \}\}\n\s+push-to-registry: true/);
    expect(push).toMatch(/id-token: write/);
    expect(push).toMatch(/attestations: write/);
    expect(job('docker.yml', 'build')).not.toMatch(/id-token|attestations/);
    // The attestation comes after the digest check of the push step.
    expect(push.indexOf('attest-build-provenance')).toBeGreaterThan(push.indexOf('[ "$pushed" = "$DIGEST" ]'));
    expect(read('docs/guide/ci.md')).toMatch(/gh attestation verify oci:\/\/ghcr\.io\/alisaosipova\/mcp-review-check:[\d.]+ --owner alisaosipova/);
  });

  it('the publish job installs no npm: an exact Node 24 release and a check of its bundled npm', () => {
    const publish = job('release.yml', 'publish');
    expect(publish).not.toMatch(/npm install/);
    expect(publish).toMatch(/node-version: '24\.\d+\.\d+'/);
    expect(publish).toMatch(/npm --version/);
    expect(publish).toMatch(/older than 11\.5\.1/);
  });

  it('Dependabot watches the Dockerfile digests, without Node majors', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep).toMatch(/- package-ecosystem: docker\n\s+directory: \/\n\s+schedule:\n\s+interval: weekly\n\s+ignore:\n(?:\s+#.*\n)?\s+- dependency-name: node\n\s+update-types: \["version-update:semver-major"\]/);
  });
});

// The text checks above do not parse YAML; a plain scalar with ": " in it (an easy slip in a description) would break
// the file for GitHub. PyYAML, where present, parses every file this package edits.
const python = spawnSync('python3', ['-I', '-c', 'import yaml'], { encoding: 'utf8' }).status === 0;
describe.skipIf(!python)('the edited YAML files parse', () => {
  for (const f of ['action.yml', '.pre-commit-hooks.yaml', '.github/dependabot.yml', '.github/workflows/ci.yml', '.github/workflows/docker.yml', '.github/workflows/release.yml']) {
    it(f, () => {
      const r = spawnSync('python3', ['-I', '-c', 'import sys,yaml; yaml.safe_load(open(sys.argv[1], encoding="utf-8"))', fileURLToPath(new URL(f, root))], { encoding: 'utf8' });
      expect(r.status, r.stderr).toBe(0);
    });
  }
});
