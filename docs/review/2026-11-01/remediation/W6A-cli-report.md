# W6A-cli report (wave 6, 0.4.0)

Package: W6A-cli. Items: tool-definition drift, `--fail-on-drift`, `--diff-only`, report JSON Schema, README.
Plan: `docs/review/2026-11-01/remediation/wave6-plan.md`. Branch: `worktree-wf_9e838c12-410-1`.

## Done

1. **Tool-definition drift.**
   - New `src/report/drift.ts`: `canonicalJson` (keys sorted by UTF-16 code unit at every depth, no whitespace, undefined members dropped, iterative so a 20 000-level schema does not overflow the stack), `toolFingerprint` (SHA-256 over the canonical JSON of the present `name, title, description, inputSchema, outputSchema, annotations, _meta`, plus one SHA-256 per present field), `toolFingerprints(snap)` (null when tools/list did not finish: failed connect, list failure, partial check, `--max-duration` stop before `listing` completed), `compareTools` (pairs by name, duplicates in tools/list order; added, removed, changed with the changed top-level fields), and the shared renderers.
   - Every JSON report (so `--save-baseline` and `--json-output` too) gets top-level `toolFingerprints`. This is additive. The digests are computed over the **redacted** report snapshot, the same data the baseline was written from. As a result, a rotated secret that a description echoes is not a change.
   - `src/baseline.ts`: `readBaseline(file)` returns `{findings, tools}`. `tools` is undefined for a 0.2/0.3 report and null for a partial run. Malformed `toolFingerprints` is a `BaselineError` (exit 2). `loadBaseline` keeps its signature and behaviour.
   - Output per format:
     - Text: `CHANGED TOOL DEFINITIONS (N since baseline)` right after the findings (`+` added, `-` removed, `~ name: changed: fields`). Otherwise one line: `Tool definitions: no change since baseline (N tools).` or `Tool definitions not compared: <reason>.` With `--quiet` the section is shown only when there are changes.
     - Markdown: `## Changed tool definitions (N since baseline)` with a Tool | Change table after the findings, otherwise a `>` note.
     - JSON: `baseline: {toolChanges: {added, removed, changed: [{name, fields}]} | null, notCompared?}`.
     - SARIF: one `note` result per change under the synthetic `BASE-001` "Tool definition changed since baseline". It has `baselineState: new`, `properties.change` and `fields`, a partialFingerprint per change, and a rule entry added to the driver only when there is a change. `runs[0].properties.baseline` holds the JSON drift object. The output validates against SARIF 2.1.0.
     - JUnit: in each suite's `<system-out>`, never a failure.
   - Redaction: tool names come from the redacted snapshot (tested with a server whose tool names and descriptions hold the `--api-key` value; no output and no saved baseline contains it). Text and markdown go through `visibleText` and markdown escaping.
   - Exit code: drift alone never changes it. `--fail-on-drift` turns a 0 into 1 when there is any change (also with `--fail-on never`); 3 and 4 take precedence. `summary.failed`, the verdicts and the Result line stay about findings. The heading says `· fails the run (--fail-on-drift)`, and the `--output` summary line adds `· N tool changes (--fail-on-drift)`.
   - A 0.3 baseline is accepted: the findings are matched as before, and the drift section reads `not compared: tool fingerprints were not recorded in the baseline (a report of mcp-review-check 0.3 or older)`.
