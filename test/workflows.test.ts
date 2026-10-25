// The GitHub workflows keep write tokens away from the code they run. Workflows cannot run here (no
// GitHub repository yet), so this reads .github/workflows/*.yml line by line, by indentation, without a YAML
// dependency: every `uses:` is pinned to a commit SHA, every job has timeout-minutes, only the publish jobs get
// id-token: write or contents: write and they run no install scripts, tests or builds, checkout keeps no token,
// and npm is installed at an exact version.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DIR = fileURLToPath(new URL('../.github/workflows/', import.meta.url));
const FILES = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)).sort();

interface Job { file: string; name: string; lines: string[] }

const indent = (l: string) => l.length - l.trimStart().length;
/** Lines without comments and blank lines (a `#` after a space starts a comment; none of ours sit inside quotes). */
const code = (text: string) => text.split(/\r?\n/).map((l) => l.replace(/(^|\s)#.*$/, '').trimEnd()).filter((l) => l.trim());

/** The lines nested under the key line at index i (deeper indentation than the key). */
function block(lines: string[], i: number): string[] {
  const out: string[] = [];
  for (let j = i + 1; j < lines.length && indent(lines[j]) > indent(lines[i]); j++) out.push(lines[j]);
  return out;
}

function jobs(): Job[] {
  const out: Job[] = [];
  for (const file of FILES) {
    const lines = code(readFileSync(join(DIR, file), 'utf8'));
    const at = lines.findIndex((l) => l === 'jobs:');
    const body = block(lines, at);
    const base = Math.min(...body.map(indent));
    body.forEach((l, i) => { if (indent(l) === base) out.push({ file, name: l.trim().replace(/:$/, ''), lines: block(body, i) }); });
  }
  return out;
}

/** Top-level keys of a job (one indentation level below the job name). */
function key(job: Job, name: string): string[] | undefined {
  const base = Math.min(...job.lines.map(indent));
  const i = job.lines.findIndex((l) => indent(l) === base && l.trim().startsWith(`${name}:`));
  return i < 0 ? undefined : [job.lines[i], ...block(job.lines, i)];
}

/** Every job this one waits for, directly or through `needs:` of the jobs it needs. */
function after(job: Job, all: Job[], seen = new Set<string>()): string[] {
  const needs = (key(job, 'needs')?.[0].replace(/^\s*needs:\s*/, '') ?? '').replace(/[[\]\s]/g, '').split(',').filter(Boolean);
  for (const n of needs.filter((x) => !seen.has(x))) {
    seen.add(n);
    const dep = all.find((x) => x.file === job.file && x.name === n);
    if (dep) after(dep, all, seen);
  }
  return [...seen];
}
const writes = (job: Job) => (key(job, 'permissions') ?? []).filter((l) => /:\s*write$/.test(l)).map((l) => l.trim());
/** The steps of a job, each as its lines (a step starts with `- `). */
function steps(job: Job): string[][] {
  const lines = (key(job, 'steps') ?? []).slice(1);
  const out: string[][] = [];
  for (const l of lines) {
    if (l.trimStart().startsWith('- ') && indent(l) === indent(lines[0])) out.push([l]);
    else out[out.length - 1]?.push(l);
  }
  return out;
}

describe('GitHub workflows', () => {
  it('finds the workflows and their jobs', () => {
    expect(FILES).toEqual(['ci.yml', 'release.yml']);
    expect(jobs().length).toBeGreaterThanOrEqual(3);
  });

  it('every uses: is pinned to a 40-hex SHA', () => {
    const uses = FILES.flatMap((f) => code(readFileSync(join(DIR, f), 'utf8')).map((l) => l.match(/^\s*(?:-\s+)?uses:\s*(\S+)/)?.[1]).filter((u): u is string => !!u).map((u) => `${f}: ${u}`));
    expect(uses.length).toBeGreaterThan(0);
    expect(uses.filter((u) => !/@[0-9a-f]{40}$/.test(u))).toEqual([]);
  });

  it('every job has timeout-minutes', () => {
    expect(jobs().filter((j) => !/^timeout-minutes:\s*\d+$/.test(key(j, 'timeout-minutes')?.[0].trim() ?? '')).map((j) => `${j.file}: ${j.name}`)).toEqual([]);
  });

  it('only publish jobs get id-token: write or contents: write, and none of them runs npm ci, npm test or npm run build', () => {
    // No write permission at the workflow level: a job inherits it when it sets none of its own.
    for (const f of FILES) {
      const lines = code(readFileSync(join(DIR, f), 'utf8'));
      const at = lines.findIndex((l) => l === 'permissions:');
      expect(at, `${f}: top-level permissions`).toBeGreaterThanOrEqual(0);
      expect(block(lines, at).filter((l) => /write/.test(l)), f).toEqual([]);
    }
    const all = jobs();
    const writers = Object.fromEntries(all.filter((j) => writes(j).length).map((j) => [`${j.file}: ${j.name}`, writes(j)]));
    expect(writers).toEqual({ 'release.yml: publish': ['id-token: write'], 'release.yml: gh-release': ['contents: write'] });
    for (const j of all.filter((x) => writes(x).length)) {
      const run = j.lines.join('\n');
      expect(run, `${j.name} runs install scripts, tests or a build`).not.toMatch(/\bnpm\s+(ci|test|run\s+build|pack|install(?!\s+-g\s+npm@))\b/);
      expect(after(j, all), `${j.name} runs after the build job`).toContain('build');
    }
    // The build job that runs them can write nothing.
    const build = all.find((j) => j.file === 'release.yml' && j.name === 'build');
    expect(build && writes(build)).toEqual([]);
    expect(build?.lines.join('\n')).toMatch(/\bnpm ci\b[\s\S]*\bnpm test\b[\s\S]*\bnpm pack\b/);
  });

  it('every actions/checkout keeps no token in .git/config (persist-credentials: false)', () => {
    const checkouts = jobs().flatMap((j) => steps(j).filter((s) => /uses:\s*actions\/checkout@/.test(s[0])).map((s) => ({ at: `${j.file}: ${j.name}`, s })));
    expect(checkouts.length).toBeGreaterThan(0);
    expect(checkouts.filter(({ s }) => !s.some((l) => /^\s*persist-credentials:\s*false$/.test(l))).map(({ at }) => at)).toEqual([]);
  });

  it('npm install -g npm@ takes an exact version, not a range', () => {
    const installs = jobs().flatMap((j) => j.lines.map((l) => l.match(/npm install -g (npm@\S*)/)?.[1]).filter((v): v is string => !!v));
    expect(installs.length).toBeGreaterThan(0);
    expect(installs.filter((v) => !/^npm@\d+\.\d+\.\d+$/.test(v))).toEqual([]);
  });
});
