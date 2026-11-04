// 0.5.0 docs split: every relative link in README.md and docs/guide/*.md resolves to a file and an anchor, the YAML
// files and the YAML recipes in the guide parse, the Dockerfile and the pre-commit hook have the documented shape.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GUIDE_DIR = join(ROOT, 'docs', 'guide');
const guideFiles = readdirSync(GUIDE_DIR).filter((f) => f.endsWith('.md')).sort();
const DOCS = [join(ROOT, 'README.md'), ...guideFiles.map((f) => join(GUIDE_DIR, f))];
const read = (p: string) => readFileSync(p, 'utf8');

/** Lines outside fenced code blocks. */
function prose(text: string): string[] {
  let fence = false;
  return text.split('\n').filter((l) => {
    if (l.startsWith('```')) { fence = !fence; return false; }
    return !fence;
  });
}
/** GitHub's heading anchor: lower case, punctuation dropped, spaces to hyphens. */
const slug = (h: string) => h.trim().toLowerCase().replace(/[^\w\- ]/g, '').replace(/ /g, '-');
const anchorsOf = (file: string) => new Set(prose(read(file)).flatMap((l) => (/^#{1,6} (.*)/.exec(l) ? [slug(l.replace(/^#+ /, ''))] : [])));
/** Markdown links `[text](target)` in prose, inline code removed. */
const linksOf = (file: string) => prose(read(file)).flatMap((l) => [...l.replace(/`[^`]*`/g, '').matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]));

describe('README and docs/guide links', () => {
  it('the guide has the planned pages', () => {
    expect(guideFiles).toEqual(['auth.md', 'ci.md', 'listings.md', 'options-and-config.md', 'privacy-and-requests.md', 'troubleshooting.md', 'walkthrough.md']);
  });

  for (const file of DOCS) {
    it(`every relative link in ${file.slice(ROOT.length)} resolves to a file and an anchor`, () => {
      const bad: string[] = [];
      for (const target of linksOf(file)) {
        if (/^(https?:|mailto:)/.test(target)) continue;
        const [path, anchor] = target.split('#');
        const dest = path ? resolve(dirname(file), path) : file;
        if (!existsSync(dest)) { bad.push(`${target}: no such file`); continue; }
        if (anchor && dest.endsWith('.md') && !anchorsOf(dest).has(anchor)) bad.push(`${target}: no such anchor`);
      }
      expect(bad).toEqual([]);
    });
  }

  it('the README links to every guide page', () => {
    const readme = read(join(ROOT, 'README.md'));
    for (const f of guideFiles) expect(readme, f).toContain(`docs/guide/${f}`);
  });

  it('the README keeps the sections the CLI and other files point to', () => {
    const heads = anchorsOf(join(ROOT, 'README.md'));
    for (const a of ['quick-start', 'usage', 'exit-codes', 'token-recipe', 'example-output', 'guide', 'stability-policy', 'limitations-and-disclaimer', 'license']) expect(heads.has(a), a).toBe(true);
  });

  it('the troubleshooting page covers proxy, CA and exit codes', () => {
    const t = read(join(GUIDE_DIR, 'troubleshooting.md'));
    for (const word of ['NODE_EXTRA_CA_CERTS', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'inconclusive', '--max-duration', 'Windows']) expect(t, word).toContain(word);
  });
});

/** Indentation lint for YAML written by hand: no tabs, even indentation outside block scalars, no trailing garbage. */
function lintYaml(text: string): string[] {
  const errors: string[] = [];
  let blockIndent = -1;
  text.split('\n').forEach((line, i) => {
    if (/\t/.test(line)) errors.push(`line ${i + 1}: tab`);
    if (!line.trim()) return;
    const ind = line.length - line.trimStart().length;
    if (blockIndent >= 0) { if (ind > blockIndent) return; blockIndent = -1; }
    if (line.trimStart().startsWith('#')) return;
    if (ind % 2) errors.push(`line ${i + 1}: odd indentation`);
    if (/(:|\|)\s*$/.test(line.replace(/\s#.*$/, '')) && /[|>][-+]?\s*$/.test(line)) blockIndent = ind;
  });
  return errors;
}
const python = spawnSync('python3', ['-I', '-c', 'import yaml'], { encoding: 'utf8' }).status === 0;
function pyParse(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'p5b-yaml-'));
  try {
    const f = join(dir, 'in.yml');
    writeFileSync(f, text);
    const r = spawnSync('python3', ['-I', '-c', 'import sys,yaml; yaml.safe_load(open(sys.argv[1]))', f], { encoding: 'utf8' });
    return r.status === 0 ? '' : r.stderr.trim().split('\n').pop() ?? 'failed';
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe('YAML files', () => {
  const files = ['.pre-commit-hooks.yaml', '.github/workflows/docker.yml'];
  for (const f of files) {
    it(`${f} is well-formed`, () => {
      const text = read(join(ROOT, f));
      expect(lintYaml(text)).toEqual([]);
      if (python) expect(pyParse(text)).toBe('');
    });
  }

  it('the pre-commit hook has the documented shape', () => {
    const t = read(join(ROOT, '.pre-commit-hooks.yaml'));
    expect(t).toMatch(/^- id: mcp-review-check$/m);
    for (const l of ['entry: mcp-review-check', 'language: node', 'pass_filenames: false', 'always_run: false']) expect(t).toContain(l);
    const files = /^ {2}files: '(.*)'$/m.exec(t)?.[1];
    expect(files).toBeDefined();
    const re = new RegExp(files!);
    for (const ok of ['mcp-review-check.config.json', '.mcp-review-check.json', 'plugin/.claude-plugin/plugin.json', '.mcp.json']) expect(re.test(ok), ok).toBe(true);
    expect(re.test('src/index.ts')).toBe(false);
  });

  it('every complete YAML recipe in the guide parses', () => {
    let n = 0;
    for (const file of DOCS) {
      for (const m of read(file).matchAll(/^```ya?ml\n([\s\S]*?)^```/gm)) {
        const code = m[1];
        // Fragments (indented steps, a single list item) are not documents.
        if (/^\s/.test(code) || /^- /.test(code)) continue;
        n++;
        expect(lintYaml(code), `${file.slice(ROOT.length)}: ${code.split('\n')[0]}`).toEqual([]);
        if (python) expect(pyParse(code), `${file.slice(ROOT.length)}: ${code.split('\n')[0]}`).toBe('');
      }
    }
    expect(n).toBeGreaterThanOrEqual(6);
  });

  it('the GitLab recipe is complete: JUnit report, baseline cache, pinned minor', () => {
    const ci = read(join(GUIDE_DIR, 'ci.md'));
    const gl = /## GitLab CI[\s\S]*?```yaml\n([\s\S]*?)```/.exec(ci)?.[1] ?? '';
    for (const s of ['stages:', 'image: node:22', 'reports:', 'junit: mcp-review-check.xml', 'cache:', '.mcp-review-check/', '--baseline', '--save-baseline', 'when: always']) expect(gl, s).toContain(s);
  });
});

describe('Dockerfile', () => {
  const d = read(join(ROOT, 'Dockerfile'));
  it('is multi-stage on a pinned node:22-alpine and installs the published package', () => {
    expect(d.match(/^FROM node:22-alpine@sha256:[0-9a-f]{64}/gm)?.length).toBe(2);
    expect(d).toMatch(/^ARG VERSION$/m);
    expect(d).toContain('npm install --global --ignore-scripts');
    expect(d).toContain('"mcp-review-check@${VERSION}"');
  });
  it('runs as a non-root user with the CLI as entrypoint', () => {
    expect(d).toMatch(/^USER (?!root)\S+$/m);
    expect(d).toMatch(/^ENTRYPOINT \["mcp-review-check"\]$/m);
  });
  it('.dockerignore keeps the build context to the Dockerfile', () => {
    expect(read(join(ROOT, '.dockerignore'))).toMatch(/^\*$/m);
  });
});

describe('docker.yml smoke test', () => {
  const text = read(join(ROOT, '.github/workflows/docker.yml'));
  const build = text.slice(text.indexOf('\n  build:'), text.indexOf('\n  push:\n    needs'));
  const pushJob = text.slice(text.indexOf('\n  push:\n    needs'));
  it('runs the built image (version, listing-only run, non-root) in a job the push job needs', () => {
    // Review round 3, A08-05: the build job pushes only to a registry on its runner and tests every platform of that
    // digest; the push job copies that image (test/r3-p8-pipeline.test.ts).
    expect(build).toMatch(/outputs: type=registry,name=localhost:5000\//);
    expect(build).toMatch(/docker run --rm --pull always --platform "\$platform"/);
    expect(build).toMatch(/run "\$image" --version/);
    expect(build).toMatch(/--plugin-dir \/listing\/plugin-valid/);
    expect(build).toMatch(/--entrypoint id "\$image" -u/);
    expect(build).not.toMatch(/packages: write/);
    expect(pushJob).toMatch(/needs: build/);
    expect(pushJob).toMatch(/skopeo copy --all --preserve-digests "oci-archive:/);
  });
});
