# W5C-connect remediation report (wave 5, 0.3.0)

Branch `worktree-agent-a7ee1eb1e2a89cb91`. Owned files: `src/limits.ts`, `src/connect.ts`, `src/probe/**`, `src/snapshot.ts`, `test/remediation-w5c-*.test.ts`. Changed: `src/limits.ts`, `src/probe/network.ts`, `src/probe/wire.ts`, new `test/remediation-w5c-connect.test.ts` (8 tests). `src/connect.ts` and `src/snapshot.ts` needed no change. CHANGELOG, `docs/design/spec.md`, README, `src/cli.ts` and the rules were not touched.

## Done

| ID | Commit | What changed |
|---|---|---|
| F146 (rest beyond lite) | ce31cd9 | `capStrings` is exported from `src/limits.ts`. The new `capValue(value, cap, where, out)` cuts a string, or every string inside an object or array in place. Both keep the structure and record the cut the way the other caps do. `capSnapshot` now also applies TEXT_CAP to `active.calls[].args`, `active.calls[].jsonRpcError` (message and `data`) and `active.calls[].transportError`. Each cut is recorded in `limits.truncated` as `tools/call <tool> args`, `tools/call <tool> JSON-RPC error` and `tools/call <tool> transport error`. `transport.observedErrors` is capped as a whole, with one record `observed JSON-RPC errors` (the longest string). That covers `message`, and also a string `code` or `responseId`, which SPEC-016 quotes in its finding text. A stopped snapshot goes through the same `redactDeep` → `capSnapshot` path in `buildSnapshot`. The JSON report shape is additive: same fields, shorter strings, more `limits.truncated` entries. |
| R003: Origin probes on a stop | ec78d72 | `originProbes()` takes an optional `out` map (default: a new object) and writes each probe into it as soon as the probe's request finishes. That happens before the best-effort session DELETE, because the probe itself is done by then. `out` is returned. `runWireProbes` passes its live `p`, which is `snap.transport.probes`, the same accumulator W4C added for the other wire probes, so `stoppedSnapshot` copies the probes already made. The phase is still `wire probes`, so `limits.stopped.unfinished` starts with it as in wave 4, and the engine's read tracking (`probes.<name>` missing → `wire probes`) works unchanged. |
| R003: partial `clientInfoVariants` | 37340d4 (test only) | Kept as is (wave-5 decision). A test pins it: if a stop comes during the variants, the finished calls are kept, `clientInfoVariants` is absent, and RT-012 is skipped with `stopped by --max-duration`. |

### Rules on the capped text (F146)

- **RT-001** (`errorText`: `jsonRpcError.message` + `data`, or the `isError` text). The stack-trace regexes find a trace anywhere in the first 16 KB, which is where a trace starts. `isGenericError` is anchored (`^…$`) and only matches short phrases, so a message over 16 KB was never generic. No rule matches on the tail of the text.
- **RT-003** checks `jsonRpcError !== undefined` and is unaffected. **RT-005** quotes `transportError` in its message: it is now at most 16 KB, where before it could be the whole SDK error. RT-002/004/006… read `result`, which was already capped.
- **SPEC-016** quotes `message.slice(0, 120)` (a prefix) and `JSON.stringify(code)`; the code is now capped too. The id comparison still holds, because our request ids are short and a cut long `responseId` still differs from them.
- Test "the rules reading the capped text still match on it" pins RT-001 (stack trace at the head of a 32 KB message), RT-005 and SPEC-016 on capped input.

### SRV-008 on partial Origin data (R003)

SRV-008 reads all four Origin probes through `probeExchange`. When some are missing, the read-tracking view marks `wire probes`:
- Probes made before the stop show a finding (for example `originNone` 200 and `originClaude` 403): SRV-008 reports it and counts as run. This is test "the probes before the hung one…": the stop came on `origin chatgpt.com`, and the claude.ai finding is kept.
- The probes made show nothing wrong (`originEvil` never answered): SRV-008 is skipped with `stopped by --max-duration`, not passed.
- The stop comes on the first probe: none are kept, and SRV-008 is skipped the same way.
- Before this change, a stop anywhere inside `originProbes()` dropped all four probes, so SRV-008 was always skipped.

## Deferred

| ID | Reason |
|---|---|
| F146 global byte budget | Still a design change (`feature:`). The run keeps full strings in memory until `capSnapshot`. This package only bounds what the rules and the report see. |
| F036 (full) | Not in this package (wave-4 decision stands). |

