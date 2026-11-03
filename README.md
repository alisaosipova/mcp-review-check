# mcp-review-check

Lint an MCP server against the public review criteria of the **Claude connector directory**, the **ChatGPT plugin directory** and the **MCP specification** before you submit it.

Run `npx mcp-review-check https://mcp.example.com/mcp` (no install, no account). Stdio servers, OAuth and CI: see [Usage](#usage), [Token recipe](#token-recipe) and [CI recipes](#ci-recipes).

`mcp-review-check` connects to your server (remote Streamable HTTP, legacy HTTP+SSE, or local stdio), takes a snapshot of what it exposes (tools, resources, prompts, MCP Apps widgets, OAuth metadata), runs side-effect-free protocol probes, and checks everything against <!-- RULE_COUNT -->176<!-- /RULE_COUNT --> automated rules. Every rule links to its public source. Checks that cannot be automated are listed as a manual checklist (in full in markdown and JSON; one line in text unless you pass `--checklist`).

- Requires Node 22.12 or newer; no telemetry.
- Read-only by default. It never calls your tools unless you pass `--active`, and then only tools annotated `readOnlyHint: true`.
- Text, JSON, Markdown, SARIF and JUnit output; an optional config file; CI-friendly exit codes.

## What it checks

| Category | Examples |
|---|---|
| **SRV** endpoint and deployment | HTTPS, public IPv4, tunnels, cross-host redirects, DNS-rebinding `Invalid Host`, Origin handling, WAF challenges, latency, server naming |
| **SPEC** protocol conformance | initialize / `server/discover` shape, declared capabilities, content types, 202 for notifications, session ids, version negotiation, error codes, `_meta` keys, icons, 2026-07-28 caching hints |
| **TOOL** tool metadata and schemas | name rules, titles, descriptions, parameter descriptions, `readOnlyHint` / `destructiveHint` / `openWorldHint`, contradictory or misleading hints, schema validity, catch-all HTTP tools, dispatchers, OpenAI `_meta` keys |
| **INJ** prompt injection | hidden Unicode, homoglyphs, HTML comments, encoded payloads, "ignore previous instructions", steering away from other tools |
| **DATA** data collection | conversation history, secrets, payment cards / government IDs, precise location |
| **POL** unsupported use cases | money transfer, AI media generation, ads and upsells, demo servers |
| **APPS** MCP Apps widgets | `ui://` links, MIME type, CSP coverage of the origins the HTML uses, widget domains (Claude hash and `openai/widgetDomain`), visibility, sandbox-blocked APIs |
| **AUTH** OAuth | 401 challenge, Protected Resource Metadata, AS metadata, issuer, PKCE S256, CIMD/DCR, grants, scopes, invalid-token handling, TLS, latency |
| **RT** runtime (opt-in) | error message quality, input validation, result size, latency, `structuredContent` vs `outputSchema`, leaked secrets, injection in output |
| **MAN** manual checklist | listing fields, privacy policy, screenshots, test accounts, test cases |

Severity follows one principle: **error** only when the source states a MUST or a rejection criterion *and* detection is deterministic; heuristics (regex or word lists) are at most **warning**.

## Usage

```bash
# Remote server
npx mcp-review-check https://mcp.example.com/mcp

# OAuth-protected server: auth checks run without a token; tool checks need one
MCP_REVIEW_CHECK_TOKEN=... npx mcp-review-check https://mcp.example.com/mcp
npx mcp-review-check https://mcp.example.com/mcp --bearer "$TOKEN"

# Extra headers (values are always redacted in output)
npx mcp-review-check https://mcp.example.com/mcp --header "X-Tenant: acme"

# Local stdio server (spawned without a shell)
npx mcp-review-check --stdio "node dist/server.js --port 0" --env API_BASE=http://localhost:4000
# Same, with the command passed verbatim after `--` (options go before `--`)
npx mcp-review-check --env API_BASE=http://localhost:4000 --stdio -- node dist/server.js --port 0

# Only one directory, machine-readable output
npx mcp-review-check https://mcp.example.com/mcp --target claude --format json
npx mcp-review-check https://mcp.example.com/mcp --format sarif --output mcp-review.sarif

# Opt-in runtime checks: calls tools annotated readOnlyHint: true (max 3 calls per tool)
npx mcp-review-check https://mcp.example.com/mcp --bearer "$TOKEN" --active --tool-args args.json

# CI: fail on warnings too
npx mcp-review-check https://staging.example.com/mcp --fail-on warning

# CI: gate on the Claude directory and on MCP spec conformance
npx mcp-review-check https://staging.example.com/mcp --target claude --fail-on-spec

# Why does a rule exist? Severity per directory, rationale, sources and the fix
npx mcp-review-check explain TOOL-011
npx mcp-review-check --list-rules TOOL --format json
```

On a machine without access to the npm registry, where `npx` cannot fetch the package, run it from a checkout: `npm install && npm run build`, then `node dist/cli.js <url>` or `npm link`. The same applies to every `npx -y mcp-review-check@0.3` line in [CI recipes](#ci-recipes) and [Docker Compose](#docker-compose): replace it with `node path/to/mcp-review-check/dist/cli.js`.

mcp-review-check is a command-line tool only: the package has no supported programmatic API yet (its `exports` field exposes only `package.json`, so `import 'mcp-review-check'` and deep imports of `dist/` fail), and its internal modules may change in any release.

### Options

| Option | Default | Notes |
|---|---|---|
| `--header "K: V"` | | Repeatable. Values are redacted in every output format. |
| `--bearer <token>` | `$MCP_REVIEW_CHECK_TOKEN` | Sent as `Authorization: Bearer`. Prefer the env var to keep tokens out of shell history. |
| `--target claude\|chatgpt\|all` | `all` | `spec` rules always run and are reported; the exit code counts only the chosen directories (see [Exit codes](#exit-codes)). |
| `--format text\|json\|markdown\|sarif\|junit` | `text` | See [Output formats](#output-formats). |
| `--output <file>` | stdout | Report to a file, one-line summary to stderr. If the file cannot be written, the report goes to stdout and the exit code is 2. |
| `--json-output <file>` | | Also writes the JSON report to the file, whatever `--format`: the same document `--format json` prints (with `baselined` marks under `--baseline`), redacted the same way. For a job that wants a readable or SARIF report and a JSON file from one run. A file that cannot be written is exit 2 (the primary report is still printed or written). |
| `--save-baseline <file>` | | The same JSON report under the baseline name: write it once, then pass the file to `--baseline` on later runs (see [CI recipes](#ci-recipes)). May be given with `--json-output`. |
| `--sarif-location <path>` | `.mcp-review-check` | SARIF only: the repository-relative path every result points at (`artifactLocation.uri`). A path with a scheme, an absolute path or `..` is a usage error (exit 2) that does not repeat the value. The server URL or command is in `runs[0].properties.target`, redacted. Results carry `partialFingerprints` (rule, tool or resource, path), the run an `automationDetails.id` per path, and `informationUri` is the repository URL. |
| `--timeout <ms>` | `30000` | Per request (at most 2147482647); HTTP connect uses `min(timeout, 15000)`, a stdio start the full timeout, `--active` tool calls `min(timeout, 241000)`. RT-005 reports a call that runs past Claude's documented 240 s tool timeout as an error for Claude and a warning for ChatGPT (use `--timeout 241000` to measure it); its 60 s (Claude) and 5 s (ChatGPT) thresholds are linter-defined. A call that gets no answer before a shorter `--timeout` is an RT-005 warning. The GET probe uses 5 s and the TLS check 10 s. |
| `--max-duration <ms>` | no limit | Overall deadline for the whole check. When it runs out, the report covers what ran, says in which phase it stopped, and the verdicts read `INCOMPLETE`: after a handshake the run exits 4 at any `--fail-on` and reads `Result: INCOMPLETE (stopped at --max-duration during <phase>)`; before one it exits 3 and reads `FAIL (could not connect)`. |
| `--fail-on error\|warning\|never` | `error` | Controls exit code 1. Each finding counts at its severity for the `--target` directories (`all` = Claude and ChatGPT). |
| `--fail-on-spec` | off | Also count MCP spec findings toward `--fail-on`. Without it, spec-only findings are reported but never fail the run. |
| `--fail-on-incomplete` | off | Exit 3 when the check is partial: the server requires auth and no token was given (`auth-required`), the token was rejected (`token-rejected`) or `tools/list` failed (`list-failed`). Without it a partial check exits by `--fail-on` like a complete one, so an expired token in CI can leave the job green; use it in CI with a token. A `--max-duration` stop is exit 4 with or without it. |
| `--baseline <file>` | | A JSON report of an earlier run (`--save-baseline <file>`, or `--format json --output <file>`). Findings already in it are **known**: they do not count toward `--fail-on`, the verdicts or the error, warning and info counts, and get no GitHub annotation; only new findings do. A finding is matched by rule, tool or resource, `path` and platforms (a baseline for `--target all` covers a run for `--target claude`), not by its message, so a reworded message or a changed number stays known; among several findings of one rule on one subject the message (numbers aside) decides which is which, and one more than the baseline had is new. SRV-020 (the protocol era note) is never known. JSON lists every finding with `baselined: true` or `false` and `summary.baselined`; SARIF sets `baselineState` to `unchanged` or `new`; text and markdown list only the new findings and one line `N known finding(s) from baseline, not listed: <rule IDs>` (not with `--quiet`). The score still counts every finding. A missing file or a file that is not a JSON report of mcp-review-check is a usage error (exit 2). The tool definitions are compared too, see [Tool-definition drift](#tool-definition-drift). |
| `--fail-on-drift` | off | With `--baseline`: exit 1 when a tool was added, removed or changed since the baseline, also with `--fail-on never` (either one suffices). Without it, drift is reported but never changes the exit code. The verdicts and `summary.failed` stay about findings. Without `--baseline` a usage error (exit 2). Config key `failOnDrift`. |
| `--diff-only` | off | With `--baseline`, text and markdown: only the new findings and the [tool-definition drift](#tool-definition-drift), without the `N known finding(s) from baseline` line and the manual checklist (also with `--checklist`, and in the GitHub job summary). JSON, SARIF and JUnit are unchanged. Without `--baseline` a usage error (exit 2). Config key `diffOnly`. |
| `--local`, `--no-local` | detected | Force [local mode](#local-mode) on or off, whatever the host; `--no-local` also makes a `--stdio` run strict. Not both. |
| `--active` | off | Runs the RT rules by calling read-only tools: the first 50 that qualify, at most 3 calls each. Also lists the tools on up to three fresh connections whose `clientInfo.name` is `mcp-review-check`, `claude-ai` and `Anthropic` (RT-012). |
| `--active-auth` | off | Probes DCR, `/authorize` and `/token`. **Creates a DCR client** on your authorization server. |
| `--tool-args <file>` | | JSON `{ "toolName": { ...args } }` for `--active`, in UTF-8 (with or without a BOM) or UTF-16LE with a BOM (what Windows PowerShell 5.1 writes). Otherwise arguments are synthesized from the schema. |
| `--stdio "<command>"`, `--stdio -- <command> [args...]` | | Launch a local server over stdio. The string form splits on whitespace and honours single and double quotes; a backslash is literal, so Windows paths such as `C:\Users\me\server.js` and `"\\host\My Share\server.js"` work. Inside double quotes a backslash escapes only `"`, by the Windows rule on every OS: `\"` is a literal `"`, `\\"` is one backslash that ends the quote (`"C:\srv\\"`), and `\\` and `\$` stay as written (on Linux and macOS too, unlike a shell). The `--` form passes every argument verbatim (no quoting rules) and must come last. |
| `--env K=V`, `--cwd <dir>` | | stdio only. `--env` values are redacted in every output format (see Redaction below). The server gets only `HOME, LOGNAME, PATH, SHELL, TERM, USER` from your environment (on Windows `APPDATA, HOMEDRIVE, HOMEPATH, LOCALAPPDATA, PATH, PROCESSOR_ARCHITECTURE, PROGRAMFILES, SYSTEMDRIVE, SYSTEMROOT, TEMP, USERNAME, USERPROFILE`) plus the `--env` values: pass anything else it needs, such as an API key or `TMPDIR` (macOS), with `--env`. On Windows names are case-insensitive, so `--env Path=…` replaces the inherited `PATH`. |
| `--ignore <RULE-ID>` | | Repeatable, any case, or a comma-separated list. Ignored findings stay visible in JSON under `ignored` and count neither toward the exit code nor toward the score. An ID that is neither a rule nor a `MAN` item is a usage error (exit 2), so a typo does not silently ignore nothing. |
| `--list-rules [prefix]` | | Prints the catalog and exits: `--format text` (default; with `--verbose`, each rule's rationale), `json` or `markdown` (the tables in [docs/RULES.md](docs/RULES.md)); `--format sarif` and `junit` print the text catalog with a warning on stderr and exit 0. A prefix such as `TOOL` or `MAN` keeps the IDs that start with it. |
| `explain <RULE-ID>` | | Prints a rule's severity per directory, rationale, sources and fix, and how to `--ignore` it; also takes `MAN` IDs. An unknown ID exits 2. |
| `--quiet` | off | Text only: prints just the error and warning findings, the Score line (without the info count), the Result line and the disclaimer. A failed connect (with its cause) or a partial check, such as missing auth, is named in the Result line. Ignored by `json`, `markdown`, `sarif` and `junit`. |
| `--plugin-dir <dir>` | none | Also lints a Claude plugin folder (LST rules), see [Listing and plugin manifests](#listing-and-plugin-manifests). Path relative to the working directory; needs a `<url>` or `--stdio` target. Config key `pluginDir`. |
| `--openai-manifest <file>` | none | Also lints a ChatGPT plugin package manifest (LST rules). Path relative to the working directory; needs a `<url>` or `--stdio` target. Config key `openaiManifest`. |
| `--checklist` | off | Text only: prints the manual checklist in full. By default the text report shows one line, `N manual items: --checklist to show`; markdown and JSON always list every item. |
| `--config <file>`, `--no-config` | discovered | Options from a JSON file, see [Config file](#config-file). Without `--config`, `mcp-review-check.config.json` or else `.mcp-review-check.json` in the `--cwd` directory (or the working directory) is read when it exists; `--no-config` turns that off. Not both. |
| `--no-color`, `--verbose`, `--help`, `--version` | | `--no-color` turns colours off (they are also off without a TTY or with `NO_COLOR`; `FORCE_COLOR=1` turns them on without a TTY, see [GitHub Actions](#github-actions)). `--verbose` expands collapsed findings, shows TOOL-013 info and each rule's rationale (the markdown report always lists them under "Why these rules"), and prints the redacted HTTP trace. |

Environment variables: `MCP_REVIEW_CHECK_TOKEN` is the default for `--bearer` (see [Token recipe](#token-recipe)); `NO_COLOR` and `FORCE_COLOR` set colours; `GITHUB_ACTIONS` and `GITHUB_STEP_SUMMARY` turn on [GitHub Actions](#github-actions) output.
`MCP_REVIEW_CHECK_NO_CTA=1` hides the call to action: the maintainer's e-mail address, which text and markdown reports show above the disclaimer on a `BLOCKED`, legacy-era or auth-required result (JSON always has it in `contact`, SARIF never).

### Config file

Options can live in a JSON file next to the server instead of on every command line. `--config <file>` names it; without `--config` the first of `mcp-review-check.config.json` and `.mcp-review-check.json` that exists in the `--cwd` directory, or else in the working directory, is read (`--no-config` skips that). The config file applies to a check, not to `--help`, `--version`, `--list-rules` or `explain`.

```json
{
  "stdio": "node",
  "args": ["dist/server.js"],
  "env": { "API_BASE": "http://localhost:4000" },
  "target": "claude",
  "failOn": "warning",
  "failOnSpec": true,
  "failOnIncomplete": false,
  "ignore": ["TOOL-013"],
  "timeout": 60000,
  "maxDuration": 300000,
  "active": true,
  "toolArgs": "tool-args.json",
  "format": "markdown",
  "output": "mcp-review.md",
  "baseline": ".mcp-review-check/baseline.json",
  "jsonOutput": "mcp-review.json"
}
```

- **Keys** are the long option names in camelCase: `target`, `format`, `output`, `jsonOutput`, `saveBaseline`, `sarifLocation`, `timeout`, `maxDuration`, `failOn`, `failOnSpec`, `failOnIncomplete`, `baseline`, `local`, `noLocal`, `active`, `activeAuth`, `toolArgs`, `ignore`, `header`, `bearer`, `env`, `cwd`, `noColor`, `verbose`, `quiet`, `checklist`, `failOnDrift`, `diffOnly`, `pluginDir`, `openaiManifest`. Switches take `true` or `false` (`false` is the same as leaving the key out); `timeout` and `maxDuration` a number; `ignore` a string or an array; `header` an array of `"Name: value"` strings or an object `{"Name": "value"}`; `env` an array of `"K=V"` strings or an object.
- **The server**: `url` (`{"url": "https://mcp.example.com/mcp"}`), or `stdio` as one command line, split as `--stdio "<command>"` is, or `stdio` with `args`, passed verbatim like `--stdio -- <command> [args...]` (`stdio` may also be an array). A `<url>` or `--stdio` on the command line replaces the file's server.
- **Precedence**: an option on the command line wins over the file's key; a list option on the command line (`--ignore`, `--header`, `--env`) replaces the file's list instead of adding to it.
- **Paths** in `output`, `jsonOutput`, `saveBaseline`, `baseline`, `toolArgs`, `cwd`, `pluginDir` and `openaiManifest` are relative to the config file's directory; `sarifLocation` stays repository-relative.
- **Validation** is the same as for the options. An unknown key (`fail-on` is answered with "did you mean failOn"), a value of the wrong type, a file that is not a JSON object, a file that is not valid JSON and a `--config` file that does not exist are usage errors (exit 2) that name the file and the key and never repeat a value.
- **Secrets**: `header` and `bearer` are accepted but print a warning, since a token in a file is easily committed; keep the token in `$MCP_REVIEW_CHECK_TOKEN`. Values from the file are redacted in every output like the same options.

### Listing and plugin manifests

Pass the files you submit and the same run lints them against the directory checklists (rules `LST-001` to `LST-026`). Both options need a server target (`<url>` or `--stdio`): the manifests are checked next to the live server, for example that the test cases' `tools_triggered` exist in `tools/list`. Without the options nothing changes and the LST rules are skipped ("needs --plugin-dir" / "needs --openai-manifest").

```sh
# A Claude plugin folder (the one holding .claude-plugin/plugin.json)
npx mcp-review-check https://mcp.example.com/mcp --plugin-dir ./my-plugin --target claude

# A ChatGPT plugin package: plugin.json (extensions.com.openai) or .codex-plugin/plugin.json; the package's mcp.json is read too
npx mcp-review-check --stdio "node dist/server.js" --openai-manifest ./package/plugin.json --target chatgpt
```

`--plugin-dir` checks `.claude-plugin/plugin.json` (name, description, author, version, listing URLs, icon), a README of at least 40 words, a LICENSE, `.mcp.json` (schema, `https://`/`wss://` remote URLs, exact `npx pkg@x.y.z` / `uvx pkg==x.y.z` pins, no `.mcpb`/`.dxt` bundles, no credentials in headers), no registry in `.npmrc` next to a launcher, and no system files. `--openai-manifest` checks the listing text limits, the four HTTPS listing URLs, starter prompts, brand color contrast, icons, exactly 5 positive and 3 negative review test cases, and no `clientSecret`, reviewer credentials, server headers, apps or hooks. Nothing is fetched and links are not followed. The manual checklist leaves out the items these rules cover.

A path that does not exist, or is a file where a folder is wanted (or the reverse), is a usage error (exit 2) that names the flag and not the path. A file inside that cannot be read or parsed is a warning on stderr (relative path and error code only). Values that may be credentials (headers, `env`, `clientSecret`) are never quoted in a finding. In the [config file](#config-file) the keys are `pluginDir` and `openaiManifest`, relative to the file; the flags win over the keys.

### Output formats

| Format | What it is |
|---|---|
| `text` | The terminal report (default), colours on a TTY. |
| `json` | One JSON document (`schemaVersion` 1, `$schema` the [report JSON Schema](#json-schema)): every finding, skipped rules, ignored findings, the manual checklist, `summary` with the score, verdicts and gate, and `toolFingerprints` (one SHA-256 per tool definition). The input of `--baseline`. `--json-output` and `--save-baseline` write this document besides any other format. |
| `markdown` | A report for a pull request comment or the GitHub job summary, with an Evidence column and the `rerun:` line. |
| `sarif` | SARIF 2.1.0 for GitHub code scanning (see `--sarif-location`). |
| `junit` | JUnit XML for CI test views: GitLab `artifacts: reports: junit`, [dorny/test-reporter](https://github.com/dorny/test-reporter), Jenkins. |

The JUnit report has one `<testsuite>` per gated platform (the `--target` directories, `claude` and `chatgpt` for `all`, plus `spec` with `--fail-on-spec`) and one `<testcase>` per rule of that platform, with `classname` the platform and `name` the rule ID and title. A rule whose findings reach `--fail-on` at that platform's severity has one `<failure>` (the message of each finding with its evidence and fix); lower findings, findings known from `--baseline` (never failures) and `--ignore`d ones are listed in `<system-out>` (each suite's own `<system-out>` also lists the [tool-definition drift](#tool-definition-drift)); a rule that did not run is `<skipped>` with the reason. A failed connect or a `--max-duration` stop adds an `<error>` test case to each suite. `tests`, `failures`, `errors` and `skipped` count the test cases, and each suite's `<properties>` carry the target, score, `--fail-on` and verdict. Server text is escaped and control characters are shown as `\u{..}`, as in text reports.

```xml
<testsuites name="mcp-review-check" tests="76" failures="8" errors="0" skipped="34" time="0.573">
  <testsuite name="claude" tests="76" failures="8" errors="0" skipped="34">
    <testcase classname="claude" name="TOOL-006 Tool has a title">
      <failure message="[error] update_settings: no title" type="error">[error] update_settings: no title
  fix: Add `title` (top level, or in `annotations.title`).</failure>
    </testcase>
    <testcase classname="claude" name="SRV-001 Remote server served over HTTPS">
      <skipped message="stdio target"/>
    </testcase>
  </testsuite>
</testsuites>
```

### Tool-definition drift

Every JSON report records a fingerprint of each tool in `toolFingerprints`: `name`, `sha256` (SHA-256 of the canonical JSON, keys sorted at every depth and no whitespace, of the tool's `name`, `title`, `description`, `inputSchema`, `outputSchema`, `annotations` and `_meta`, those present) and `fields` (one SHA-256 per present field). It is `null` when `tools/list` did not finish (failed connect, partial check, a `--max-duration` stop before the listing). With `--baseline`, the tools of this run are paired by name with the baseline's and the report gets a **Changed tool definitions** section: tools added, removed, and changed with the top-level fields that changed (a change of key order alone is not a change).

| Format | Where |
|---|---|
| `text` | `CHANGED TOOL DEFINITIONS (N since baseline)` after the findings, one line per tool (`+` added, `-` removed, `~ name: changed: description, inputSchema`); `Tool definitions: no change since baseline (N tools).` otherwise. With `--quiet`, only when there are changes. |
| `markdown` | `## Changed tool definitions (N since baseline)` with a Tool and Change table, after the findings. |
| `json` | `baseline.toolChanges`: `{"added": [...], "removed": [...], "changed": [{"name": "...", "fields": ["description"]}]}`. |
| `sarif` | One `note` result per change with `ruleId` `BASE-001` ("Tool definition changed since baseline"), `baselineState` `new` and `properties.change` (`added`, `removed` or `changed`, with `fields`). BASE-001 is synthetic: it is added to the run's rules only when there is a change and is not in the catalog (`--list-rules`, `explain` and `--ignore` do not know it). |
| `junit` | In each suite's `<system-out>`, never a failure. |

Drift is informational: it does not change the verdicts, the counts or the exit code unless `--fail-on-drift` is given. A baseline written by 0.3 or older has no fingerprints: it is still accepted (its findings are known as before) and the section reads `Tool definitions not compared: tool fingerprints were not recorded in the baseline`; write it again with `--save-baseline` to start comparing. The fingerprints are taken from the report as written, so secrets are redacted before hashing (a rotated secret echoed in a description is not a change) and tool names in the section are redacted like everything else; a string longer than the input cap (`limits.truncated`) is compared up to the cap.

### JSON Schema

[`schema/report.schema.json`](schema/report.schema.json) (JSON Schema draft 2020-12) describes the JSON report and ships in the npm package (`node_modules/mcp-review-check/schema/report.schema.json`). Its `$id`, which every JSON report names in `$schema`, is `https://raw.githubusercontent.com/alisaosipova/mcp-review-check/v0.4.0/schema/report.schema.json`. Fields added after 0.1 say since which release in their `description`. Objects do not allow other properties, so a field this schema does not know fails validation; `schemaVersion` is bumped on a breaking change. To check the report in CI, for example with [ajv-cli](https://github.com/ajv-validator/ajv-cli):

```bash
npx mcp-review-check@0.4 --fail-on never --json-output report.json --stdio -- node dist/server.js
npx -y -p ajv-cli@5 -p ajv-formats@3 ajv validate --spec=draft2020 -c ajv-formats -s node_modules/mcp-review-check/schema/report.schema.json -d report.json
```

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Completed, below the `--fail-on` threshold |
| 1 | Completed, threshold reached for a `--target` directory (or for the spec with `--fail-on-spec`), or with `--fail-on-drift` a tool definition changed since `--baseline` |
| 2 | Usage or configuration error (an unknown option names the closest one; an unknown `--ignore` or `explain` ID; a wrong [config file](#config-file)), or `--output`, `--json-output` or `--save-baseline` could not be written |
| 3 | Could not reach the server or complete any handshake, also when `--max-duration` ran out before the handshake (a report is still printed, with verdicts `INCOMPLETE` and no manual checklist); with `--fail-on-incomplete`, a partial check (`auth-required`, `token-rejected`, `list-failed`); or the linter itself failed unexpectedly (`fatal:` and a stack trace on stderr; please [report it](https://github.com/alisaosipova/mcp-review-check/issues/new?template=bug.yml)) |
| 4 | `--max-duration` stopped the check after the handshake (whatever `--fail-on`, also with errors found before the stop): the report covers what ran. New in 0.2.0; 0.1.x exited 3 |
| 128+N | Ended by signal N: 130 for SIGINT (Ctrl+C), 143 for SIGTERM (a CI job cancelled), 131 for SIGQUIT, 129 for SIGHUP. A stdio server is ended first, and no report is written. On Windows the exit code is set to the same 128+N |

The exit code follows `--target`: a finding counts at the severity it has for Claude or ChatGPT, so a check for the Claude directory does not fail on a ChatGPT-only error or on an MCP spec error the directory does not check. Spec findings fail the run only with `--fail-on-spec`. The `Result:` line (and the `--output` summary line, and `summary.gate` in JSON) names what failed the run, for example `Result: FAIL (--fail-on error) · claude: 2 errors (TOOL-006, TOOL-011)`, and, on a pass or a fail, the spec findings that no chosen directory counted. A run that could not connect (exit 3) reads `Result: FAIL (could not connect)`, never `PASS`, and its Claude and ChatGPT verdicts read `INCOMPLETE` even when a static check such as SRV-001 (`http://` URL) has an error. A run stopped by `--max-duration` after the handshake (exit 4) reads `Result: INCOMPLETE (stopped at --max-duration during listing)`, followed by the findings that reached the threshold before the stop. On exit 3 and 4, JSON `summary.failed` is `true`.

A partial check (JSON `coverage.toolLevel` is `auth-required`, `token-rejected` or `list-failed`) still exits by `--fail-on`: the auth and server checks ran, the tool checks did not, and the score is `n/a`. Add `--fail-on-incomplete` to make it exit 3 instead.

A `401` without `--bearer` is not fatal: the auth probe runs and the report says which checks need a token.

If the server declares tools but `tools/list` fails (error, crash, timeout, or more than 100 pages), SPEC-020 reports an error and the report says that tool checks could not run.

A failed connect names its cause instead of `fetch failed`: the hostname does not resolve, the connection was refused or timed out, the TLS certificate is not trusted (`CERT_*`, self-signed), or the URL answered 404/405/an HTML page and is not an MCP endpoint, with a suggested URL (`<url>/mcp`, or `/mcp` instead of the deprecated `/sse`). A URL without a scheme is rejected with a suggestion (`https://…`, or `http://` for localhost and for a name without a dot followed by a port, such as `mcp:8080/mcp`). Timeouts, connection resets, 5xx and 429 (honouring `Retry-After` up to 5 s) are retried (at most 3 attempts, a timeout only once) in the preflight, Origin, challenge, OAuth metadata, invalid-token and TLS probes; a probe that still fails only for network reasons is reported as `inconclusive (network)` (info), not as an error.

**Redaction.** One redactor covers the whole report in every format (messages, evidence, target, SARIF run properties, the markdown `rerun:` line, GitHub annotations and job summary, fatal message, stdio stderr, `--verbose` trace): `--bearer`, `--header` values, `--env` values and their parts (the password and username of a URL, the token after `Bearer`), secret query and fragment parameters (`api_key`, `token`, `#access_token`, ...), the username and password in `user:pass@` (also `https://TOKEN@host`), stdio arguments that follow a secret-looking flag (`--api-key X`, `--accessToken X`, `--token=X`, `API_KEY=X`, `"Authorization: Bearer X"`), and tokens in a known format (`sk-…`, `ghp_…`, `github_pat_…`, `glpat-…`, `xox…-`, `AKIA…`, `AIza…`, `npm_…`, `hf_…`, a JWT) as a bare stdio argument, a URL path segment or a query value under any name, including when the server echoes them on stdout, on stderr or in what it lists. Usage errors never repeat option values. Values shorter than 4 characters, `true`, `false`, `yes`, `no`, `on`, `off`, `null`, `undefined`, `none` and numbers with up to 6 digits before an optional decimal part are not treated as secrets: they would blank out unrelated report text. Nor are common settings under a plain `--env` name (`production`, `development`, `staging`, `test`, `local`, log levels such as `debug`, version numbers such as `1.2.3` or `v2.0.1-rc.1`); under a secret-looking name they are masked. A `Cookie` header is masked pair by pair, and a session-like or token-like cookie value on its own; a `Basic` credential also by its decoded `user:pass` and password, so a server that echoes the plain password does not leak it.

**Redaction before the rules.** The rules read what the server sent with only the strong values masked: `--bearer`, `--header` values, `--env` values under a secret-looking name (`API_KEY=…`), URL credentials (a URL username only when it looks like a token) and stdio arguments after a secret-looking flag. Other `--env` values and their parts (`--env FORMAT=text`, the user and password in `--env DATABASE_URL=postgres://postgres:postgres@db/app`) are masked in the finished report and every other output only, unless a part looks like a token (a known format, or 16 or more characters with letters and digits), so a plain word there changes no finding, severity or exit code. Protocol and schema words (`object`, `string`, `title`, `type`, `properties`, `text`, `image`, `json`, `html` and the like) are never treated as secrets. Give a secret under a secret-looking name, so that it is masked before any cut (see [SECURITY.md](SECURITY.md)).

**Input caps.** Before the pattern rules run, metadata strings over 16 KB and UI resources over 2 MB are truncated and the report lists what was cut (JSON `limits.truncated`); names, URIs, regex patterns and other schema syntax are kept up to 1 MB, so they are compared whole. The `--active` calls' arguments, JSON-RPC and transport errors and the JSON-RPC errors observed during the run are capped at 16 KB per string too. At most 50 UI resources are read per run, and the report says when more were listed. SDK error bodies are capped at 64 KB. To bound memory on a hostile server, an HTTP response body is read up to 64 MiB (per event on an SSE stream), each listing (`tools/list` and the others) up to 64 MiB over all its pages and at most 100 pages, and a stdio message up to 64 MiB (a larger one is named as the cause of the errors that follow); of a stdio server's stdout lines that are not JSON-RPC, the first 50 are kept, with the total count.

**Server text in reports.** Text and markdown reports show control, bidi and zero-width characters from the server (ESC, CR, LF, U+202E, …) as `\u{..}`, so a server name, tool name or message cannot recolour the terminal, add a hyperlink, reorder text or start a GitHub workflow command line. Markdown reports also escape markdown syntax in server text (see [SECURITY.md](SECURITY.md)). JSON and SARIF keep the text as sent.

Findings that apply to several platforms carry a severity per platform (for example `[spec, chatgpt: warning]`), and each platform verdict counts that platform's own severity.

### Example output

```
mcp-review-check 0.3.0 · rules 2026-11-01 · target: all
Server  repo-wiki 0.1.0 · https://mcp.wiki.example/mcp
Transport streamable-http · era legacy (2025-11-25) · auth none
          2026-07-28 clients fall back to initialize. Not a defect.
Checked 3 tools · 0 resources · 0 prompts · 0 UI resources · 90 rules run · 54 skipped (16 server did not request auth; …)

ERRORS (9)
  x TOOL-006 [claude] 3 tools: no title: ask_question, read_wiki_contents, read_wiki_structure
      fix  Add `title` (top level, or in `annotations.title`).
      docs https://claude.com/docs/connectors/building/review-criteria
  x TOOL-011 [claude] 3 tools: neither readOnlyHint nor destructiveHint is set: ask_question, read_wiki_contents, read_wiki_structure
  ...
  x TOOL-012 [chatgpt] 3 tools: missing readOnlyHint, destructiveHint, openWorldHint: ask_question, read_wiki_contents, read_wiki_structure
  ...

INFO (2)
  i TOOL-005 [chatgpt] ask_question: name contains no recognizable verb
  ...

FIX SNIPPETS (add to each tool definition; check the guessed hint values)
  read_wiki_structure: {"title":"Read wiki structure","annotations":{"readOnlyHint":true,"destructiveHint":false,"openWorldHint":true}}
  read_wiki_contents: {"title":"Read wiki contents","annotations":{"readOnlyHint":true,"destructiveHint":false,"openWorldHint":true}}
  ask_question: {"title":"Ask question","annotations":{"readOnlyHint":false,"destructiveHint":true,"openWorldHint":true}}

22 manual items: --checklist to show

Score 64/100 · 3 root causes · 9 errors · 0 warnings · 3 info
Claude: BLOCKED (6 errors) · ChatGPT: BLOCKED (3 errors) · Result: FAIL (--fail-on error) · claude: 6 errors (TOOL-006, TOOL-011); chatgpt: 3 errors (TOOL-012)
```

Three tools without a title or annotations make 9 findings but 3 root causes: the score is `100 − 3 × 12 = 64`, and pasting the fix snippets clears all of them.

The protocol revision is in the header (the SRV-020 finding stays in JSON and SARIF only), and the TOOL-013 info about `idempotentHint` on a read-only tool is shown only with `--verbose`. Findings with the same rule and message are collapsed into one line with a count (`--verbose` lists each one), and every tool without a title or annotation hints gets a JSON fragment to paste in. The score counts root causes, not findings: `100 − 12` per rule with an error `− 4` per rule with only warnings, not below 0 (JSON `summary.scoreVersion: 2`); it is provisional. The score is one number per server: it counts the findings of every platform whatever `--target`, and so does the root-cause count next to it (JSON `summary.rootCauses`); findings of `--ignore`d rules are left out of both, while the listed findings, the verdicts and the exit code follow `--target`. Per-platform verdicts are `BLOCKED`, `NEEDS ATTENTION` or `NO AUTOMATED BLOCKERS`. When tool-level checks cannot run (OAuth without `--bearer`, a failed connect or a failed `tools/list`), the score is `n/a` and a verdict without errors is `INCOMPLETE`, never a pass; after a failed connect every verdict is `INCOMPLETE`.

### Local mode

Stdio servers and HTTP targets on a host without a dot (`localhost`, a container name such as `http://mcp:8080`) or whose every address is non-public (`127.0.0.0/8`, `::1`, `10/8`, `172.16/12`, `192.168/16`, …, counting both public DNS and the system resolver, so `/etc/hosts` and container DNS names count) run in **local mode**: deploy-time checks (HTTPS, public DNS, tunnel domains) are reported as info so you can lint before deploying. A banner names the rules that were made informational (on stderr for `json` and `sarif`); `--no-local` keeps them strict and `--local` forces local mode for any host. SRV-004 tells a name that "resolves only locally" (the system resolver answers, public DNS has no A record) from one with no A record at all.

### GitHub Actions

When `GITHUB_ACTIONS=true` (GitHub sets it on every runner), each finding that is a warning or an error for the `--target` directories (and for the MCP spec with `--fail-on-spec`) is also printed on stderr as an `::error` or `::warning` workflow annotation, at the severity it has for those platforms, as for the exit code. Exit 3 and 4 add one `::error` titled `mcp-review-check` with the cause (could not connect, stopped by `--max-duration`, or an unexpected failure, secrets redacted). A partial check (no token, a rejected token, `tools/list` failed) adds one `::warning` titled `mcp-review-check` that names the reason and says that tool checks were skipped, whatever the exit code. The markdown report is appended to the job summary when `$GITHUB_STEP_SUMMARY` is set. stdout keeps the chosen format, so `--format json` and `sarif` stay a single document. To run the check as a workflow step with a SARIF upload, use [the GitHub Action](#ci-recipes) (`uses: alisaosipova/mcp-review-check@v0.3.0`). There is no separate switch: without `GITHUB_ACTIONS` (or without `GITHUB_STEP_SUMMARY`, for the summary) nothing is annotated or written. `FORCE_COLOR=1` colours the text report without a TTY (the Actions log shows ANSI colours); `FORCE_COLOR=0` and `--no-color` turn colours off.

The markdown report (and so the job summary) has an Evidence column with the text a rule matched, and a `rerun: npx mcp-review-check …` line with the options of the run, secrets redacted, to reproduce it locally (`--quiet` and `--checklist` are left out: they change only the text report). On Windows the line quotes arguments with double quotes, for cmd.exe (an argument that holds both `"` and one of `& | < > ^`, such as `--stdio "node s.js --filter \"a|b\""`, can split in cmd.exe, which ignores the backslash before `"`: check such a line before you run it; in PowerShell, quote again an argument that contains `"`, `$` or a backtick: PowerShell reads `\"` and `$` inside double quotes its own way; not yet tried on a real Windows machine); elsewhere with single quotes, for `sh`.

## Token recipe

On a server that answers `401`, the auth checks run without a token, and the report says that the tool, resource and UI checks need one. mcp-review-check does not run the browser sign-in itself; give it an access token:

1. Use a test account: the one you give the directory reviewers anyway (MAN-003, MAN-026), not a personal or admin account.
2. Get an access token for that account from your authorization server, issued for this MCP server: ask for the server URL as the `resource` ([RFC 8707](https://www.rfc-editor.org/rfc/rfc8707.html)), because the server must check the token's audience ([MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)). If your authorization server allows the client credentials grant ([RFC 6749, section 4.4](https://www.rfc-editor.org/rfc/rfc6749.html#section-4.4)) for a test client:

   ```bash
   export MCP_REVIEW_CHECK_TOKEN="$(curl -s https://auth.example.com/oauth/token \
     -d grant_type=client_credentials -d client_id="$CLIENT_ID" -d client_secret="$CLIENT_SECRET" \
     -d resource=https://mcp.example.com/mcp | jq -r .access_token)"
   ```

   Otherwise, mint a token for the test account with your identity provider's own tools, or sign in once with an MCP client and copy the access token it received.
3. Run the check with the token in `MCP_REVIEW_CHECK_TOKEN` (it stays out of shell history; `--bearer` works too). The token is redacted in every report format. In CI, keep it in a secret (see [CI recipes](#ci-recipes)).

If the report says "Server rejected the token (401)", check the token's audience (`resource`), expiry and scopes.

## CI recipes

Pin the minor version (see [Stability policy](#stability-policy)). On GitHub Actions the findings also appear as annotations and the markdown report in the job summary (see [GitHub Actions](#github-actions)); the exit code fails the job (see [Exit codes](#exit-codes)).

**A stdio server, on every push** — build it and let mcp-review-check start it:

```yaml
name: mcp-review-check
on: [push, pull_request]
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      - run: npm ci && npm run build
      - run: npx -y mcp-review-check@0.3 --target claude --stdio -- node dist/server.js
```

**A preview deployment URL** — check each successful deployment (for example, a preview per pull request) through the [`deployment_status`](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#deployment_status) event:

```yaml
name: mcp-review-check preview
on: deployment_status
jobs:
  review:
    if: github.event.deployment_status.state == 'success'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      - run: npx -y mcp-review-check@0.3 "$PREVIEW_URL/mcp" --target claude
        env:
          PREVIEW_URL: ${{ github.event.deployment_status.environment_url }}
          MCP_REVIEW_CHECK_TOKEN: ${{ secrets.MCP_REVIEW_CHECK_TOKEN }}
```

`environment_url` is the URL your deployment tool reports for the environment ([deployment statuses](https://docs.github.com/en/rest/deployments/statuses)). A preview on a shared platform domain (`*.vercel.app`, `*.netlify.app`, ...) gets an SRV-005 info note, since the production server's domain should match your service. If previews sit behind a login wall, pass the bypass header your host documents with `--header` (header values are redacted). Drop `MCP_REVIEW_CHECK_TOKEN` if the server needs no auth. For other CI systems the same command works: the exit code is the result, and `--format json` or `--output` give a file to keep.

**Fail only on new findings** — keep a JSON report of the accepted state in the repository and pass it with `--baseline`: known findings stay in the report but no longer fail the job, a new finding does. Write the file once with `--save-baseline` (`--fail-on never` so the first run passes), commit it, and refresh it the same way when you accept new findings:

```bash
npx mcp-review-check@0.3 --target claude --fail-on never --save-baseline .mcp-review-check/baseline.json --stdio -- node dist/server.js
```

```yaml
      - run: npx -y mcp-review-check@0.3 --target claude --baseline .mcp-review-check/baseline.json --stdio -- node dist/server.js
```

`--save-baseline` writes the same document as `--format json --output <file>`, besides the report you chose, so one run can print the text report and refresh the baseline.

**Catch tool-definition changes** — the same baseline also holds a fingerprint of every tool, so the job reports which tools were added, removed or changed since it was saved ([Tool-definition drift](#tool-definition-drift)). Add `--fail-on-drift` to fail the job on any change until the baseline is refreshed, and `--diff-only` to keep the text or markdown report to what is new:

```yaml
      - run: npx -y mcp-review-check@0.4 --target claude --baseline .mcp-review-check/baseline.json --fail-on-drift --diff-only --stdio -- node dist/server.js
```

**JUnit test reports** — GitLab shows the `junit` report in the merge request and the pipeline's Tests tab; each rule is a test, a finding at `--fail-on` a failed test:

```yaml
mcp-review-check:
  image: node:22
  script:
    - npm ci && npm run build
    - npx -y mcp-review-check@0.3 --target claude --format junit --output mcp-review-check.xml --stdio -- node dist/server.js
  artifacts:
    when: always
    reports:
      junit: mcp-review-check.xml
```

On GitHub Actions, [dorny/test-reporter](https://github.com/dorny/test-reporter) reads the same file (`reporter: java-junit`, `path: mcp-review-check.xml`, in a step with `if: always()`).

**Fail when the token stops working** — without a valid token the tool checks are skipped and the run can still pass (the job gets a `::warning`). With a token in CI, add `--fail-on-incomplete` so that a missing, expired or rejected token fails the job (exit 3):

```yaml
      - run: npx -y mcp-review-check@0.3 "$MCP_URL" --target claude --fail-on-incomplete
        env:
          MCP_URL: https://mcp.example.com/mcp
          MCP_REVIEW_CHECK_TOKEN: ${{ secrets.MCP_REVIEW_CHECK_TOKEN }}
```

A run cut off by `--max-duration` exits 4, so a step can tell a slow server from an unreachable one (exit 3): for example, `npx -y mcp-review-check@0.3 "$MCP_URL" --max-duration 120000 || [ $? -eq 4 ]` lets a slow run pass the step and still fails on every other non-zero code.

**The GitHub Action** — the same check as a step, with annotations, the job summary and a SARIF upload to code scanning:

```yaml
name: mcp-review-check
on: [push, pull_request]
permissions:
  contents: read
  security-events: write # upload-sarif; drop it with upload-sarif: false
  actions: read          # upload-sarif in a private repository
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      - run: npm ci && npm run build
      - uses: alisaosipova/mcp-review-check@v0.3.0
        with:
          stdio: node dist/server.js
          platform: claude
```

For a deployed server, give `target` instead of `stdio` and pass the token as a secret:

```yaml
      - uses: alisaosipova/mcp-review-check@v0.3.0
        with:
          target: https://staging.example.com/mcp
          bearer: ${{ secrets.MCP_REVIEW_CHECK_TOKEN }}
          fail-on: warning
```

| Input | Default | Notes |
|---|---|---|
| `target` | | Server URL. Give `target` or `stdio`, not both. |
| `stdio` | | Command that starts a local server, as `--stdio "<command>"` (split without a shell). |
| `platform` | `all` | `--target`: `claude`, `chatgpt` or `all` (`both` = `all`). |
| `fail-on` | `error` | `error`, `warning` or `never`. |
| `fail-on-spec` | `false` | Also fail on MCP spec findings. |
| `active` | `false` | `--active`: calls the tools annotated `readOnlyHint: true`. |
| `bearer` | | Token, passed only as `MCP_REVIEW_CHECK_TOKEN`, never on the command line. Empty keeps one set in the job's `env`. |
| `version` | `0.3` | npm version or range of mcp-review-check to run; 0.3 or newer (the outputs read the report written with `--json-output`). |
| `sarif-file` | `mcp-review-check.sarif` | Where the SARIF report is written. |
| `upload-sarif` | `true` | Upload it with `github/codeql-action/upload-sarif` (needs `security-events: write`), also when the check fails. Set `false` on pull requests from forks, which cannot write code scanning results. |
| `extra-args` | | More options, split on whitespace (no quoting), for example `--timeout 60000 --ignore TOOL-013`. |
| `cli-path` | | Run `node <path>` (a built `dist/cli.js`) instead of the npm package. |

| Output | Value |
|---|---|
| `exit-code` | The CLI's exit code (see [Exit codes](#exit-codes)); the step fails with the same code. |
| `sarif-file` | Path of the SARIF report, empty when none was written. |
| `report-json` | Path of the JSON report (the `--format json` document) in the runner's temp directory, empty when none was written. |
| `score` | Score 0–100, empty for a partial check. |
| `verdict` | `PASS`, `FAIL` (threshold reached, or the server could not be checked) or `INCOMPLETE` (stopped by `--max-duration`), as the Result line. |
| `verdict-claude`, `verdict-chatgpt` | Directory verdict: `BLOCKED`, `NEEDS ATTENTION`, `NO AUTOMATED BLOCKERS` or `INCOMPLETE`; empty when the platform is not checked. |
| `errors`, `warnings` | Number of error and warning findings (with `--baseline` in `extra-args`, of the new ones only). |
| `new-findings` | Findings of any severity that are not in the baseline (all findings without one). |

Every output except `exit-code` and `sarif-file` is empty when no report was written (a usage error, exit 2). The outputs are set also when the check fails, so a later step with `if: always()` can use them:

```yaml
      - uses: alisaosipova/mcp-review-check@v0.3.0
        id: review
        with:
          stdio: node dist/server.js
      - if: always()
        run: echo "score ${{ steps.review.outputs.score }}, ${{ steps.review.outputs.verdict }}, ${{ steps.review.outputs.new-findings }} new"
```

The action needs Node 22.12 or newer on the runner (GitHub-hosted runners have it; add `actions/setup-node` otherwise). Pin a full tag such as `@v0.3.0` or a commit SHA.

## Docker Compose

To check a server in a Compose stack before it has a public URL, run mcp-review-check as one more service. The service name has no dot, so the run is in [local mode](#local-mode): deploy-time checks (HTTPS, public DNS) are info.

```yaml
services:
  mcp:
    build: .
    expose: ["8080"]
  review:
    image: node:22-slim
    command: npx -y mcp-review-check@0.3 http://mcp:8080/mcp --target claude
    depends_on: [mcp]
    profiles: [review]
```

```bash
docker compose run --rm review
```

A service with a [profile](https://docs.docker.com/compose/how-tos/profiles/) does not start with `docker compose up`; `docker compose run` starts it and the `mcp` service it depends on. If the server takes a while to start, give `mcp` a healthcheck and use `depends_on: {mcp: {condition: service_healthy}}` ([startup order](https://docs.docker.com/compose/how-tos/startup-order/)), or the first run may exit 3 (connection refused).

## What the tool sends

By default about 20 requests, none of which change state: an unauthenticated `initialize`, `server/discover`, the SDK handshake and list calls, a GET on the endpoint (aborted after headers), an unsupported protocol version, an unknown method, a call to a tool named `mcp_review_check_nonexistent_tool`, a read of `mcp-review-check://does-not-exist`, `initialize` with three `Origin` values (on a legacy HTTP+SSE server, a GET of the event stream with each `Origin`, cut after the headers), a second `tools/list` and one fresh connection, and `GET /.well-known/openai-apps-challenge`. When the endpoint redirects to another path on the same host (`/mcp` → `/mcp/`), the protocol probes go to the redirect target, as an MCP client would. Each Streamable HTTP session the check opens, its own connections' and one a stateful server mints for a raw `initialize` probe, is ended with one `DELETE`. Every connection declares the MCP Apps client capability (`extensions: {"io.modelcontextprotocol/ui": {"mimeTypes": ["text/html;profile=mcp-app"]}}`), so servers that register UI tools only for capable hosts show them; when a tool links a UI, one more connection without that capability lists the tools a text-only host sees (APPS-019). When the server answers 401 it also fetches the OAuth metadata documents and sends one request with an invalid bearer token. Transient failures of these probes are retried (at most 3 attempts, a timeout only once). With `--active` it also calls up to 50 read-only tools (at most 3 calls each) and lists the tools on up to three fresh connections whose `clientInfo.name` is `mcp-review-check`, `claude-ai` and `Anthropic` (RT-012); see [SECURITY.md](SECURITY.md) for `--active-auth`.

## Privacy

- No telemetry. mcp-review-check talks only to the server you check and, when it answers 401, to the authorization servers its OAuth metadata names (see [What the tool sends](#what-the-tool-sends)), plus your DNS resolver.
- The report goes to stdout or to the `--output` file, and nowhere else; with `GITHUB_ACTIONS=true` also to the job log and `$GITHUB_STEP_SUMMARY`. Nothing is kept between runs.
- `--bearer` and `MCP_REVIEW_CHECK_TOKEN`, `--header` and `--env` values, URL credentials and secret-looking stdio arguments are redacted in every format (see **Redaction** under [Usage](#usage)), including when the server echoes them.
- Without `--active` no tool of yours is called. `--active` calls only tools annotated `readOnlyHint: true`; `--active-auth` creates a DCR client on your authorization server.

## Rules

The full catalog, every rule with its severity per platform and its public source, and the manual checklist, is in [docs/RULES.md](docs/RULES.md), generated from the code (`npm run build && npm run readme:rules`). `mcp-review-check --list-rules` prints it, and `mcp-review-check explain <RULE-ID>` explains one rule.

## Compared with other tools

As of 2026-10-23; each statement links to the tool's own documentation, checked on that date. The tools answer different questions and can run side by side.

| Tool | What it does, per its documentation | Use it for |
|---|---|---|
| [MCP Inspector](https://github.com/modelcontextprotocol/inspector) | Connects to a server from a web UI, a terminal UI or a [scriptable CLI](https://github.com/modelcontextprotocol/inspector/blob/main/clients/cli/README.md) to list and call tools, read resources and get prompts; the CLI has exit codes for [CI smoke tests](https://github.com/modelcontextprotocol/inspector/blob/main/docs/cli-smoke-testing.md) and runs the OAuth sign-in | Trying your server by hand; asserting that a tool call returns what you expect |
| [MCP conformance](https://github.com/modelcontextprotocol/conformance) | Tests [client and server implementations against the MCP specification](https://github.com/modelcontextprotocol/conformance#readme) by scenario | Full protocol conformance (mcp-review-check suggests it in MAN-031) |
| [Snyk Agent Scan](https://github.com/snyk/agent-scan), formerly [`mcp-scan`](https://pypi.org/project/mcp-scan/) | Discovers the agents, MCP servers and skills [installed on a machine](https://github.com/snyk/agent-scan#readme) and scans them for prompt injection and other threats; needs a Snyk API token | Auditing the MCP servers you use |
| mcp-review-check | Checks one server against the public review criteria of the Claude and ChatGPT directories and the MCP spec, with a source link per rule and a manual checklist; no account | Getting your own server ready for a directory submission |

## FAQ

**Does a clean report mean the directory will accept my server?** No. Reviews include manual testing and policy judgment, and the rules reflect the public criteria as of the catalog date (see [Limitations and disclaimer](#limitations-and-disclaimer)). The manual checklist lists what the tool cannot check.

**A finding looks wrong for my server. What now?** `mcp-review-check explain <RULE-ID>` shows why the rule exists and its sources; `--ignore <RULE-ID>` drops it from the exit code and from the score (it stays in JSON under `ignored`), so compare scores only between runs with the same `--ignore` list. Heuristic rules are capped at warning and can be wrong; please report a false positive with the JSON report attached.

**Why did the run exit 3?** It could not connect or complete a handshake (`Result: FAIL (could not connect)`), or, with `--fail-on-incomplete`, the check was partial (no token, a rejected token, `tools/list` failed), or the linter itself failed (`fatal:` with a stack trace on stderr: a bug in mcp-review-check, please report it). The report names the cause (the name does not resolve, connection refused or timed out, an untrusted TLS certificate, not an MCP endpoint) and, where it can, a URL to try. Exit 4 means `--max-duration` stopped the check after the handshake (`Result: INCOMPLETE (stopped at --max-duration during <phase>)`): raise the deadline or find the slow phase. See [Exit codes](#exit-codes).

**Why does `--target claude` pass with MCP spec errors?** The exit code counts only the chosen directories; add `--fail-on-spec` to fail on spec findings too.

**My server is on localhost or in a container. Is HTTPS a problem?** No: such hosts run in [local mode](#local-mode), where deploy-time checks are info. `--no-local` makes them strict.

**My server needs OAuth.** See [Token recipe](#token-recipe). Without a token the auth checks still run and the score reads `n/a`.

**Does it change anything on my server?** Not by default; see [What the tool sends](#what-the-tool-sends). `--active` calls read-only tools and `--active-auth` registers a DCR client.

## Stability policy

The rule catalog is dated <!-- CATALOG_DATE -->2026-11-01<!-- /CATALOG_DATE --> (shown as `rules <date>` in every report header and as `tool.catalogDate` in JSON, with `tool.catalogAgeDays`). A check run prints a warning on stderr when the catalog is more than 90 days old, because directory requirements change.

While the version is 0.x:

- **Patch releases** (0.1.x) only fix bugs and false positives, lower a severity, or improve messages. They never add a rule or raise a severity, so they cannot turn a passing CI run red.
- **Minor releases** (0.2.0, ...) may add rules, raise severities and change defaults. Each one is listed in [CHANGELOG.md](CHANGELOG.md).
- **Rule IDs are never reused.** A retired rule's ID stays retired, so `--ignore` lists and saved reports keep their meaning.
- **JSON output** carries `schemaVersion` (currently `1`). It changes only when a field is renamed, removed or changes type; new fields can appear at any time.

In CI, pin the minor version so that new rules arrive when you choose to upgrade: `npx mcp-review-check@0.3 <url>`.

## Limitations and disclaimer

- Passing these automated checks **does not guarantee approval**. Directory reviews include manual testing and policy judgment, and requirements change. Rules reflect public documentation as of <!-- CATALOG_DATE -->2026-11-01<!-- /CATALOG_DATE -->.
- Heuristic rules (word lists and regexes for injection, data collection, policy topics and tool shapes) can produce false positives and miss real problems. They are capped at warning; only deterministic markers (hidden characters, explicit "ignore previous instructions" or "don't tell the user", conversation-history and secret parameter names) are errors.
- Tool-level checks on OAuth-protected servers need a valid `--bearer` token; without one only the auth checks run.
- `--stdio` launches the server with your local Node. A server whose `engines` needs a newer Node fails at startup (exit 3); run the check under that Node version, or pass `--env NODE_OPTIONS=...` when a flag is enough.
- `--stdio` ends the server with everything it started, also behind `npx`, a `.cmd` or `.bat` file or `sh -c`: on Windows the process tree (`taskkill /T /F`), on Linux and macOS the server's process group (the server runs as its leader, so a terminal's Ctrl+C reaches the CLI, which ends the group on SIGINT, SIGTERM, SIGHUP and SIGQUIT, and kills it at once on a second signal). A process the server moves to a group or session of its own (a daemon) is not ended. On Linux and macOS the CLI's own SIGKILL (`kill -9`, a timeout or CI job cancellation that kills the CLI's group) cannot be caught, so it does not end the server's group: a server that ignores stdin EOF outlives it. The server also runs in a session of its own, without the terminal: a `--stdio` wrapper that prompts on the terminal (ssh asking for a password or to confirm a new host key, sudo) cannot prompt and fails, so use ssh with a key, `-o BatchMode=yes` and a host key already in `known_hosts`, and sudo without a password.
- DNS checks use the system resolver. Registrable-domain logic uses a small built-in suffix list, not the full Public Suffix List.
- Widget origin extraction is regex-based; origins built at runtime are not detected.
- Listing and plugin manifests are linted only for what can be read offline (see [Listing and plugin manifests](#listing-and-plugin-manifests)); screenshots, image sizes and the portal form stay in the manual checklist. For full wire-schema conformance, also run `npx @modelcontextprotocol/conformance`.
- mcp-review-check is independent and not affiliated with Anthropic or OpenAI.

## Development

```bash
npm install
npm run build        # tsc → dist/
npm run typecheck    # tsc --noEmit over src/ and test/
npm test             # vitest: rule unit tests, fixture servers, e2e, auth probe
MCP_REVIEW_CHECK_LIVE=1 npm test   # adds smoke tests against public servers
npm run test:coverage   # the same tests with a coverage report of src/ in coverage/
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to add a rule, [SECURITY.md](SECURITY.md) for what the tool sends, the threat model and how to report a vulnerability, and [docs/design/spec.md](docs/design/spec.md) for the original design document (it may differ from the implementation).

Test fixtures live in `test/fixtures/`: a compliant stdio server (`good-server.mjs`), a server that violates many rules (`bad-server.mjs`), an HTTP bridge with switches for wire-level defects, an OAuth metadata server with good and bad variants, and a raw 2026-07-28 server.

## License

MIT
