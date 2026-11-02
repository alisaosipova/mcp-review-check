# W4C-connect remediation report (wave 4)

Branch `worktree-agent-abacd8763566a28b0`. Owned files: `src/connect.ts`, `src/probe/active.ts`, `src/probe/wire.ts`, `src/rules/engine.ts`, `src/rules/spec.ts`, `src/protocol/trace.ts`, `src/protocol/modern.ts`, `src/snapshot.ts`. Regression tests are in `test/remediation-w4c-connect.test.ts` (14 tests). `src/limits.ts`, `src/cli.ts`, `src/rules/tools.ts`, README, CHANGELOG and `docs/design/spec.md` were not touched.

## Done

| ID | Commit | What changed |
|---|---|---|
| F024 / R010 (SPEC-016 part) | 36f617a | `collectErrors` (connect.ts, now exported) also records a successful response whose `id` is not the request's. The entry is `{ source, requestId, responseId, modern, result: true, method }` and has no `code`. The comparison is strict (`!==`), so a string `"6"` answering request `6` is recorded too, the same way SPEC-016 already treats error responses. A message that has a `method` is a server request or notification, not a response, and is ignored. SDK traffic (`sdk …` labels) is left out as before. `ObservedError` gains the optional `result` and `method` fields. SPEC-016 skips the code checks for a `result` entry and reports a **warning**: `<source>: result answers another request id (response id 999, request id 4)`. That is the same severity as the existing id check on error responses, so the severity principle is unchanged. |
| R003 (rest) | 4e8ddb2 | See "R003: how it works" below. `runWireProbes` takes `out` and `runActive` takes `into`. connect.ts passes the live `snap.transport.probes` and a live `snap.active = { calls: [] }`, so each finished probe and each finished call is in the snapshot as soon as it completes. `stoppedSnapshot` copies `active.calls`; the probes, observed errors and modern results were already copied. `Progress.completed` records each phase when the run moves on to the next one. `limits.stopped` gains `completed` (the phases that ran to their end) and `unfinished` (the phase that was cut short plus every later phase in `PHASES` order). The engine runs a rule against a read-tracking view of a stopped snapshot. A rule that read data of an unfinished phase keeps its findings. If it found nothing, it is skipped with reason `stopped by --max-duration` and is not counted in `rulesRun`. The `active` need lets the RT rules run on calls that were kept, where before they were all skipped because of the `stopped` coverage. |
| F146 (lite) | ea90e70 (tests only) | Already in place: `capSnapshot` cuts `active.calls[].result` (object or string), `transport.modernResults` and `listMeta[*].rawPages` to TEXT_CAP and records each cut in `limits.truncated`. This came from e5a36bd in wave 1 (R024–R028, F013, F139). A stopped snapshot goes through the same `redactDeep` → `capSnapshot` path in `buildSnapshot`. The new tests pin both: one checks the cap directly, and the stopped `--active` run checks `tools/call fast_lookup result` (20 KB, cut at the 16 KB TEXT_CAP) in `limits.truncated`. No code changed. |
| F036 (lite) | ea90e70 (tests only) | Already in place: `finishBody` → `snippetOf` (51059e5, wave 1) scrubs a prefix of the body that starts at `SNIPPET + 3 × longest secret + 13` and doubles until the scrubbed prefix is long enough. This is a stricter version of `text.slice(0, SNIPPET + maxSecretLen)`: it also covers a secret cut at the end of the prefix. The parsed-JSON path is unchanged. The new test spies on `String.prototype.replace` and shows that an 8 MB body is never scanned whole. The existing redaction tests (`remediation-wp4-protocol`, `e2e-redaction`, `redaction-tiers`) pass. No code changed. |

### F024 / R010: which rule reports what

- **SPEC-020** keeps the listing case. When `ModernClient.listAll` gets a page under another id, the listing fails with `response id X does not match request id N`. If the capability is declared (or it is `tools` on a 2026-07-28-only server), SPEC-020 reports `tools/list failed: response id …` as an error. The failure blocks every tool check, so it belongs with the other listing failures.
- **SPEC-016** reports every other exchange: wire probes (`unknownMethod (modern)`, `badVersion (modern)`, `resourceMissing (modern)`, the legacy raw probes), `resources/read`, `resources/templates/list` (not in SPEC-020), a listing of an undeclared capability, and a fresh connection's re-list when the main listing succeeded.
- No double report: for a `result` entry whose `method` is `tools/list`, `resources/list` or `prompts/list`, SPEC-016 checks `listFailureReported(snap, method)` (exported from spec.ts). That helper uses the same `listFailure` condition SPEC-020 now uses, and requires the failure to be the id mismatch. When it holds, SPEC-016 drops the entry. This also covers the `headerMismatch*` probes and the fresh re-list, which send `tools/list` to a server that answers it under another id: SPEC-020 already names that defect for that method.
- Messages are deterministic: the probe label, the response id and the request id (the ModernClient's counter, which is fixed by the run's order).

