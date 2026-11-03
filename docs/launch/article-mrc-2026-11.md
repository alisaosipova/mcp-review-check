# What fails most often in public MCP servers, and the edits that fix it

DRAFT for the maintainer to rewrite. Every number below comes from
`docs/launch/aggregate-2026-11-03.md` (output of `node scripts/aggregate-captures.mjs` at version 0.7.0, run
2026-11-03). No server is named. Sources are listed at the end.

Pass directory review the first time: lint your MCP server against the Claude and ChatGPT directory criteria and the
MCP spec before you submit.

That is what mcp-review-check is for. Below: what it finds on a small set of public servers, and the edits that
clear the most common findings. Most are a few lines of metadata per tool.

## The sample, and why it is weak evidence

7 public, no-login MCP servers, captured once on 2026-10-22. A capture is a frozen read-only listing: the
`initialize` result, `tools/list`, `resources/list`, resource templates, `prompts/list` and the `ui://` resource
reads. Together they hold 28 tools, 371 resources, 2 servers with MCP Apps UI and 9 UI resource reads.

Read the numbers with these limits:

- n = 7. No claim about the share of all public or all listed servers.
- Not random. 4 of the 7 were chosen because they are listed in the Claude directory, and 3 because they produced
  false positives while the tool was being written.
- In-sample. These captures are the linter's own regression fixtures, and the rules were tuned on them. The test
  suite requires no heuristic finding above info on any of them, and no Claude error on the 4 listed ones.
- Not a review outcome. An error finding means the captured metadata misses a criterion a directory's public docs
  state, not that a directory rejected, or would reject, that server.
- Partial. A capture holds no transport, OAuth or runtime behaviour, so 96 to 118 of the 179 rules ran per capture.
  A live run against the same servers could find more error classes, never fewer.
- Dated. Servers may have changed since 2026-10-22.

A larger capture is planned: pre-registered (the server list fixed from a directory listing on one date, before any
linting), kept out of the regression fixtures so the rules are not tuned on it, and reported with the same tables.
It is not done yet.

## What the 7 captures show

152 findings in total: 41 error, 12 warning, 99 info.

Servers with no error finding for a directory:

- Claude: 5 of 7
- ChatGPT: 4 of 7
- both: 3 of 7

So 4 of the 7 miss at least one criterion that a directory states as a requirement and that the tool checks
deterministically.

Every error finding came from five rules. All five are deterministic metadata checks; none is a heuristic.

| Rule | What it checks | Directory | Servers | Findings |
|---|---|---|---|---|
| TOOL-012 | readOnlyHint, destructiveHint and openWorldHint all explicit booleans | ChatGPT | 2 | 11 |
| APPS-012 | dedicated widget domain | ChatGPT | 2 | 9 |
| APPS-005 | UI resource declares a CSP | ChatGPT | 1 | 8 |
| TOOL-011 | readOnlyHint or destructiveHint declared | Claude | 1 | 8 |
| TOOL-006 | tool has a title | Claude | 1 | 5 |

Two observations the data supports:

- The common gaps are tool annotations and MCP Apps widget metadata, not protocol bugs.
- 1 of the 4 servers listed in the Claude directory has a ChatGPT error finding (missing explicit annotation
  booleans). Passing one directory does not mean you meet the other's criteria.

One thing the data does not support: "most real servers fail review". The Claude-listed group has 0 Claude errors,
partly by construction, and both Claude-blocked captures are in the group picked for earlier false positives.

## The edits

Each fix below is what the rule checks in `src/rules/`, stated as an edit to your server. `npx mcp-review-check
explain <RULE-ID>` prints the rationale, the public source and the fix for any rule.

### TOOL-012 and TOOL-011: tool annotations

TOOL-012 (ChatGPT, error) fires when any of `readOnlyHint`, `destructiveHint` or `openWorldHint` is not an explicit
boolean in the tool's `annotations`. The spec has defaults for absent hints; they do not count. The rule's source is
OpenAI's plugin guidelines, and its rationale is that the portal rejects tools without all three hints.

TOOL-011 (Claude, error) fires when neither `readOnlyHint` nor `destructiveHint` is set. Claude uses these hints to
decide auto-permissions. A tool with `readOnlyHint: false` and no `destructiveHint` gets a warning: make it explicit.

The edit, per tool: set all three, to values that describe what the tool really does.

```json
{
  "name": "search_docs",
  "title": "Search docs",
  "annotations": { "readOnlyHint": true, "destructiveHint": false, "openWorldHint": false }
}
```

Setting all three clears both rules. Make the values true, not just present: a tool cannot be both read-only and
destructive (TOOL-013), and ChatGPT may ask you to justify each hint (MAN-027). The report's FIX SNIPPETS section
prints a JSON fragment per tool with values guessed from the tool name; check them.

### TOOL-006: tool title

TOOL-006 (Claude, error) fires when a tool has no non-empty `title`, either top level or in `annotations.title`.
Claude shows it in its UI. Use a short label ("Search docs"), not a sentence; the linter reports a title over 60
characters as info. If you set both places, keep them equal, or the spec check notes that they differ.

