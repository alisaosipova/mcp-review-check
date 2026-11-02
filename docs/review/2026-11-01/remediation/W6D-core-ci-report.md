# W6D-core-ci remediation report (wave 6, 0.4.0)

Branch `worktree-wf_9e838c12-410-4`. Owned files: `src/protocol/**`, `src/connect.ts`, `src/limits.ts`, `src/probe/**`, `src/snapshot.ts` (additive), `.github/**`, `vitest.config.ts`, `test/remediation-w6d-*.test.ts`, and an env-guarded `skipIf` on two existing tests.

Files changed: `src/protocol/trace.ts`, `src/protocol/modern.ts`, `src/protocol/legacy.ts`, `src/connect.ts`, `src/limits.ts`, `src/probe/wire.ts`, `src/probe/auth.ts`, `src/snapshot.ts`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `vitest.config.ts`, `test/limits.test.ts` and `test/remediation-wp2-connect.test.ts` (one `skipIf` each), and the new `test/remediation-w6d-core.test.ts` (17 tests). I did not touch CHANGELOG, `docs/design/spec.md`, CONTRIBUTING, README or `src/rules/*`.

## Inventory of `exchange.json` readers (before the change)

Command: `grep -rn "\.json\b" src/rules src/connect.ts src/probe | grep -v "JSON\."`. I added the hits outside those directories by hand (`src/protocol/*`, `src/report/index.ts`).

| Location | Reads | Exchange JSON? | Now |
|---|---|---|---|
| `src/rules/tools.ts:559`, `src/rules/auth.ts:194,230,443` | `authProbe.prm.json` | no (a snapshot field) | unchanged; filled from the PRM GET, which keeps its body (`keepJson`) |
| `src/rules/auth.ts:23,25,251,444`, `src/rules/manual.ts:69`, `src/report/index.ts:94` | `authProbe.as[].json` | no (a snapshot field) | unchanged; filled from the AS metadata GET, which keeps its body |
| `src/rules/manual.ts:52` | the string `.app.json` | no | — |
| `src/rules/auth.ts:573,576` (AUTH-021) | `authProbe.active.token[].json` | **yes** (rules) | keeps the body: `probe/auth.ts` sends the token requests with `keepJson: true` |
| `src/rules/util/obs.ts:44` (`rpcView`, `probeRpc` in SPEC-001/007/008/009/010/014/019 …) | `transport.probes.<name>.json` | **yes** (rules) | keeps the body: the wire probes (`probe/wire.ts`: the modern probes and `badVersion`) and `discover` (`connect.ts`) are sent with `keepJson: true` |
| `src/probe/auth.ts:19,98,111,129` | PRM/AS metadata GET `ex.json` | yes | `keepJson: true` on `get()` and `getRetried()`. `prm.json` / `as.json` is the same object, so nothing is copied |
| `src/probe/auth.ts:186` | DCR `exchange.json.client_id` | yes | uses the `json` that `tracer.request` returns; the DCR exchange no longer keeps its body (no rule reads it, AUTH-019 reads `bodySnippet`) |
| `src/connect.ts:233` (`modernErrorBody`) | `sdk initialize` `json.error.code` | yes | the new `exchange.jsonRpc` summary |
| `src/connect.ts:316` (`collectErrors`) | every non-SDK exchange's messages | yes | `exchange.jsonRpc`, and `summarizeJsonRpc(e.json)` for an exchange that has only `json` (hand-built exchanges in tests) |
| `src/protocol/modern.ts:93` | `exchange.json` | yes | the `json` returned by `tracer.request` |
| `src/protocol/trace.ts:291,358` | `ex.json` (latency sample, BodyTimeout) | yes | the parsed value local to `finishBody` |

## Done

