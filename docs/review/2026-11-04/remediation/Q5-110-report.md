# Q5 (1.1.0): reports and probes, the 1.0.1 deferrals

Branch `r110-Q5`, on top of `85e74ac` (Release 1.0.1). The interrupted attempt's WIP (`r110-wip-5`) was applied with
`git cherry-pick -n`. Its report changes were correct and complete. They are kept as they were, split into commits,
and given tests. The probe item was not in the WIP; it was written in this session.

## Items

| Id | What changed | Tests |
|---|---|---|
| A10-01 native | `buildReport(..., failOnSpec, failOnIncomplete)` takes the flag. A partial check that still finished (not a failed connect, not a `--max-duration` stop) sets the new `Report.incompleteFails`, makes `summary.failed` true and adds `partial check: <level> (--fail-on-incomplete)` to `gate.reason`. `src/report/junit.ts` adds one `<error type="incomplete">` run case per suite, so the suite and total counts follow by construction. `src/report/github.ts` writes the partial-check annotation as `::error` and leaves out the advice to add the flag. `junitIncomplete`, `incompleteAnnotation`, the in-place `report.summary` rewrite and the now unused `xmlText` import are removed from `src/cli.ts`. `incompleteFails` is internal: `toJson` does not print it, so the JSON report has no new field for it. | `test/r110-q5-reports.test.ts` "A10-01 native" (3 cases: the gate and the cases it must leave alone, JUnit cases and counts, the annotation). The existing A10-01 tests are unchanged and pass: `remediation-w4a-exit-codes`, `r101-integration`, `r3-p1-cli-config`. |
| A03-03 (P3 deferral) `authProbe.active.clientId` | `toJson` adds `authProbe: { active: { clientId } }` only when `--active-auth` ran its probes (`snap.authProbe.active`). The value is `null` when the registration answer had no `client_id`. It never includes `client_secret` or `registration_access_token`. The field comes from the redacted report, so it is scrubbed like every other report string. `schema/report.schema.json` has the new `authProbe` object with "Since 1.1" descriptions and `additionalProperties: false`. | "authProbe.active.clientId" (3 cases: the field validates against the schema with Ajv, `null`, absent without `--active-auth`; the "Since 1.1" wording and no secret; redaction of a SYNTH bearer inside the id) |
| P1 deferral: `annotations()` through `visibleText` | No code change was needed. In 1.0.1, `annotations()` already passes the message, the fix and the title through `ciSafeText`, which is `visibleText` plus `##[` neutralising, before `escapeCommand` (A07-05). P1's note was about an older state. A regression test now pins this behaviour. It passes on 1.0.1 too: it is a guard, not a fix. | "annotations(): finding text through visibleText" (ESC, U+202E, U+2028, U+200B and a `##[group]` in the tool, message and fix) |
| A10-02 follow-up: challenge retry after a stall | `requestWithRetry` and `requestRetried` in `src/probe/network.ts` take `RetryOptions { retryTimeout?: boolean }`. With `false`, a timed-out attempt is not retried. Other transient failures (429, 5xx, reset) are still retried. `originProbes` and `challengeProbe` take the options and pass them on. `runWireProbes` (`src/probe/wire.ts`) has a new optional `WireContext.stalled`. When `stalled` is not given, it uses `listingTimedOut(snap.listMeta.tools?.error)`, the same test as `stalled()` in connect.ts, so the fix works without a change to connect.ts. After a stall, the four Origin probes and the challenge probe each wait one short wait, not two. They had the same retry, so they get the same fix (up to 5 x 2 s saved). | `test/r110-q5-probes.test.ts` (3 cases: `requestWithRetry` with and without the option; `runWireProbes` with a stalled snapshot, a healthy one and an explicit `stalled: true`, all through a tracer that always times out; `listingTimedOut`) |

## Not fixed

None. Everything on the work list is done inside Q5's files.

## Integrator notes (optional, outside Q5's files)

- `src/connect.ts` `buildHttp` (around line 525): pass the stall flag explicitly instead of letting wire.ts work it out
  again: `await runWireProbes({ snap, timeoutMs: probeTimeout, stalled: stall, ... })`. connect.ts could also drop its
  own `TIMED_OUT`/`MODERN_TIMED_OUT`/`timedOutListing` and import `listingTimedOut` from `./probe/wire.js`. Both
  regexes are copied into wire.ts as they are.
- `docs/guide/options-and-config.md`, `--active-auth` row: add "The JSON report names the registered client in
  `authProbe.active.clientId` (since 1.1), so you can delete it."

## Proposed CHANGELOG lines (1.1.0)

- Added: JSON report field `authProbe.active.clientId`: the `client_id` of the DCR client `--active-auth` registered,
  so it can be deleted (`null` if the server returned none; present only when the active auth probes ran). In the
  schema since 1.1.
- Changed: `--fail-on-incomplete` is now handled inside report building, so every format (text, JSON, markdown, JUnit,
  GitHub annotations) shows the failed run from one place. The output is the same as in 1.0.1.
- Fixed: after a server stops answering following initialize, a timed-out Origin or domain-challenge probe is no longer
  retried. Each costs one short (2 s) wait, not two.

## Proposed spec paragraphs

- JSON report: "`authProbe` (since 1.1) is present only when `--active-auth` ran its probes. `authProbe.active.clientId`
  is the `client_id` from the dynamic client registration answer, or `null`. Client secrets and registration access
  tokens are never in the report."
- Stalled server, added to the existing paragraph: "After a stall, a timed-out HTTP wire probe (the Origin probes and
  the domain challenge) is not retried. Other transient failures still are."
- `--fail-on-incomplete`: "buildReport applies it. The report is failed, `gate.reason` names the partial check, JUnit
  has one `<error type="incomplete">` test case per suite, and the GitHub partial-check annotation is an `::error`."

## Verification

- `npm run typecheck`: clean. `npm run build`: clean.
- New: `test/r110-q5-reports.test.ts` 7 passed; `test/r110-q5-probes.test.ts` 3 passed.
- Existing files of the modules changed, all passed:
  - CLI / A10-01: `remediation-w4a-exit-codes`, `r101-integration`, `r3-p1-cli-config`: 3 files, 42 tests.
  - Probes: `r3-p3-probes`, `r3-p2-transport`, `remediation-w3b-probe-rules`, `diagnostics`, `remediation-wp3-probe`, `unit-wire`: 6 files, 89 tests.
  - Reports: `r3-p4-protocol-engine`, `remediation-wp9-report-redact`, `lifecycle`, `r3-p7-schema`, `r3-p7-large-report`, `r3-p6-listings`, `redact`, `cta`, `remediation-w6g-core-followup`, `sarif`: 10 files, 126 tests.
  - Reports: `incomplete`, `r3-p7-review-fixes`, `remediation-w5a-junit`, `remediation-w6a-schema`, `r3-p7-ci-safe`, `root-causes`, `remediation-w4a-package`, `report`, plus `r110-q5-reports`: 9 files, 87 tests.
  - Total: 29 files, 347 tests, 0 failures. No existing test was changed.
- Fails-before: the new tests import `listingTimedOut` and call `buildReport` with its 8th argument, and they read
  `incompleteFails` and `authProbe`. On 85e74ac they fail on those. The visibleText test is a guard and passes on
  85e74ac as well (see above).
