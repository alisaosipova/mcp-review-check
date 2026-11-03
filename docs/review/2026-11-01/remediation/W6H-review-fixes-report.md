# W6H review fixes report (wave 6, 0.4.0)

Tests: `test/remediation-w6h-review-fixes.test.ts` (16 tests). Item 6 (NPM_TOKEN step in CONTRIBUTING.md and CHANGELOG) is left to the docs step.

## 1. SPEC-021 lookup table (medium)

`src/rules/spec.ts`: `DEPRECATED_REQUESTS` is a `Map`, and the SPEC-020 `scopes` table (keyed by a server result's method) is a `Map` too. The grep over `src/rules/spec.ts`, `src/rules/listing.ts` and `src/listing/` found no other table indexed by a server-controlled key.
Test: `item 1: SPEC-021 looks methods up without the prototype chain`.
CHANGELOG: Fixed: SPEC-021 no longer reports `constructor`, `toString` and other `Object.prototype` names as deprecated requests.

## 2. Budget stop is a partial check (medium)

- `authReason()` returns `snapshot budget exhausted (during <phase>)`; `unfinishedPhases()` already read `budgetExhausted` (W6G).
- `summary.failed` follows the `--fail-on` gate for a budget stop (still unconditional for `fatal` and `--max-duration`); verdicts stay INCOMPLETE; the Result line reads `INCOMPLETE (snapshot budget exhausted (during <phase>))`, the gate reason only when failed.
- `src/cli.ts`: the exit mapping needed no change (budget sets no `limits.stopped`, so never 4; `--fail-on-incomplete` gives 3); comment updated.
- JUnit: a suite property `incomplete` and a line in `<system-out>`, not an `<error>`. GitHub: the `::warning` partial-check annotation names the budget and the bytes. `drift.ts`: tools are compared when `listing` completed before the budget ran out.
- W6G's test line that asserted `failed === true` was changed to follow the gate.
Test: `item 2: a snapshot budget stop is a partial check` (3 tests; `buildSnapshot` is wrapped by `vi.mock` to lower `snapshotBudget`, as it is not a CLI option).
CHANGELOG: Changed: an exhausted snapshot byte budget is a partial check (INCOMPLETE, "snapshot budget exhausted"), not a `--max-duration` stop: the exit code follows `--fail-on`, never 4, and `--fail-on-incomplete` makes it 3.

## 3. JSON syntax errors do not quote the file (medium)

`src/listing/load.ts`: `is not valid JSON (line L, column C)` from the position in the error (digits only, recomputed against the text), never the message. A non-UTF-8 listing JSON is `is not valid UTF-8` and not parsed. `src/config.ts` and `src/baseline.ts` already used fixed messages (tested).
Test: `item 3: a JSON syntax error never quotes the file` (SYNTH token built at runtime).
CHANGELOG: Fixed: a malformed `.mcp.json` or manifest no longer has a window of its content copied into the listing warning.

## 4. `--fail-on-drift` never passes silently (low)

`src/cli.ts`: with `--fail-on-drift` and `drift.notCompared` set (baseline without fingerprints or with null, tools/list failed or partial, stop during listing) the run exits 1 (3 and 4 still win) and prints `--fail-on-drift: tool definitions not compared (<reason>); re-save the baseline with --save-baseline` on stderr. `--help` and README (option row, exit code table) updated. `test/remediation-w6a-drift.test.ts` expected 0 for this case under the old behaviour; now 1.
Test: `item 4: --fail-on-drift does not pass silently when the tools were not compared`.
CHANGELOG: Changed: `--fail-on-drift` exits 1 with a warning when the tool definitions could not be compared.

## 5. File inputs are bounded regular files (low)

New `src/input-file.ts` (`readInputFile`: open with `O_NONBLOCK`, `fstat` on the descriptor, regular file only, 16 MiB cap) used by `--baseline` and `--config` / discovered config. A FIFO, device or directory is exit 2 with `cannot read --baseline: it is not a regular file (a pipe or a device)` (or `it is a directory`, `it is larger than 16 MiB`); the content is never shown. `--openai-manifest` that is not a regular file is exit 2 naming the flag (`not a pipe, device or other special file`). In `src/listing/load.ts` every file read opens `O_NONBLOCK` and re-checks `fstat` (a FIFO swapped in after `lstat` cannot hang), keeping the existing listing caps; a bad file inside `--plugin-dir` stays a `warning:` line on stderr, as W6F designed, not exit 2.
Test: `item 5: file inputs must be regular files of bounded size` (mkfifo; skipped on win32).
CHANGELOG: Fixed: `--baseline`, `--config` and `--openai-manifest` reject a pipe, device or directory (exit 2), and `--baseline` and config files are capped at 16 MiB; no input can hang the run on a FIFO.

## Not done

`--tool-args` is read with plain `readFileSync` and has the same FIFO exposure; it was not in the list.