| Item | Commit | What changed |
|---|---|---|
| F036 full | af883fd, tests 531f712 | `finishBody` now stores on the exchange the masked `bodySnippet`, `bodyBytes` (bytes read), `bodySha256` (SHA-256 of the kept text; computed over the masked text when a known secret value occurs in it) and `jsonRpc` (one entry per response in the body: `id`, `result: true`, `method: true`, `error: {code, message}`, no result). It returns the parsed body once: `Tracer.request` returns `{ exchange, response, bodyBytes, json }`. The parsed body stays on `exchange.json` only with `keepJson`. `createTracer(…, opts)` takes `{ keepJson, budget }`. `keepJson` defaults to true, so a direct `createTracer` user and the existing `remediation-wp4-protocol` tests behave as before. `buildSnapshot` creates its tracer with `keepJson: false` and keeps the body only on the exchanges in the inventory above (wire probes, `discover`, auth metadata and token requests). The SDK traffic, listings, UI reads, active calls, preflight, origin, challenge, get/delete and DCR exchanges no longer hold a parsed copy. Their data is in `tools`/`listMeta.rawPages`, `resourceReads`, `transport.modernResults`, `active.calls`, `observedErrors`. The JSON report does not contain exchanges, so its shape does not change. `HttpExchange` gains only optional fields. |
| F146 full | af883fd, tests 531f712 | `SNAPSHOT_BUDGET = 64 MiB` and a `ByteBudget` (`createBudget`, `charge`, `budgetLeft`) in `src/limits.ts`. One budget per run (`Progress.budget`) is charged by: `readBody` in the tracer (kept bytes; the chunk that crosses the budget is cut there and the read ends); `capBody`, which the SDK reads over HTTP (the body errors with `snapshot budget exhausted`); and the stdio reader (`stdoutTap(r, onMessage)` counts each JSON-RPC message line of every connection; a line the SDK drops for exceeding STDIO_MAX_MESSAGE is not counted). `paginate` (the legacy SDK `listAll` and `ModernClient.listAll`) asks for no page once the budget is spent and ends the listing with that reason. `legacyReader` and `freshTools` read nothing more. `tracer.request` sends nothing more (`SnapshotBudget: … request not sent`), and `tracer.fetch` rejects. When the budget runs out, the same mechanism as a `--max-duration` stop (`withDeadline` → `withStops`) stops the run at that moment: abort, close, end children, copy the snapshot. Then `budgetStopped` records `limits.truncated` `{ where: "snapshot budget (N bytes over)", length, cap, unit: "bytes" }` and `limits.budgetExhausted { bytes, overBytes, phase, completed, unfinished }`. Coverage becomes `stopped` with reason `snapshot budget exhausted (B bytes) during <phase>`. With no handshake yet, it is `connect-failed` and `fatal = no handshake within the snapshot budget (B bytes)`. `limitsNotice` prints `snapshot budget of 64 MB exhausted during <phase> (N bytes over); later reads were skipped`. The rules and the report then run on what was observed: there is no throw and no exit 3 unless there was no handshake. `BuildOptions.snapshotBudget` (not a CLI option) lets the tests lower the budget. |
| Coverage job | 0cc29cb | New `coverage` job in `.github/workflows/ci.yml` (ubuntu-latest, Node 24, timeout 30 min): `npm ci --ignore-scripts`, `npm run build`, `npm run test:coverage` with `MCP_REVIEW_CHECK_COVERAGE=1` and `MCP_REVIEW_CHECK_SKIP_BUILD=1` (`continue-on-error: false`). It then uploads `coverage/` as artifact `coverage` (`if: !cancelled()`, pinned upload-artifact SHA as in release.yml, retention 14 days). `it.skipIf(!!process.env.MCP_REVIEW_CHECK_COVERAGE)` with a comment on exactly two tests: the 70 MB stdio overflow test (`test/remediation-wp2-connect.test.ts`) and the wall-clock test "pathological descriptions …" (`test/limits.test.ts`). Thresholds come from the measurement below. |
| release.yml | 2c2c185 | Removed the `Publish to npm (first release, NPM_TOKEN)` step and the `HAS_NPM_TOKEN` env. The trusted-publishing step is unconditional. The header comment says publishing is OIDC-only, that 0.3.0 was the first release published that way, and that no npm token is stored or read. Validated with PyYAML (`yaml.safe_load` of ci.yml, release.yml, audit.yml). `test/workflows.test.ts` passes. |