## Files changed

- `src/limits.ts`: `capStrings` exported; new `capValue`; `capSnapshot` caps `active.calls[].args/jsonRpcError/transportError` and `transport.observedErrors`.
- `src/probe/network.ts`: `OriginProbeName`; `originProbes(…, out?)` publishes each probe into `out` and returns it.
- `src/probe/wire.ts`: passes its live probe map to `originProbes`.
- `test/remediation-w5c-connect.test.ts`: new, 8 tests. Two of them, "probes before the hung one" and "nothing wrong … is no pass", fail with the old `Object.assign(p, await originProbes(…))`. This was checked by reverting the change locally.

## Test commands and results

- `npm run typecheck`: passed. `npm run build`: passed.
- `npx vitest run test/remediation-w5c-*.test.ts test/remediation-w4c-*.test.ts test/remediation-wp2-*.test.ts test/remediation-wp3-*.test.ts test/max-duration.test.ts test/limits.test.ts test/incomplete.test.ts test/remediation-wp1-cli.test.ts test/engine.test.ts test/e2e-http.test.ts test/remediation-wp8-tools-schema-rt.test.ts test/rules/runtime.test.ts`: 12 files, **243 passed**. The last five files are the runtime-rule tests from `grep -l "RT-0" test/*.test.ts test/rules/*.test.ts`.
- The full suite was not run. No existing test needed changing.

## Proposed CHANGELOG lines (`[Unreleased]` / 0.3.0)

Under **Fixed**:

- The input caps also cover the `--active` tool calls' arguments, JSON-RPC errors and transport errors, and the JSON-RPC errors observed during the run. Each long string is cut at 16 KB and the cut is listed under `limits.truncated` (`tools/call <tool> args`, `tools/call <tool> JSON-RPC error`, `tools/call <tool> transport error`, `observed JSON-RPC errors`). Before, a multi-megabyte error message reached the rules' pattern checks and the finding text whole.
- A run stopped by `--max-duration` during the Origin probes keeps the probes already made. SRV-008 reports what they show, or is listed as skipped (`stopped by --max-duration`) when they show nothing. Before, all four probes were lost.

## Proposed `docs/design/spec.md` paragraphs

**Limits section** (the input caps; replace the list of what TEXT_CAP covers with):

> TEXT_CAP (16 KB) applies to the listed tool, prompt, resource and resource-template metadata, `serverInfo`, `instructions`, the raw list pages, the text-only `tools/list`, the `--active` call results, and the 2026-07-28 results. It also applies to the `--active` call arguments (synthesized or from `--tool-args`; the structure is kept and only long strings are cut), the calls' JSON-RPC errors (`message` and `data`) and transport errors, and every field of the observed JSON-RPC errors. Identifier keys (`name`, `uri`, `pattern`, …) inside these get ID_CAP. Each cut adds one entry `{ where, length, cap }` to `limits.truncated` per object, with the longest string it cut: `tools/call <tool> args`, `tools/call <tool> JSON-RPC error`, `tools/call <tool> transport error`, `observed JSON-RPC errors` (one entry for the whole list). The rules that read error text match on its start (RT-001's stack-trace and generic-phrase checks), or quote a prefix (RT-005, SPEC-016), so the cut does not change their results.

**§3.3 Run flow, "Stopped by `--max-duration`"**: in the W4C paragraph, replace the sentence "Each wire probe and each `--active` call is in the snapshot as soon as it finishes." with:

> Each wire probe (each of the four Origin probes included) and each `--active` call is in the snapshot as soon as it finishes. The clientInfo variants (RT-012) are kept only as a full set: a stop while they run leaves `active.clientInfoVariants` out, and RT-012 is listed as skipped with `stopped by --max-duration`, because a partial set would compare uneven tool lists. SRV-008 on a stop inside the Origin probes reports what the probes already made show. If they show nothing, it is skipped the same way.

## Notes for the integrator

- No snapshot type changed. `ActiveCall.args` stays `unknown`, and `ObservedError` fields are unchanged.
- `originProbes`'s new last parameter is optional. The one other caller, `test/remediation-wp3-probe.test.ts`, is unchanged and passes.
- Remediation §8.3 rows "F146 beyond lite" and "R003: Origin probes lost on a stop" can be closed. "R003: partial `clientInfoVariants`" becomes "kept as is; documented" (the spec paragraph above).
