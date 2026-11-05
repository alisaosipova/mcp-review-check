#!/usr/bin/env node
// Tag-release guard (release.yml, job "guard"; Q4-GUARD): a release tag may only point at a commit that is on main and
// has a successful CI run (ci.yml, a push to main). Read-only GitHub REST calls with the job's GITHUB_TOKEN
// (contents: read, actions: read). A CI run still in progress for the commit is waited for, up to
// RELEASE_GUARD_WAIT_SECONDS (default 1800); the guard fails with a message that says what to do otherwise.
//
// Usage (in the workflow): node scripts/release-guard.mjs
// Environment: GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_REF_NAME, GH_TOKEN; GITHUB_API_URL (default https://api.github.com).
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Whether the commit is on main, from the compare API's status of `main...<sha>`: "identical" (main is the commit)
 * or "behind" (the commit is an ancestor of main). "ahead" and "diverged" mean the commit is not on main.
 * @param {string | undefined} status
 */
export function onMain(status) {
  return status === 'identical' || status === 'behind';
}

/**
 * The guard's decision from the commit's CI runs (GET /actions/workflows/ci.yml/runs?head_sha=...).
 * @param {{ compareStatus?: string; runs: { status?: string; conclusion?: string | null; event?: string; head_branch?: string; html_url?: string }[]; sha: string; tag: string }} o
 * @returns {{ verdict: 'pass' | 'wait' | 'fail'; message: string }}
 */
export function decide({ compareStatus, runs, sha, tag }) {
  const short = sha.slice(0, 12);
  if (!onMain(compareStatus)) {
    return { verdict: 'fail', message: `${tag} points at ${short}, which is not on main (compare status: ${compareStatus ?? 'unknown'}). Merge the commit into main, wait for CI, then move the tag to a commit on main.` };
  }
  // Only runs of a push to main count: a pull request run tests a merge commit, not this commit.
  const main = runs.filter((r) => r.event === 'push' && r.head_branch === 'main');
  const green = main.find((r) => r.status === 'completed' && r.conclusion === 'success');
  if (green) return { verdict: 'pass', message: `${tag} (${short}) is on main and CI passed: ${green.html_url ?? 'ci.yml'}` };
  if (main.some((r) => r.status !== 'completed')) return { verdict: 'wait', message: `CI is still running for ${short}` };
  const failed = main.find((r) => r.status === 'completed');
  if (failed) return { verdict: 'fail', message: `CI did not pass for ${tag} (${short}): ${failed.conclusion} (${failed.html_url ?? 'ci.yml'}). Fix main and release from a green commit.` };
  return { verdict: 'fail', message: `no CI run of a push to main for ${tag} (${short}). Tag the commit CI ran on (the head of a push to main), or re-run CI on main for it.` };
}

async function api(path) {
  const base = process.env.GITHUB_API_URL || 'https://api.github.com';
  const res = await fetch(`${base}/repos/${process.env.GITHUB_REPOSITORY}${path}`, {
    headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${process.env.GH_TOKEN}`, 'x-github-api-version': '2022-11-28' },
    signal: AbortSignal.timeout(30000),
  });
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`GitHub API ${path.split('?')[0]}: HTTP ${res.status}`);
  return res.json();
}

async function main() {
  const sha = process.env.GITHUB_SHA ?? '';
  const tag = process.env.GITHUB_REF_NAME ?? '';
  if (!/^[0-9a-f]{40}$/.test(sha) || !process.env.GITHUB_REPOSITORY || !process.env.GH_TOKEN) {
    console.log('::error::release-guard needs GITHUB_REPOSITORY, GITHUB_SHA and GH_TOKEN');
    return 1;
  }
  const compare = await api(`/compare/main...${sha}`);
  const waitSeconds = Number(process.env.RELEASE_GUARD_WAIT_SECONDS ?? 1800);
  const until = Date.now() + waitSeconds * 1000;
  for (;;) {
    const list = await api(`/actions/workflows/ci.yml/runs?head_sha=${sha}&per_page=100`);
    const d = decide({ compareStatus: compare?.status, runs: list?.workflow_runs ?? [], sha, tag });
    if (d.verdict === 'pass') { console.log(d.message); return 0; }
    if (d.verdict === 'fail') { console.log(`::error::${d.message}`); return 1; }
    if (Date.now() >= until) { console.log(`::error::${d.message} after ${waitSeconds} s: re-run the release once CI has finished`); return 1; }
    console.log(`${d.message}; checking again in 30 s`);
    await new Promise((r) => setTimeout(r, 30000));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then((code) => process.exit(code), (e) => { console.log(`::error::release-guard: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
}