### APPS-012: widget domain (servers with MCP Apps UI only)

APPS-012 (ChatGPT, error) fires when a `ui://` resource has no widget domain. Set `_meta["openai/widgetDomain"]` on
the UI resource to a unique https origin you own: scheme and host only, no path, query or trailing slash. The shared
default sandbox origin is reported as a warning because it is not unique. A Claude `ui.domain` value (the
`*.claudemcpcontent.com` form) does not count for ChatGPT; keep it for Claude and add `openai/widgetDomain`.

The linter reads `_meta` from the content item that `resources/read` returns, and falls back to the
`resources/list` entry. Put it on the read result to be safe.

### APPS-005: widget CSP (servers with MCP Apps UI only)

APPS-005 (ChatGPT error, Claude info) fires when a UI resource declares no CSP. Declare one in `_meta.ui.csp`
(`connectDomains`, `resourceDomains`, `frameDomains`, `baseUriDomains`) or in `_meta["openai/widgetCSP"]`
(`connect_domains`, `resource_domains`, `frame_domains`, `redirect_domains`). Each field is an array of strings.
Mind the spelling per key: hosts ignore an unknown field, and the linter warns with the likely intended name. List
the origins your widget HTML fetches from; on Claude, external origins are blocked by default.

Why errors are only metadata fields: a rule is an error only when the public source states a MUST or a rejection
criterion and the check is deterministic. Heuristics (word lists, regexes) are at most warning.

## Run it

Node 22.12 or newer, no install, no account, no telemetry:

```bash
npx mcp-review-check https://mcp.example.com/mcp           # a deployed server
npx mcp-review-check --stdio -- node dist/server.js        # a local stdio server
npx mcp-review-check explain TOOL-012                      # one rule: why, source, fix
```

It is read-only by default: it calls no tool unless you pass `--active`, and then only tools annotated
`readOnlyHint: true`. The last lines print a verdict per directory: `BLOCKED`, `NEEDS ATTENTION` or
`NO AUTOMATED BLOCKERS`. `--target claude` or `--target chatgpt` gates on one directory. A server behind OAuth needs
a test-account token in `MCP_REVIEW_CHECK_TOKEN` for the tool checks; without it the verdict is `INCOMPLETE`, never
a pass.

(Draft note: the `npx` lines assume 0.7.x is on npm. The aggregate file records npm latest as 0.5.0, not
re-checked. Verify before publishing.)

## Put it in CI

The GitHub Action wraps the CLI, adds annotations, the report in the job summary and a SARIF upload:

```yaml
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      - uses: alisaosipova/mcp-review-check@v0.7.0
        id: review
        with:
          target: https://staging.example.com/mcp
          platform: claude
          bearer: ${{ secrets.MCP_REVIEW_CHECK_TOKEN }}
```

To fail only on new findings, save a baseline with `--save-baseline` and pass it with `--baseline`
(`docs/guide/ci.md`).

A badge can show the verdict of the last run on the default branch, from the Action's `verdict-claude` or
`verdict-chatgpt` output. Its text is "no automated blockers", the exact verdict the CLI prints, not "no blockers"
and not "approved": the verdict covers only what the rules detect. The recipe (a shields.io endpoint badge fed by
the workflow) is in `docs/launch/badge.md`.

## What it does not check

A clean report does not guarantee approval. Reviews include manual testing and policy judgment. The tool lists 31
manual checklist items it cannot automate (privacy policy, listing fields, screenshots, test accounts, test cases,
whether tool descriptions match real behaviour); `--checklist` prints them. It is not a security audit and is not
affiliated with Anthropic or OpenAI.

## Related

One author, two measurement tools for the agent era: mcp-review-check checks the server you publish, LureKit checks
the agent setup you run. Both inert, cited, reproducible, no telemetry.

## Sources for the numbers

- 7 servers, capture date 2026-10-22, 28 tools, 371 resources, 2 servers with UI, 9 UI reads, 179 rules and 96-118
  run per capture, 152 findings, the error/warning/info totals, the per-directory and per-rule tables, the listed vs
  false-positive split: `docs/launch/aggregate-2026-11-03.md`.
- Selection of the 7 and the test constraints: `test/real-servers.test.ts` header comment, as quoted in the
  aggregate file.
- Rule behaviour and fixes: `src/rules/annotations.ts` (TOOL-011, TOOL-012, TOOL-013, TOOL-015),
  `src/rules/tools.ts` (TOOL-006, 60-character title limit), `src/rules/apps.ts` and `src/rules/util/ui.ts`
  (APPS-005, APPS-012, CSP field names), `docs/RULES.md`, `node dist/cli.js explain <id>`.
- 31 manual items: `node dist/cli.js --list-rules MAN`.
- Severity principle, read-only default, no telemetry: `README.md`; `SECURITY.md`.
- Action inputs and outputs: `docs/guide/ci.md`. Badge wording: `docs/launch/badge.md`.
