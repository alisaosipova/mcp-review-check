# W6G-core-followup remediation report (wave 6, 0.4.0)

Owned files: `src/rules/engine.ts`, `src/report/index.ts`, `src/rules/util/obs.ts`, `src/rules/auth.ts`, `src/protocol/trace.ts`, `src/connect.ts`, `test/remediation-w6g-*.test.ts`.
Also touched, additively and out of the owned list because the types live there: `src/snapshot.ts` (new optional fields `HttpExchange.jsonParsed`, `HttpExchange.oauthError`, `JsonRpcSummary.error.data`, `.resultInfo`, `.resultValue`) and two assertions in `test/remediation-w6d-core.test.ts` that encoded the old "probes keep `json`" behaviour. Not touched: CHANGELOG, `docs/design/spec.md`, `src/cli.ts`, `src/probe/*`, `src/protocol/modern.ts`.

## Done

| Item | What changed |
|---|---|
| 1. Engine, budget stop | `unfinishedPhases` reads `limits.stopped` or, failing that, `limits.budgetExhausted` (same `unfinished` list, same RUN_WIDE rule). A rule that read data of an unfinished phase and found nothing is skipped with the new `BUDGET_REASON = "snapshot budget exhausted"` (`STOPPED_REASON` is kept for `--max-duration`). `authReason` returns `BUDGET_REASON` for a `stopped` coverage with `limits.budgetExhausted`, else `STOPPED_REASON`. Findings made on partial data stay. |
| 2. Report | `verdict(...)` gets `incomplete` and `summary.failed` is true when `limits.budgetExhausted` is set (as for `limits.stopped`). `resultLine` returns `INCOMPLETE (snapshot budget exhausted during <phase>)` plus the gate reason / not-gated note. Score is null (coverage is `stopped`). |
| 3. rpcView / AUTH-021 without the body | `summarizeJsonRpc` now also keeps `error.data` (only if its JSON is at most 4096 chars), `resultInfo` (`isError`, length of `contents`) and, with the `keepResult` request option, `resultValue`. Exchanges get `jsonParsed: true` (body was a JSON object/array) and `oauthError` (string `error` of a JSON object body, 200 chars). `rpcView` falls back to `exchange.jsonRpc[0]` when `json` is absent (a synthetic `result` with `isError` / a `contents` array of the right length). AUTH-021 uses `jsonParsed` and `oauthError`. `connect.ts` `dropExchangeBodies(snap)` runs after the run (before redaction and capping): it copies the discover result into the discover summary (`resultValue`, the same object as `discoverRaw`, so no extra copy) and deletes `json` from every wire probe exchange and every `authProbe.active.token` exchange. PRM / AS metadata exchanges keep `json` (it is the snapshot field `prm.json` / `as[].json`, same object). Result: no exchange holds a separate full parsed body. The JSON report shape is unchanged (exchanges are not in it). |
| 4. Tests | `test/remediation-w6g-core-followup.test.ts`, 10 tests: engine skip and judged-as-usual cases, `--max-duration` reason unchanged, report verdict / `failed` / result line, summary contents, rpcView equality (body vs summary), SPEC-001/009/019 identical findings from body and from summary, AUTH-021 from `oauthError`/`jsonParsed`, `dropExchangeBodies`. |

## Exit code (cli.ts, not edited)

`src/cli.ts:510`: `snap.fatal ? 3 : snap.limits?.stopped ? 4 : values['fail-on-incomplete'] && partial ? 3 : report.summary.failed || failOnDrift ? 1 : 0`.
For a budget stop `limits.stopped` is unset, so it is never 4 (correct). `--fail-on-incomplete` gives 3 (coverage is `stopped`, so `partial` is true). Without it, the code follows `report.summary.failed`, which item 2 now sets to true for a budget stop, so the exit is **1 even at `--fail-on never`**. If it should follow only `--fail-on` (the gate), cli.ts needs `report.summary.failed` replaced there by a gate-only value (`report.summary.gate` has the reason but not the flag today) or `summary.failed` must exclude the budget case. Decision for the integrator. Other places that test `limits?.stopped` only and so ignore a budget stop: `src/report/junit.ts:48`, `src/report/github.ts:25` (annotation), `src/report/drift.ts:85` (uses `completed` of `stopped` only). Not owned; budget stops there read as a normal partial check.

## Deferred

| Item | Reason |
|---|---|
| `keepJson: true` in `src/probe/wire.ts`, `src/probe/auth.ts` (token POST) and `ModernRequestOptions` | not owned. The bodies are dropped after the run by `dropExchangeBodies` instead, so they are held only until the run ends (each capped at READ_CAP, 256 KB; discover at FULL_READ_CAP). A follow-up can drop the flags and pass `keepResult` for discover. |
| cli.ts / junit / github / drift handling of a budget stop | not owned, see above. |
| Pre-existing failures: `test/e2e-http.test.ts` "modern 2026-07-28 server: era detected, clean SPEC results" and "Mcp-Name is sent ..." (SPEC-022 info on the modern fixture) | caused by W6C's new SPEC-022 against the fixture, present before this package (unrelated to exchange bodies). The fixture should add `_meta["io.modelcontextprotocol/serverInfo"]` or the tests should allow SPEC-022. |

## Test commands

- `npm run typecheck`: passed. `npm run build`: passed.
- `npx vitest run test/remediation-w6g-*.test.ts test/remediation-w6d-*.test.ts test/remediation-w4c-*.test.ts test/max-duration.test.ts test/incomplete.test.ts test/rules/ test/real-servers.test.ts test/limits.test.ts` plus `test/remediation-wp4-*.test.ts test/e2e-http.test.ts test/auth-probe.test.ts test/engine.test.ts test/report.test.ts test/redact.test.ts`: 22 files, 557 passed, 2 failed (the two SPEC-022 e2e-http tests above). The required set alone (w6g, w6d, w4c, max-duration, incomplete, rules, real-servers, limits) passes; `real-servers.test.ts` shows the AUTH and obs rules unchanged on the frozen snapshots.

## Proposed CHANGELOG lines (`[Unreleased]`)

**Changed**
- A run that spent the snapshot byte budget is reported like a `--max-duration` stop: rules that read data of a phase the budget cut short and found nothing are skipped with "snapshot budget exhausted", the verdict is INCOMPLETE, `summary.failed` is true, and the result line reads `INCOMPLETE (snapshot budget exhausted during <phase>)`. It is not exit 4; `--fail-on-incomplete` makes it exit 3 (review F146).
- The wire probes and the active auth probe's token requests no longer keep the full parsed body once the run ends. The exchange summary carries what the rules read (error code, message and small `data`, `isError`, the size of `contents`, the discover result, an OAuth `error` string) (review F036).

## Proposed `docs/design/spec.md` paragraphs

**Snapshot byte budget (append to §4.2)**: When the budget runs out the engine treats `limits.budgetExhausted.unfinished` like `limits.stopped.unfinished`: a rule that reads data of an unfinished phase and finds nothing is skipped with reason `snapshot budget exhausted`, and findings made on partial data are kept. The verdict is INCOMPLETE and the run counts as failed in `summary.failed`. The exit code is never 4 for a budget stop.

**Exchanges (append to §4.x)**: `jsonRpc` entries also carry `error.data` (up to 4096 characters of JSON), `resultInfo` (`isError`, `contents` length) and, for the discover probe, `resultValue` (the same object as `discoverRaw`). `jsonParsed` is true when the body was a JSON object or array; `oauthError` is the string `error` member of such an object. After the run no probe or token exchange keeps `json`.