### R003: how it works

The engine only does this for a snapshot with `limits.stopped`. A run whose deadline lands in `closing` is not marked as stopped, so it is unaffected. For such a snapshot, the engine passes `rule.check` a `Proxy` view and notes every unfinished phase whose data the rule reads:

| Data the rule reads | Counts as reading phase … | when |
|---|---|---|
| `transport.probes.<name>` that is missing, or any walk over `probes` (`Object.values`, `in`) | `wire probes` | probe missing or map enumerated |
| `listMeta.<key>` that is missing, or a walk over `listMeta`; `tools`/`resources`/`resourceTemplates`/`prompts` without their `listMeta` entry | `listing` | entry missing |
| `resourceReads.<uri>` that is missing, or a walk over it | `UI resource reads` | entry missing |
| `toolsRelist`, `toolsFreshConnection` / `toolsWithoutUi` / `authProbe` while undefined (set whole once their step finishes) | `tools re-list` / `text-only tools/list` / `auth probe` | undefined |
| `active` (filled call by call) | `active tool calls` | always |
| `transport.observedErrors`, `transport.modernResults` (gathered from every exchange) | the whole run | always, when stopped |
| `transport.tls` | `auth probe` | always |

The exchange log (`transport.exchanges`, `preflight`) and the latency samples (`timings`) are left out on purpose. They hold the requests that were actually made, and the rules over them (session ids, headers, latency) judge those requests. Treating them as unfinished would skip almost every HTTP rule on any stop.

Only the top level, `transport` and the keyed maps are wrapped. Everything a rule reaches below them is the snapshot's own objects, so identity checks and `JSON.stringify` behave as before. A run that was not stopped gets the plain snapshot: no proxy and no change. An older snapshot that has `limits.stopped` but no `unfinished` falls back to the stop phase plus every later phase in `PHASES` order.

Example (test "during wire probes"): stdio `callhang`, `--max-duration 2000`. The stop comes during `wire probes` after `unknownMethod`. `probes.unknownMethod` is kept. SPEC-009 (reads the missing `unknownTool`) and SPEC-016 (reads the partial `observedErrors`) are listed as skipped with `stopped by --max-duration`; before this change both silently passed. TOOL rules over the finished listing still run.

Example (test "during active tool calls"): the three `fast_lookup` calls finish and the `slow_lookup` call is in flight at the stop. `active.calls` keeps the three calls. RT-002 reports both invalid-input successes. RT-005 and the other RT rules that found nothing are skipped with `stopped by --max-duration`. Coverage stays `stopped`, so the verdicts stay INCOMPLETE (the existing `max-duration.test.ts` check still passes).

## Deferred

| ID | Reason |
|---|---|
| F146 (rest beyond lite) | needs `src/limits.ts`: `active.calls[].jsonRpcError` / `transportError` / `args` and `observedErrors[].message` are not capped. `capStrings` is not exported, and `capSnapshot` covers call results only. The global byte budget stays out of scope (`feature:` wave-4 decision). |
| F036 (full) | `feature:` stop keeping the whole parsed JSON of every exchange (the wave-4 plan keeps the minimal variant). |
| R003, `clientInfoVariants` | Published only when the variants step finishes. Partial variants (2 of 3 client names) would let RT-012 compare uneven sets. The calls themselves are kept. |
| R003, `originProbes` granularity | The origin probes come back from one `originProbes()` call in `src/probe/network.ts` (not owned). A stop inside that call drops the origin probes already made there. Every other probe is published one by one. |

## Files changed

