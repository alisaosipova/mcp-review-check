# Q4 (1.1.0): transport and release pipeline

Branch `r110-Q4`, on `origin/main` 85e74ac. The WIP commit `r110-wip-4` (session tracking in `src/connect.ts`, not
wired) was applied with `cherry-pick -n`, completed and committed as Q4-SESSION. No CHANGELOG, version or spec edits.

## Q4-SESSION: end Streamable HTTP sessions on a stop

- Defect (reproduced): a run stopped by `--max-duration`, the byte budget or SIGINT/SIGTERM closed its SDK clients
  without the DELETE the regular path sends, so a stateful server kept the session. Before the fix the new test sees
  no DELETE (3 of 5 tests fail on the old `connect.ts`).
- `src/connect.ts`: every Streamable HTTP connection whose server issued an `Mcp-Session-Id` is tracked (per run, by
  tracer, and process-wide). The stop in `withStops` ends the run's sessions next to `endChildren`; `endAllNow` (the
  CLI's signal handler) ends every open session. The DELETE goes out on global fetch (so the proxy dispatcher applies),
  with the connection's own headers (`--header`, `--bearer`), `mcp-session-id` and `mcp-protocol-version`,
  `redirect: 'manual'`, one attempt, all in parallel, bounded by `SESSION_END_TIMEOUT_MS` (1500 ms); the answer is
  ignored. A session leaves the sets when it is ended, so it gets one DELETE: the regular `endSession` skips the SDK
  DELETE of a session a stop or signal already ended; a second signal sends none. A session opened after the stop
  (an initialize still in flight) is ended at once. No session id: no DELETE. The stop's DELETEs are not recorded (the
  snapshot is copied at the stop) and appear in no output, so there is nothing new to redact.
- Tests: `test/r110-q4-session.test.ts` (5): DELETE with id, protocol version and bearer after a stop, and not in the
  snapshot; no DELETE without a session id; an unanswered DELETE holds the stop for at most the bound; a finished run
  sends no extra DELETE; `endAllNow` sends it once for a waiting run, also after the run gives up.

## Q4-GUARD: tag-release guard

- `scripts/release-guard.mjs` (+ `.d.mts`): the tagged commit must be on main (compare `main...<sha>` is `identical`
  or `behind`) and have a successful `ci.yml` run of a push to main (pull request and other branch runs do not count).
  A run still in progress is waited for (30 s polls, `RELEASE_GUARD_WAIT_SECONDS`, default 1800). Every failure is a
  `::error::` that says what to do (merge to main, wait for CI, tag the commit CI ran on).
- `release.yml`: new first job `guard` (`contents: read`, `actions: read`, checkout without credentials, node 24);
  `build` needs it.
- Tests: `test/r110-q4-release.test.ts` (decision table, the script against a fake GitHub API on 127.0.0.1 for pass /
  off main / red CI / still running, the token sent and never printed, the job shape via python3 yaml and text).

## Q4-PROVENANCE: verify the attestation content

- `scripts/verify-provenance.mjs` (+ `.d.mts`): reads `/-/npm/v1/attestations/mcp-review-check@<version>`, decodes the
  SLSA v1 in-toto statement and requires: subject `pkg:npm/mcp-review-check@<version>` with the sha512 of the tarball
  the build job made; workflow repository `https://github.com/<repo>`, path `.github/workflows/release.yml`, ref
  `GITHUB_REF`; event `push`; resolved dependency `git+<repo>@<ref>` with `gitCommit` = `GITHUB_SHA`; invocationId
  under `<repo>/actions/runs/<GITHUB_RUN_ID>/`. Shape checked against the real 1.0.0 attestation. One `::error::` per
  mismatch.
- `release.yml`: new job `provenance` (needs publish, `contents: read` only, downloads the `package` artifact);
  `gh-release` needs it. The OIDC `publish` job still runs no repository code; its existence check stays (it does the
  waiting for the registry).
- Tests: each mismatching field, missing SLSA attestation, bad payload, the script against a fake registry (pass,
  mismatch, 404), job order and permissions.

## Q4-DOCKER: docker.yml chained to the Release run

- `on: workflow_run: workflows: [Release], types: [completed]`; the build job runs only for `conclusion == 'success'`,
  `event == 'push'` and this repository (the push job needs build). The npm poll loop is gone (one `npm view` check
  remains). In a workflow_run run `GITHUB_REF_NAME`/`GITHUB_SHA` are main's, so the version comes from
  `workflow_run.head_branch` (through env, checked against a version-tag regex) and the checkout uses
  `workflow_run.head_sha`; build passes `version` to push. Smoke test and digest push unchanged.
- Tests: trigger, condition, version source, no event expression inside `run:`, tag regex, smoke test and digest push
  kept. Existing docker tests (`p5b-docs`, `r3-p8-pipeline`, `workflows`) pass unchanged.

## notFixed

None of the four items. Not done: cryptographic verification of the attestation signature (`npm audit signatures`
needs an install of the package and its dependencies; the content check trusts the registry's TLS). A follow-up could
add it to the `provenance` job.

## Integrator notes

- `docs/guide` / CONTRIBUTING release steps: a tag on a commit that is not the head of a green push to main now fails
  the release; tag after CI on main is green. docker.yml runs only after Release succeeds (re-run it from the Actions
  UI if needed). Nothing outside my files was changed. No new CLI option.
- workflow_run only uses the docker.yml from the default branch: the change takes effect once merged to main.

## Proposed CHANGELOG lines (1.1.0)

- Changed: a run stopped by `--max-duration`, the snapshot byte budget or Ctrl+C now ends the Streamable HTTP
  sessions the server issued (DELETE with the session id, best effort, at most 1.5 s).
- Changed (release pipeline): a release tag must point at a commit on main with a green CI run; the npm provenance
  attestation is checked to name this repository, `release.yml`, the tag commit, the run and the tarball's sha512;
  the Docker image is built after a successful Release run (workflow_run) instead of polling npm.
- Security: the provenance check and the tag guard (above).

## Proposed spec paragraph (transport, session end)

"When a run is stopped (deadline, byte budget, signal), every Streamable HTTP session for which the server returned an
`Mcp-Session-Id` is ended with one DELETE carrying that id, the negotiated `MCP-Protocol-Version` and the run's request
headers, without following redirects, in parallel, within 1500 ms; the response is ignored and not recorded. A session
receives at most one DELETE."

## Tests run

- `npm run typecheck`, `npm run build`: clean.
- `npx vitest run` on r110-q4-session, r110-q4-release, max-duration, remediation-w5c-connect, r3-p2-transport,
  lifecycle, workflows, p5b-docs, r3-p8-pipeline, remediation-w4d-action, p5a-proxy, remediation-wp2-connect:
  12 files, 169 tests passed. e2e-http, remediation-w4c-connect, remediation-w3a-connect, remediation-wp3-probe:
  4 files, 76 passed. New: 5 (session) + 19 (release) tests.
