# Aggregate: mcp-review-check on 7 captured public MCP servers

DRAFT for review. Generated 2026-11-03 from the working tree on branch `feat/user-value` (package.json version 0.7.0; latest local git tag v0.7.0, created 2026-11-03 06:55 -0500 on HEAD `888e14f`; npm latest 0.7.0 with provenance, checked 2026-11-04 with npm dist-tag ls). No network call was made: every number below comes from the captured fixtures and the command named next to it.

## Method

- **What a capture is.** `scripts/capture-real.mjs` connects once to a public, no-login MCP server and freezes the read-only listing: `initialize` result, `tools/list`, `resources/list`, resource templates, `prompts/list` and the `ui://` resource reads. It keeps no transport probes, headers or tokens (see the comment at the top of that script). A capture is therefore what a server exposes, not how its endpoint behaves.
- **How many.** 7 captures in `test/fixtures/real/` (6 `.json`, 1 `.json.br`). `baseline-findings.json` in the same directory is not a capture and not an aggregate: it is a per-server list of warning and error findings written by an older commit (`d6100a9`) for the regression test. It is not used for any number here.
- **When.** Every capture has `capturedAt: 2026-10-22` (read from each file; `test/fixtures/real/NOTICE.md` says the same).
- **What was run.** `npm run build && node scripts/aggregate-captures.mjs` (add `--json` for the raw counts). The script loads each capture into an empty snapshot exactly as `test/real-servers.test.ts` does, runs the full rule catalog with `--target all` semantics through the built `dist/`, and computes the per-directory verdict with the same `verdict()` function the CLI report uses. It prints counts only.
- **Which rules could run.** The catalog has 179 rules; 96 to 118 ran per capture (script output). The rest need inputs a capture does not hold: transport and OAuth probes, `--active` tool calls, a listing file. So SRV/AUTH/RT/LST results are mostly absent, and a real CLI run against the same servers could find more, never fewer, error classes.
- **Definitions.** "No error finding" for a directory = no finding at error severity *on that directory* (`severityByPlatform`), which is what makes a verdict `BLOCKED`. `NO AUTOMATED BLOCKERS` as a verdict string additionally means no warning for that directory (`src/report/score.ts`). Severity in the category table is a finding's highest severity over its platforms. Category = the rule id prefix.
- **Sample size of the shape.** 28 tools, 371 resources (most of them skill files on two servers), 2 servers with MCP Apps UI and 9 UI resource reads; protocol eras: 4 legacy, 3 dual (read from the capture files).

## What the sample is NOT

- **Not random.** Per the header comment of `test/real-servers.test.ts`, 4 of the 7 were chosen because they are listed in the Claude directory, and 3 because they produced false positives during development.
- **Not the directory.** 7 servers out of a directory of many more; no claim about the share of all listed or all public servers.
- **Not independent of the tool.** These captures are the linter's own regression fixtures. The rules were tuned on them: the test suite requires no heuristic finding above info on any of them and no Claude error on the 4 listed ones. The numbers are in-sample.
- **Not a review outcome.** An error finding means the rule's cited public criterion is not met in the captured metadata. It does not mean a directory rejected, or would reject, that server. Directory status in ChatGPT was not checked for any of the 7.
- **Not current.** Servers may have changed since 2026-10-22.

## Results

Output of `node scripts/aggregate-captures.mjs`, run 2026-11-03 at version 0.7.0:

```
Rules in catalog: 179; rules run per capture: 96-118 (the rest need probes or inputs a capture does not hold).

Servers: 7. Capture dates: 2026-10-22 (7). Findings: 152.

| Directory | Servers with no error finding | Share |
|---|---|---|
| claude | 5 of 7 | 71% |
| chatgpt | 4 of 7 | 57% |
| both | 3 of 7 | 43% |

| Directory | BLOCKED | NEEDS ATTENTION | NO AUTOMATED BLOCKERS | INCOMPLETE |
|---|---|---|---|---|
| claude | 2 | 1 | 4 | 0 |
| chatgpt | 3 | 1 | 3 | 0 |

| Category | error | warning | info |
|---|---|---|---|
| APPS | 17 | 10 | 17 |
| INJ | 0 | 0 | 3 |
| SPEC | 0 | 0 | 1 |
| SRV | 0 | 1 | 13 |
| TOOL | 24 | 1 | 65 |
| total | 41 | 12 | 99 |

Error findings by rule:

| Rule | Servers | Findings |
|---|---|---|
| TOOL-012 | 2 | 11 |
| APPS-012 | 2 | 9 |
| APPS-005 | 1 | 8 |
| TOOL-011 | 1 | 8 |
| TOOL-006 | 1 | 5 |

Warning findings by rule:

| Rule | Servers | Findings |
|---|---|---|
| APPS-018 | 1 | 8 |
| APPS-008 | 1 | 2 |
| SRV-013 | 1 | 1 |
| TOOL-015 | 1 | 1 |

```

Rule meaning (from `docs/RULES.md`): TOOL-012 = ChatGPT: readOnlyHint, destructiveHint and openWorldHint all explicit booleans (chatgpt error); APPS-012 = ChatGPT dedicated widget domain (chatgpt error); APPS-005 = UI resource declares a CSP (chatgpt error); TOOL-011 = Claude: readOnlyHint or destructiveHint declared (claude error); TOOL-006 = Tool has a title (claude error). All five are deterministic metadata checks, none is a heuristic (README: heuristics are at most warning).

### Split by how the server was chosen

Ad-hoc grouping with the `LISTED` list from `test/real-servers.test.ts` (command: a `node --input-type=module` one-off that calls `lintCaptures()` and `aggregate()` on each group; not committed):

| Group | Servers | No Claude error | No ChatGPT error | No error in either |
|---|---|---|---|---|
| Listed in the Claude directory (per the test comment) | 4 | 4 | 3 | 3 |
| Chosen for earlier false positives | 3 | 1 | 1 | 0 |

## What the data supports, and what it does not

- Supported: in 4 of the 7 captures (all except 3; first table, "both" row), the published metadata misses at least one criterion that a directory's public docs state as a requirement and that the tool checks deterministically. The most common gaps are tool annotations (TOOL-012 on 2 servers, TOOL-011 on 1) and MCP Apps widget metadata (APPS-012 on 2, APPS-005 on 1).
- Supported: 1 of the 4 servers listed in the Claude directory has a ChatGPT error finding (missing explicit annotation booleans), so passing one directory does not imply meeting the other's criteria.
- Not supported: "most real servers fail review". The Claude-listed group has 0 Claude errors, partly by construction (the test requires it). Both Claude-blocked captures are in the group picked for false positives.
- To make a stronger claim: capture a larger, pre-registered sample (for example every no-login server in a directory listing on one date, chosen before linting), keep it out of the regression fixtures so the rules are not tuned on it, and report the same tables. That needs network access and is not done here.

## Draft README line (NEEDS USER APPROVAL, not applied to README.md)

Proposed, under the intro paragraph:

> On 7 public MCP servers captured on 2026-10-22, 4 missed at least one directory requirement the tool checks deterministically, most often tool annotations or widget CSP and domain; 1 of the 4 already in the Claude directory missed a ChatGPT one. Method and caveats: [docs/launch/aggregate-2026-11-03.md](docs/launch/aggregate-2026-11-03.md).

Shorter alternative:

> 4 of 7 public MCP servers we captured (2026-10-22) miss a directory requirement on tool titles or annotations, or widget metadata ([method and caveats](docs/launch/aggregate-2026-11-03.md)).

Note before approving: the sample is the tool's own fixtures (not random, n = 7). If the README link is added, `test/p5b-docs.test.ts` checks that relative README links resolve, so this file must stay at this path. docs/launch/ is not in package.json `files`, so the link would not resolve on npmjs.com; an absolute GitHub URL avoids that.