### Coverage measurement (once, on this tree)

`npm ci`, then `MCP_REVIEW_CHECK_COVERAGE=1 npm run test:coverage` (timeout 900 s). Result: 72 files passed, 1 skipped; 1307 tests passed, 6 skipped; 234 s; exit 0.

| Metric | Measured | Threshold (−5, rounded down) | Before |
|---|---|---|---|
| Statements | 93.98 | 88 | 88 |
| Branches | 88.46 | 83 | 82 |
| Functions | 94.86 | 89 | 89 |
| Lines | 97.72 | 92 | 92 |

## Deferred / follow-ups

| Item | Reason |
|---|---|
| Rules skipped with "snapshot budget exhausted" for unfinished phases | needs `src/rules/engine.ts`. Proposal: `unfinishedPhases` also reads `limits.budgetExhausted.unfinished`, and a rule that read only unfinished data and found nothing is skipped with reason `snapshot budget exhausted` (a second constant beside `STOPPED_REASON`). `authReason` should return `coverage.reason` for `stopped` instead of the fixed `stopped by --max-duration`. Until then, after a budget stop the coverage is `stopped` (score null, partial check). A rule that reads a missing probe passes silently, as before R003. |
| Verdict and `summary.failed` for a budget stop | needs `src/report/index.ts`: treat `limits.budgetExhausted` like `limits.stopped` (`!!snap.limits?.stopped` at lines 47 and 57). |
| `rpcView` without `exchange.json` | needs `src/rules/util/obs.ts`. It could read `jsonRpc` for id and error code. It also needs `error.data` (SPEC-001 reads `data.supported`) and the `discover` probe's result (SPEC-019 falls back to it when `discoverRaw` is unset), so the probes keep their body until the summary carries `error.data`. The probe bodies are read under READ_CAP (256 KB), except `discover` (FULL_READ_CAP, its result is also `discoverRaw`, the same object). |
| AUTH-021 without `exchange.json` | needs `src/rules/auth.ts`: the token body is OAuth JSON, not JSON-RPC. A small `oauthError` field (or `jsonKeys`) would let the token exchanges drop their body. |
| CONTRIBUTING.md "Trusted publishing" paragraph | needs `CONTRIBUTING.md` (W6E): it still describes the NPM_TOKEN fallback step. Proposed text below. |

## Test commands and results

- `npm run typecheck`: passed. `npm run build`: passed.
- `npx vitest run test/remediation-w6d-*.test.ts test/remediation-w4c-*.test.ts test/remediation-w5c-*.test.ts test/remediation-wp2-*.test.ts test/remediation-wp3-*.test.ts test/remediation-wp4-*.test.ts test/limits.test.ts test/max-duration.test.ts test/rules/*.test.ts test/real-servers.test.ts test/workflows.test.ts test/remediation-w4d-action.test.ts test/remediation-w5d-action.test.ts`: **20 files, 490 passed** (run after the last commit, without the coverage flag, so the two guarded tests ran).
- Subsystem check after the code change: `npx vitest run test/e2e-http.test.ts test/e2e-stdio.test.ts test/e2e-redaction.test.ts test/auth-probe.test.ts test/unit-wire.test.ts test/incomplete.test.ts test/compat.test.ts test/client-caps.test.ts test/remediation-w3a-connect.test.ts test/remediation-w3b-probe-rules.test.ts test/redaction-tiers.test.ts test/lifecycle.test.ts test/unit-legacy.test.ts test/engine.test.ts test/report.test.ts`: **15 files, 270 passed**.
- The one coverage measurement is above (the whole suite, with the coverage flag).

