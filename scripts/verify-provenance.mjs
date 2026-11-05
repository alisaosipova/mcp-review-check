#!/usr/bin/env node
// Provenance content check (release.yml, job "provenance"; Q4-PROVENANCE): the SLSA provenance the registry serves for
// the version just published must describe THIS run, not only exist. Its in-toto statement must name the package
// version and the sha512 of the tarball the build job made, and its predicate the repository, the workflow file
// .github/workflows/release.yml, the tag, the commit, a push event and this run's id. Anything else fails the release
// before the GitHub release is created.
//
// Usage (in the workflow): node scripts/verify-provenance.mjs <tarball>
// Environment: GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_REF, GITHUB_REF_NAME, GITHUB_RUN_ID; GITHUB_SERVER_URL
// (default https://github.com); NPM_REGISTRY (default https://registry.npmjs.org); PROVENANCE_ATTEMPTS (default 20).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PACKAGE = 'mcp-review-check';
export const WORKFLOW_PATH = '.github/workflows/release.yml';
export const SLSA_V1 = 'https://slsa.dev/provenance/v1';

/**
 * The in-toto statement of the SLSA provenance attestation in the registry's attestations document
 * (GET /-/npm/v1/attestations/<name>@<version>), or a string saying why there is none.
 * @param {unknown} doc
 * @returns {Record<string, any> | string}
 */
export function slsaStatement(doc) {
  const list = /** @type {any} */ (doc)?.attestations;
  if (!Array.isArray(list)) return 'the attestations document has no attestations list';
  const a = list.find((x) => x?.predicateType === SLSA_V1);
  if (!a) return `no ${SLSA_V1} attestation (found: ${list.map((x) => x?.predicateType).join(', ') || 'none'})`;
  const env = a.bundle?.dsseEnvelope;
  if (env?.payloadType !== 'application/vnd.in-toto+json' || typeof env.payload !== 'string') return 'the SLSA attestation has no in-toto DSSE payload';
  try { return JSON.parse(Buffer.from(env.payload, 'base64').toString('utf8')); } catch { return 'the SLSA attestation payload is not JSON'; }
}

/**
 * What in the provenance does not match this run; empty when it all does.
 * @param {unknown} doc the registry's attestations document
 * @param {{ version: string; sha512: string; repository: string; ref: string; sha: string; runId: string; server?: string }} want
 * @returns {string[]}
 */
export function checkProvenance(doc, want) {
  const st = slsaStatement(doc);
  if (typeof st === 'string') return [st];
  const server = want.server ?? 'https://github.com';
  const repoUrl = `${server}/${want.repository}`;
  const problems = [];
  const expect = (what, got, exp) => { if (got !== exp) problems.push(`${what} is ${JSON.stringify(got)}, expected ${JSON.stringify(exp)}`); };
  if (st.predicateType !== SLSA_V1) problems.push(`statement predicateType is ${JSON.stringify(st.predicateType)}`);
  const subjects = Array.isArray(st.subject) ? st.subject : [];
  const subject = subjects.find((s) => s?.name === `pkg:npm/${PACKAGE}@${want.version}`);
  if (!subject) problems.push(`no subject pkg:npm/${PACKAGE}@${want.version} (found: ${subjects.map((s) => s?.name).join(', ') || 'none'})`);
  else expect('subject sha512', subject.digest?.sha512, want.sha512);
  const def = st.predicate?.buildDefinition ?? {};
  const wf = def.externalParameters?.workflow ?? {};
  expect('workflow repository', wf.repository, repoUrl);
  expect('workflow path', wf.path, WORKFLOW_PATH);
  expect('workflow ref', wf.ref, want.ref);
  expect('event', def.internalParameters?.github?.event_name, 'push');
  const deps = Array.isArray(def.resolvedDependencies) ? def.resolvedDependencies : [];
  const source = deps.find((d) => typeof d?.uri === 'string' && d.uri.startsWith(`git+${repoUrl}@`));
  if (!source) problems.push(`no resolved dependency git+${repoUrl}@...`);
  else {
    expect('source uri', source.uri, `git+${repoUrl}@${want.ref}`);
    expect('source commit', source.digest?.gitCommit, want.sha);
  }
  const invocation = st.predicate?.runDetails?.metadata?.invocationId;
  if (typeof invocation !== 'string' || !invocation.startsWith(`${repoUrl}/actions/runs/${want.runId}/`)) {
    problems.push(`invocationId is ${JSON.stringify(invocation)}, expected ${repoUrl}/actions/runs/${want.runId}/attempts/<n>`);
  }
  return problems;
}

async function main(argv) {
  const tarball = argv[0];
  const e = process.env;
  const version = (e.GITHUB_REF_NAME ?? '').replace(/^v/, '');
  if (!tarball || !version || !e.GITHUB_REPOSITORY || !e.GITHUB_SHA || !e.GITHUB_REF || !e.GITHUB_RUN_ID) {
    console.log('::error::verify-provenance needs a tarball argument and GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_REF, GITHUB_REF_NAME, GITHUB_RUN_ID');
    return 1;
  }
  const sha512 = createHash('sha512').update(readFileSync(tarball)).digest('hex');
  const want = { version, sha512, repository: e.GITHUB_REPOSITORY, ref: e.GITHUB_REF, sha: e.GITHUB_SHA, runId: e.GITHUB_RUN_ID, server: e.GITHUB_SERVER_URL || undefined };
  const url = `${(e.NPM_REGISTRY || 'https://registry.npmjs.org').replace(/\/$/, '')}/-/npm/v1/attestations/${PACKAGE}@${version}`;
  const attempts = Number(e.PROVENANCE_ATTEMPTS ?? 20);
  let last = '';
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (res.ok) {
        const problems = checkProvenance(await res.json(), want);
        if (!problems.length) {
          console.log(`${PACKAGE}@${version}: the provenance names ${WORKFLOW_PATH} at ${e.GITHUB_REF} (${e.GITHUB_SHA.slice(0, 12)}), run ${e.GITHUB_RUN_ID}, and the tarball's sha512`);
          return 0;
        }
        for (const p of problems) console.log(`::error::${PACKAGE}@${version} provenance: ${p}`);
        return 1;
      }
      last = `HTTP ${res.status}`;
    } catch (err) { last = err instanceof Error ? err.message : String(err); }
    console.log(`attempt ${i}: no attestations for ${PACKAGE}@${version} yet (${last})`);
    if (i < attempts) await new Promise((r) => setTimeout(r, 15000));
  }
  console.log(`::error::${PACKAGE}@${version}: the registry served no attestations (${last})`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (err) => { console.log(`::error::verify-provenance: ${err instanceof Error ? err.message : String(err)}`); process.exit(1); });
}