2. **`--diff-only`.** With `--baseline`, text and markdown (and the GitHub step summary, which is markdown) drop the known-findings line and the manual checklist, even with `--checklist`. JSON, SARIF and JUnit come out byte-identical apart from time fields (tested). Without `--baseline` it is a usage error, exit 2. `--fail-on-drift` without `--baseline` is also exit 2.
3. **Report JSON Schema.** `schema/report.schema.json`, draft 2020-12, `$id` `https://raw.githubusercontent.com/alisaosipova/mcp-review-check/v0.4.0/schema/report.schema.json` (`JSON_SCHEMA_URL` in `src/report/json.ts`).
   - It covers the whole report, including `$schema`, `server.argv`, `limits.stopped.completed/unfinished`, `summary.rootCauses`, `summary.baselined`, `findings[].baselined`, `toolFingerprints` and `baseline` (drift).
   - `additionalProperties: false` is set on the root and on every object the tool defines (`serverInfo` is the server's own object and stays open).
   - The JSON report has `$schema` as its **second** key, after `schemaVersion`, so `test/e2e-stdio.test.ts` (first key is `schemaVersion`) did not need changing.
   - `package.json` `files` gains `schema`.
   - Validator in the test: ajv 8.20.0, already a runtime dependency, through `ajv/dist/2020.js`, with `uri` and `date-time` formats added by hand. **No ajv-formats devDependency and no package-lock change.**
4. **README.**
   - New sections "Tool-definition drift" and "JSON Schema", the latter with a CI validation command.
   - Options rows for `--fail-on-drift` and `--diff-only`, plus drift notes in the `--baseline`, json-format, JUnit and exit-code-1 rows.
   - A "Catch tool-definition changes" CI recipe.
   - `--help` documents both new flags and the new exit 1 cause.

## Deferred

- **Config keys `failOnDrift` and `diffOnly`.** Needs `src/config.ts` (the `KEYS` table, not owned). The README marks both flags "Command line only (no config key yet)". After adding the keys, add them to the README "Keys" list and remove that note.
- **Fingerprints over the uncapped tool definitions.** Needs `src/connect.ts`/`src/limits.ts` (W6D): `capSnapshot` truncates strings in place before the report is built, so a change past the 16 KiB input cap in one string is not seen. This is documented in the README.
- **`httpTimings` in the schema.** Not done: the JSON report has no such field. `transport.timings` lives only on the snapshot (`src/connect.ts` `httpTimings()`) and `toJson` never emits it. Nothing to describe; if a later package adds it to the report, the schema test will fail until the schema has it.
- **Result line naming the drift failure.** By decision: drift "does not change the verdicts". With `--fail-on-drift` the text Result line still reads `PASS` while the exit is 1. The section heading and the summary line say why. The maintainer may want a `· drift: N (--fail-on-drift)` suffix in `resultLine` (src/report/index.ts) later.

## Files

- New: `src/report/drift.ts`, `schema/report.schema.json`, `test/remediation-w6a-drift.test.ts`, `test/remediation-w6a-schema.test.ts`, this report.
- Changed: `src/cli.ts`, `src/baseline.ts`, `src/report/json.ts`, `src/report/text.ts`, `src/report/markdown.ts`, `src/report/junit.ts`, `README.md`, `package.json` (`files` only).

## Test commands

- `npm run typecheck`: clean. `npm run build`: clean.
- `MCP_REVIEW_CHECK_SKIP_BUILD=1 npx vitest run test/remediation-w6a-*.test.ts test/remediation-w4a-*.test.ts test/remediation-w5a-*.test.ts test/sarif.test.ts test/real-servers.test.ts test/output-modes.test.ts test/docs.test.ts test/remediation-w3c-cli-tests.test.ts test/pack.test.ts`: **14 files, 135 tests passed** (w6a-drift 15, w6a-schema 6).
- Also run, because the JSON shape changed: `test/compat.test.ts test/e2e-stdio.test.ts test/remediation-w5d-action.test.ts test/ci-output.test.ts test/lifecycle.test.ts`: **5 files, 54 passed**. `test/e2e-redaction.test.ts`: **92 passed**. Its "nested 5000 levels deep" case caught a recursive `canonicalJson` (stack overflow), fixed in commit `ebe8b85`.

## Verified facts

- `ajv-cli` 5.0.0 (`npm view ajv-cli`, https://github.com/ajv-validator/ajv-cli) with `ajv-formats` 3.0.1 validates a bad-fixture report against the schema. Command run on 2026-11-02: `npx -y -p ajv-cli@5 -p ajv-formats@3 ajv validate --spec=draft2020 -c ajv-formats -s schema/report.schema.json -d report.json` printed `report.json valid` and exited 0.
- ajv 8.20.0 (the repo's runtime dependency) ships `ajv/dist/2020.js` for draft 2020-12. Its default `strictRequired` rejects `required` naming a property defined one level up, so the test turns that one strict option off.
- Not verified live: the `$id` URL returns 404 until tag `v0.4.0` is pushed (it is a raw.githubusercontent.com path under that tag).
- The seven tool fields are the plan's list (MARKET §3.3). The MCP `Tool` interface in https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/schema/2025-11-25/schema.ts was not re-read in full this session. Fields outside the list (for example `icons`, `execution`) are deliberately not fingerprinted, and a test pins that.

## Proposed CHANGELOG lines (Unreleased, Added)

- Every JSON report has `toolFingerprints`: one SHA-256 per tool over the canonical JSON (keys sorted, no whitespace) of its `name`, `title`, `description`, `inputSchema`, `outputSchema`, `annotations` and `_meta`, plus one digest per field. It is `null` when `tools/list` did not finish.
- `--baseline` also compares the tool definitions and reports **Changed tool definitions** (added, removed, and changed with the changed fields):
  - text and markdown: a section after the findings;
  - JSON: `baseline.toolChanges`;
  - SARIF: one `note` result per change under the synthetic rule `BASE-001`, which is not in the catalog;
  - JUnit: `<system-out>`.

  Drift never changes the exit code by itself. A 0.3 baseline without fingerprints still works, and the section says fingerprints were not recorded.
- `--fail-on-drift` exits 1 when a tool was added, removed or changed since `--baseline`.
- `--diff-only` limits text and markdown to the new findings and the drift (no known-findings line, no manual checklist).
- `schema/report.schema.json` (JSON Schema draft 2020-12) ships in the package. JSON reports name it in `$schema` (`https://raw.githubusercontent.com/alisaosipova/mcp-review-check/v0.4.0/schema/report.schema.json`).

## Proposed spec paragraphs (docs/design/spec.md, JSON report and baseline sections)

> **Tool fingerprints and drift.** The JSON report carries `toolFingerprints`, in tools/list order: `{name, sha256, fields}`. `sha256` is SHA-256 (hex) over the canonical JSON (object keys sorted by UTF-16 code unit at every depth, no whitespace, undefined members omitted) of the tool's present fields among `name, title, description, inputSchema, outputSchema, annotations, _meta`. `fields` maps each present field to the SHA-256 of its own canonical JSON. Fingerprints are computed over the redacted, input-capped snapshot. They are `null` when tools/list did not finish. With `--baseline`, tools are paired by name (duplicates in order), and added, removed and changed tools (with the changed fields) are reported in every format; SARIF uses the synthetic rule `BASE-001` at level `note`. If either side has no fingerprints, there is no comparison and the reason is reported. Drift is informational. `--fail-on-drift` makes any change exit 1 without changing the verdicts or `summary.failed`. `--diff-only` (requires `--baseline`) removes the known-findings line and the manual checklist from text and markdown.

> **Report schema.** `schema/report.schema.json` (draft 2020-12) describes `schemaVersion` 1. Its `$id` is the raw GitHub URL of the file at the release tag that last changed it, and the report repeats it in `$schema`. Objects are closed (`additionalProperties: false`), so a test that validates the fixture reports fails when the report gains a field the schema lacks.
