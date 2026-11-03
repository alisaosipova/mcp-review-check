# From zero to directory submission

A path from "I have an MCP server" to "I submit it to the Claude connector directory or the ChatGPT plugin directory". Each step says what to run and what to look at. Option details are in [Options, config file and output formats](options-and-config.md).

You need Node 22.12 or newer. Nothing is installed or sent anywhere except to your server ([privacy](privacy-and-requests.md)).

## 1. First run

```bash
# A deployed server
npx mcp-review-check https://mcp.example.com/mcp

# A local stdio server (the tool starts it without a shell)
npx mcp-review-check --stdio -- node dist/server.js
```

Start without `--target`: you get both directories and the MCP specification. If the server needs OAuth, only the auth checks run and the score reads `n/a`: get a test-account token first ([Authentication](auth.md)). If nothing connects, see [Troubleshooting](troubleshooting.md).

## 2. Read the report

- **Header**: the tool version, the rule catalog date, the transport and the protocol era.
- **ERRORS**: a documented MUST or rejection criterion that the tool detects deterministically. Fix these first.
- **WARNINGS** and **INFO**: heuristics (word lists, regexes) and advice. They can be wrong; they are never errors.
- **FIX SNIPPETS**: copy-paste `title` and `annotations` for each tool. The hint values are guesses from the tool's name and description: check them.
- **Score** counts root causes, not findings: three tools missing the same annotation are one root cause per tool, not nine lines.
- **Verdicts**: per directory, `BLOCKED` (errors for that directory), `NEEDS ATTENTION` (warnings) or `NO AUTOMATED BLOCKERS`. The `Result:` line is what sets the exit code.

`--format markdown` gives a table for a pull request, `--format json` the full machine-readable report.

## 3. Explain

Every finding names a rule ID. Ask why it exists and how to fix it:

```bash
npx mcp-review-check explain TOOL-011
npx mcp-review-check --list-rules TOOL
```

`explain` prints the severity per directory, the rationale, the public source (a URL) and the fix, and how to `--ignore` it. The same applies to `MAN-*` items of the manual checklist.

## 4. Fix and re-run

Fix the cause in your server, restart it and run the same command again. Typical first-run fixes: tool `title` and `annotations` (`readOnlyHint`, `destructiveHint`, `openWorldHint`), descriptions for tools and parameters, an exact `inputSchema`, HTTPS and a public name for a remote server, CSP for widgets. Repeat until the directories you submit to read `NO AUTOMATED BLOCKERS`. Gate on one directory with `--target claude` (or `chatgpt`); MCP spec findings fail the run only with `--fail-on-spec`.

A finding you decide to accept (a documented false positive) goes into `--ignore <RULE-ID>`; see [how to report a false positive](troubleshooting.md#how-to-report-a-false-positive).

## 5. Runtime checks with --active

By default the tool never calls your tools. `--active` calls the tools annotated `readOnlyHint: true` (at most 3 calls per tool, the first 50 that qualify) and checks error messages, input validation, result size, latency and leaked secrets:

```bash
npx mcp-review-check https://mcp.example.com/mcp --active --tool-args args.json
```

`args.json` maps a tool name to the arguments to use: `{ "search_docs": { "query": "test" } }`. Run it against staging or a test account. `--active-auth` additionally registers a DCR client on your authorization server; use it deliberately.

## 6. Baseline in CI

Once the report is clean enough, freeze the state and fail only on **new** findings and changed tool definitions:

```bash
npx mcp-review-check --target claude --fail-on never --save-baseline .mcp-review-check/baseline.json --stdio -- node dist/server.js
```

Commit the file. In CI run the same command with `--baseline .mcp-review-check/baseline.json --fail-on-drift`. Ready-made recipes (GitHub Actions, the GitHub Action, GitLab CI, Docker, pre-commit) are in [CI and automation](ci.md). Pin the minor version (`mcp-review-check@0.7`) so new rules arrive when you decide to upgrade.

## 7. Manual checklist and listing files

Part of the review cannot be automated. The report ends with `N manual items`; see them all with `--checklist` (markdown and JSON always list them):

```bash
npx mcp-review-check https://mcp.example.com/mcp --checklist
```

Go through every item before you submit: the listing text, the privacy policy URL, a test account and test cases for the reviewers (MAN-003, MAN-026), screenshots and their sizes, the support contact, and what the server stores.

If you submit a plugin package, lint the files next to the live server:

```bash
npx mcp-review-check https://mcp.example.com/mcp --plugin-dir ./my-plugin --target claude
npx mcp-review-check https://mcp.example.com/mcp --openai-manifest ./package/plugin.json --target chatgpt
```

The `LST-*` rules check the manifest, README, LICENSE, `.mcp.json` pins and test cases (for example that each test case's `tools_triggered` exists in `tools/list`). Details: [Listing and plugin manifests](listings.md).

## 8. Before you press submit

- [ ] The last run shows `NO AUTOMATED BLOCKERS` for the directory you submit to (Claude, ChatGPT or both), against the **production** URL.
- [ ] The run used a real test-account token and the tool checks ran (the score is a number, not `n/a`).
- [ ] `--active` ran against staging with no error findings.
- [ ] The listing lint (`--plugin-dir` or `--openai-manifest`) has no errors.
- [ ] Every manual checklist item is done or consciously skipped.
- [ ] The test account and its credentials work from a fresh browser, and do not need an admin or personal account.
- [ ] Nothing in the tool descriptions steers the model away from other tools or asks for data the tool does not need (the INJ and DATA rules).

A clean report does not guarantee approval: reviews include manual testing and policy judgment, and the rules reflect the public criteria as of the catalog date ([Limitations](../../README.md#limitations-and-disclaimer)). Submit through the directory's own form; keep the saved JSON report as a record of what you checked.

After you ship, keep the baseline job from step 6 running so a changed tool definition fails the build. mcp-review-check checks the server you publish, LureKit checks the agent setup you run: if you also run coding agents with MCP servers, see [LureKit](https://github.com/alisaosipova/lurekit).