- `src/snapshot.ts`: `ObservedError.result`, `ObservedError.method`; `PHASES`, `Phase`; `Limits.stopped.completed`, `Limits.stopped.unfinished`.
- `src/connect.ts`: `collectErrors` exported and recording result-id mismatches; `Progress.completed` and `advance()`; probes and active calls published into the live snapshot; `stoppedSnapshot` copies `active.calls` and writes `completed` / `unfinished`.
- `src/probe/wire.ts`: `WireContext.out`.
- `src/probe/active.ts`: `ActiveContext.into`.
- `src/rules/engine.ts`: `STOPPED_REASON`, `unfinishedPhases()`, the read-tracking view, the stopped-run skip, the `active` need on a stopped run.
- `src/rules/spec.ts`: SPEC-016 `result` entries; `listFailure()` shared with SPEC-020; `listFailureReported()` exported.
- `test/remediation-w4c-connect.test.ts`: new (14 tests).
- `src/protocol/trace.ts`, `src/protocol/modern.ts`: no change needed (see F036 and F024 above; ModernClient's `idMismatch` from W3A is used as is).

## Test commands and results

- `npm run typecheck`: passed. `npm run build`: passed.
- `npx vitest run test/remediation-w4c-*.test.ts test/remediation-wp2-*.test.ts test/remediation-wp3-*.test.ts test/remediation-wp4-*.test.ts`: 4 files, **90 passed**.
- `npx vitest run test/engine.test.ts test/incomplete.test.ts test/rules/spec.test.ts test/unit-wire.test.ts test/report.test.ts test/limits.test.ts test/remediation-w3a-connect.test.ts test/remediation-w3b-probe-rules.test.ts test/remediation-wp7-auth-spec-srv.test.ts test/max-duration.test.ts test/e2e-http.test.ts test/e2e-stdio.test.ts test/e2e-redaction.test.ts test/lifecycle.test.ts test/unit-legacy.test.ts test/compat.test.ts test/rules/runtime.test.ts test/redaction-tiers.test.ts`: 18 files, **369 passed**.
- The full suite was not run (D1). No existing test needed changing.

## Proposed CHANGELOG lines (`[Unreleased]`)

Under **Changed**/**Fixed**:

- SPEC-016 reports a successful response whose id is not the request's ("result answers another request id", warning), for example a wire probe answered under id 999. When the response is to a listing of a declared capability, the failure is SPEC-020's alone, so one exchange is not reported twice.
- A run stopped by `--max-duration` keeps the wire probes and `--active` tool calls that had finished, and the input caps apply to them. A rule that reads data of a phase the stop cut short reports what it found there. If it found nothing, it is listed as skipped ("stopped by --max-duration") instead of passing. Rules affected include SPEC-009, SPEC-016, SPEC-012/013 and the RT rules.
- The JSON report's `limits.stopped` gains `completed` (the phases that ran to their end) and `unfinished` (the phase cut short and the later ones). Each observed error for a mismatched result id carries `result: true` and the request `method`.

## Proposed `docs/design/spec.md` paragraphs

**§2.2, SPEC-016**: replace the id bullet with:

> - Response `id` differs from the request id and is not `null` → **warning**. Example: DeepWiki returns `"server-error"`.
> - A successful response (a `result`, no `error`) whose `id` is not the request's (strict comparison: `"6"` does not echo `6`) → **warning** "`<source>`: result answers another request id (response id X, request id Y)". Such an entry (`observedError.result: true`) has no `code`, so the code checks do not apply to it. When the response is to `tools/list`, `resources/list` or `prompts/list` and SPEC-020 reports that listing as failed because of the mismatch, SPEC-016 leaves it to SPEC-020.

**§3.3 Run flow** (new closing paragraph, "Stopped by `--max-duration`"):

> The run goes through the phases `connect`, `auth probe`, `listing`, `UI resource reads`, `wire probes`, `tools re-list`, `text-only tools/list` and `active tool calls`, skipping the ones it does not need. When `--max-duration` runs out, the report covers what ran. Each wire probe and each `--active` call is in the snapshot as soon as it finishes. The JSON-RPC errors and 2026-07-28 results seen so far are kept, and all of it goes through redaction and the input caps. `limits.stopped` names the phase that was cut short (`phase`), the phases that finished (`completed`) and the ones that did not (`unfinished`: the cut phase and every later one). A rule that reads data of an unfinished phase (a probe that never ran, the partial active calls, the observed errors or modern results gathered over the whole run, a listing, UI read, re-list or auth probe that did not finish) reports what it finds there. If it finds nothing, it is listed as skipped with `stopped by --max-duration` and is not counted as run, because finding nothing in partial data is not a pass. Rules over the request log and latency samples are judged on the requests that were made. A deadline that lands while connections are closing, after every check has run, does not mark the run as stopped.

**§4.2 Snapshot and rule contract** (additions to the type listing):

```ts
interface ObservedError {
  source: string; requestId?: unknown; responseId?: unknown; code?: unknown; message?: unknown; modern?: boolean;
  result?: boolean;   // a successful response whose id is not the request's (no code)
  method?: string;    // the request's method, on result entries
}
const PHASES = ['connect', 'auth probe', 'listing', 'UI resource reads', 'wire probes', 'tools re-list', 'text-only tools/list', 'active tool calls'];
interface Limits {
  truncated: Array<{ where: string; length: number; cap: number; unit?: 'items' }>;
  stopped?: { maxDurationMs: number; phase: string; completed?: string[]; unfinished?: string[] };
}
```

## Notes for the integrator

- W4A (`src/cli.ts`, exit 4 for a stopped run) can read `limits.stopped` as before; the new fields are additive.
- The engine's skip reason is exactly `stopped by --max-duration` (exported as `STOPPED_REASON`), the same string `authReason` returns for `stopped` coverage. Reports that group skip reasons therefore show a single group.