## Verified facts

- npm trusted publishing needs npm CLI 11.5.1+ and Node 22.14.0+, and `id-token: write` on GitHub Actions. "Publish uses OIDC - no token needed." Source: https://docs.npmjs.com/trusted-publishers (fetched 2026-11-02). release.yml installs npm 11.21.0, runs the publish job on Node 24, and keeps `id-token: write`.
- Vitest `coverage.thresholds`: a positive number is the minimum percentage required. `coverage.reportOnFailure` writes the report when tests fail. Source: https://vitest.dev/config/coverage (fetched 2026-11-02). vitest.config.ts already sets `reportOnFailure: true`, so the job uploads a report even when a threshold fails.

## Proposed CHANGELOG lines (`[Unreleased]`)

**Changed**
- The run no longer keeps the parsed body of every HTTP exchange. Each exchange has a masked snippet, its size, a SHA-256 and a summary of its JSON-RPC responses. Only the wire probes and the auth probe's metadata and token requests, which the rules read, keep the parsed body. Large listings and results are held once, in the snapshot (review F036).
- One byte budget per run (64 MiB over all HTTP bodies, SDK responses and stdio messages). Once it is spent, the read that crossed it stops, nothing more is sent or read, and the rules run on what was observed. The JSON report's `limits.truncated` gets a `snapshot budget (N bytes over)` entry (`unit: "bytes"`), and the new `limits.budgetExhausted` records the phase. The check is reported as partial (review F146).

**CI**
- New `coverage` job (Linux, Node 24) runs `npm run test:coverage` and uploads the report. The two timing-sensitive tests are skipped there (`MCP_REVIEW_CHECK_COVERAGE=1`). The branch threshold is now 83.
- `release.yml` publishes only through npm trusted publishing. The `NPM_TOKEN` first-release step was removed.

## Proposed `docs/design/spec.md` paragraphs

**§4.2 Input caps, new paragraph "Snapshot byte budget"**: A run reads at most `SNAPSHOT_BUDGET` (64 MiB) of server data, counted where it is kept: the bodies the tracer reads (the probes and the 2026-07-28 requests), the responses handed to the SDK over HTTP, and the JSON-RPC message lines of every stdio connection (a line over the 64 MB stdio buffer is dropped by the SDK and not counted). The read that crosses the budget stops at it. From then on no request is sent and no listing page is asked for. The run stops as on a `--max-duration` deadline: the snapshot holds what was observed until then, `limits.truncated` records `snapshot budget (N bytes over)` and `limits.budgetExhausted` records `{bytes, overBytes, phase, completed, unfinished}`. The coverage is `stopped` with reason `snapshot budget exhausted (B bytes) during <phase>`, or `connect-failed` with a fatal error if no handshake had completed.

**§4.x Exchanges**: An HTTP exchange records the request, the status, the headers, a masked 4 KB snippet, `bodyBytes`, `bodySha256` (over the masked text when a known secret occurs in it) and `jsonRpc`: one entry per JSON-RPC response with its id, error code and message, and flags for a result or a method. The parsed body (`json`) is kept only on the wire probes (`transport.probes`) and the auth probe's metadata and token requests, the exchanges whose bodies the rules read. Every other result lives once in the snapshot field built from it.

## Proposed CONTRIBUTING.md text (Trusted publishing paragraph)

> **Trusted publishing.** Releases publish only through npm trusted publishing: the trusted publisher is configured on npmjs.com (since 2026-11-02) for this repository, workflow `release.yml` and environment `npm`. No npm token is stored anywhere, and every release carries provenance. 0.3.0 was the first release published this way, and the `NPM_TOKEN` fallback step has been removed from `release.yml`. Do not create an `NPM_TOKEN` secret.
