# Command-line reference

Reference for the command line. A step-by-step path is in [From zero to directory submission](walkthrough.md); CI recipes are in [CI and automation](ci.md).

## Options

| Option | Default | Notes |
|---|---|---|
| `--header "K: V"` | | Repeatable. Values are redacted in every output format. |
| `--bearer <token>` | `$MCP_REVIEW_CHECK_TOKEN` | Sent as `Authorization: Bearer`. Prefer the env var to keep tokens out of shell history. |
| `--target claude\|chatgpt\|all` | `all` | `spec` rules always run and are reported; the exit code counts only the chosen directories (see [Exit codes](#exit-codes)). |
| `--format text\|json\|markdown\|sarif\|junit` | `text` | See [Output formats](#output-formats). |
| `--output <file>` | stdout | Report to a file, one-line summary to stderr. If the file cannot be written, the report goes to stdout and the exit code is 2. |
| `--json-output <file>` | | Also writes the JSON report to the file, whatever `--format`: the same document `--format json` prints (with `baselined` marks under `--baseline`), redacted the same way. For a job that wants a readable or SARIF report and a JSON file from one run. A file that cannot be written is exit 2 (the primary report is still printed or written). |
| `--save-baseline <file>` | | The same JSON report under the baseline name: write it once, then pass the file to `--baseline` on later runs (see [CI recipes](ci.md#ci-recipes)). May be given with `--json-output`. |
| `--sarif-location <path>` | `.mcp-review-check` | SARIF only: the repository-relative path every result points at (`artifactLocation.uri`). A path with a scheme, an absolute path or `..` is a usage error (exit 2) that does not repeat the value. The server URL or command is in `runs[0].properties.target`, redacted. Results carry `partialFingerprints` (rule, tool or resource, path), the run an `automationDetails.id` per path, and `informationUri` is the repository URL. |
| `--timeout <ms>` | `30000` | Per request (at most 2147482647); HTTP connect uses `min(timeout, 15000)`, a stdio start the full timeout, `--active` tool calls `min(timeout, 241000)`. RT-005 reports a call that runs past Claude's documented 240 s tool timeout as an error for Claude and a warning for ChatGPT (use `--timeout 241000` to measure it); its 60 s (Claude) and 5 s (ChatGPT) thresholds are linter-defined. A call that gets no answer before a shorter `--timeout` is an RT-005 warning. The GET probe uses 5 s and the TLS check 10 s. |
| `--max-duration <ms>` | no limit | Overall deadline for the whole check. When it runs out, the report covers what ran, says in which phase it stopped, and the verdicts read `INCOMPLETE`: after a handshake the run exits 4 at any `--fail-on` and reads `Result: INCOMPLETE (stopped at --max-duration during <phase>)`; before one it exits 3 and reads `FAIL (could not connect)`. |
| `--fail-on error\|warning\|never` | `error` | Controls exit code 1. Each finding counts at its severity for the `--target` directories (`all` = Claude and ChatGPT). |
| `--fail-on-spec` | off | Also count MCP spec findings toward `--fail-on`. Without it, spec-only findings are reported but never fail the run. |
| `--fail-on-incomplete` | off | Exit 3 when the check is partial: the server requires auth and no token was given (`auth-required`), the token was rejected (`token-rejected`) or `tools/list` failed (`list-failed`). Without it a partial check exits by `--fail-on` like a complete one, so an expired token in CI can leave the job green; use it in CI with a token. A `--max-duration` stop is exit 4 with or without it. |
| `--baseline <file>` | | A JSON report of an earlier run (`--save-baseline <file>`, or `--format json --output <file>`). Findings already in it are **known**: they do not count toward `--fail-on`, the verdicts or the error, warning and info counts, and get no GitHub annotation; only new findings do. A finding is matched by rule, tool or resource, `path` and platforms (a baseline for `--target all` covers a run for `--target claude`), not by its message, so a reworded message or a changed number stays known; among several findings of one rule on one subject the message (numbers aside) decides which is which, and one more than the baseline had is new. SRV-020 (the protocol era note) is never known. JSON lists every finding with `baselined: true` or `false` and `summary.baselined`; SARIF sets `baselineState` to `unchanged` or `new`; text and markdown list only the new findings and one line `N known finding(s) from baseline, not listed: <rule IDs>` (not with `--quiet`). The score still counts every finding. A missing file or a file that is not a JSON report of mcp-review-check is a usage error (exit 2), as is a path that is not a regular file (a pipe, a device or a directory; it is never read) or a file over 16 MiB. The tool definitions are compared too, see [Tool-definition drift](#tool-definition-drift). |
| `--fail-on-drift` | off | With `--baseline`: exit 1 when a tool was added, removed or changed since the baseline, also with `--fail-on never` (either one suffices). When the tools could not be compared (a baseline without fingerprints, `tools/list` failed or partial, a stop during listing) it also exits 1 and prints `--fail-on-drift: tool definitions not compared (<reason>); re-save the baseline with --save-baseline` on stderr, so a CI gate never passes silently. Without it, drift is reported but never changes the exit code. The verdicts and `summary.failed` stay about findings. Without `--baseline` a usage error (exit 2). Config key `failOnDrift`. |
| `--diff-only` | off | With `--baseline`, text and markdown: only the new findings and the [tool-definition drift](#tool-definition-drift), without the `N known finding(s) from baseline` line and the manual checklist (also with `--checklist`, and in the GitHub job summary). JSON, SARIF and JUnit are unchanged. Without `--baseline` a usage error (exit 2). Config key `diffOnly`. |
| `--local`, `--no-local` | detected | Force [local mode](#local-mode) on or off, whatever the host; `--no-local` also makes a `--stdio` run strict. Not both. |
| `--active` | off | Runs the RT rules by calling read-only tools: the first 50 that qualify, at most 3 calls each. Also lists the tools on up to three fresh connections whose `clientInfo.name` is `mcp-review-check`, `claude-ai` and `Anthropic` (RT-012). |
| `--active-auth` | off | Probes DCR, `/authorize` and `/token`. **Creates a DCR client** on your authorization server. |
| `--tool-args <file>` | | JSON `{ "toolName": { ...args } }` for `--active`, in UTF-8 (with or without a BOM) or UTF-16LE with a BOM (what Windows PowerShell 5.1 writes). Otherwise arguments are synthesized from the schema. |
| `--stdio "<command>"`, `--stdio -- <command> [args...]` | | Launch a local server over stdio. The string form splits on whitespace and honours single and double quotes; a backslash is literal, so Windows paths such as `C:\Users\me\server.js` and `"\\host\My Share\server.js"` work. Inside double quotes a backslash escapes only `"`, by the Windows rule on every OS: `\"` is a literal `"`, `\\"` is one backslash that ends the quote (`"C:\srv\\"`), and `\\` and `\$` stay as written (on Linux and macOS too, unlike a shell). The `--` form passes every argument verbatim (no quoting rules) and must come last. |
| `--env K=V`, `--cwd <dir>` | | stdio only. `--env` values are redacted in every output format (see [Redaction](privacy-and-requests.md#redaction)). The server gets only `HOME, LOGNAME, PATH, SHELL, TERM, USER` from your environment (on Windows `APPDATA, HOMEDRIVE, HOMEPATH, LOCALAPPDATA, PATH, PROCESSOR_ARCHITECTURE, PROGRAMFILES, SYSTEMDRIVE, SYSTEMROOT, TEMP, USERNAME, USERPROFILE`) plus the `--env` values: pass anything else it needs, such as an API key or `TMPDIR` (macOS), with `--env`. On Windows names are case-insensitive, so `--env Path=…` replaces the inherited `PATH`. |
| `--ignore <RULE-ID>` | | Repeatable, any case, or a comma-separated list. Ignored findings stay visible in JSON under `ignored` and count neither toward the exit code nor toward the score. An ID that is neither a rule nor a `MAN` item is a usage error (exit 2), so a typo does not silently ignore nothing. |
| `--list-rules [prefix]` | | Prints the catalog and exits: `--format text` (default; with `--verbose`, each rule's rationale), `json` or `markdown` (the tables in [docs/RULES.md](../../docs/RULES.md)); `--format sarif` and `junit` print the text catalog with a warning on stderr and exit 0. A prefix such as `TOOL` or `MAN` keeps the IDs that start with it. |
| `explain <RULE-ID>` | | Prints a rule's severity per directory, rationale, sources and fix, and how to `--ignore` it; also takes `MAN` IDs. An unknown ID exits 2. |
| `--quiet` | off | Text only: prints just the error and warning findings, the Score line (without the info count), the Result line and the disclaimer. A failed connect (with its cause) or a partial check, such as missing auth, is named in the Result line. Ignored by `json`, `markdown`, `sarif` and `junit`. |
| `--plugin-dir <dir>` | none | Also lints a Claude plugin folder (LST rules), see [Listing and plugin manifests](listings.md#listing-and-plugin-manifests). Path relative to the working directory; needs a `<url>` or `--stdio` target. Config key `pluginDir`. |
| `--openai-manifest <file>` | none | Also lints a ChatGPT plugin package manifest (LST rules). Path relative to the working directory; needs a `<url>` or `--stdio` target. Config key `openaiManifest`. |
| `--checklist` | off | Text only: prints the manual checklist in full. By default the text report shows one line, `N manual items: --checklist to show`; markdown and JSON always list every item. |
| `--config <file>`, `--no-config` | discovered | Options from a JSON file, see [Config file](#config-file). Without `--config`, `mcp-review-check.config.json` or else `.mcp-review-check.json` in the `--cwd` directory (or the working directory) is read when it exists; `--no-config` turns that off. Not both. The file must be a regular file of at most 16 MiB (otherwise exit 2). |
| `--no-color`, `--verbose`, `--help`, `--version` | | `--no-color` turns colours off (they are also off without a TTY or with `NO_COLOR`; `FORCE_COLOR=1` turns them on without a TTY, see [GitHub Actions](ci.md#github-actions)). `--verbose` expands collapsed findings, shows TOOL-013 info and each rule's rationale (the markdown report always lists them under "Why these rules"), and prints the redacted HTTP trace. |

Environment variables: `MCP_REVIEW_CHECK_TOKEN` is the default for `--bearer` (see [Token recipe](auth.md#token-recipe)); `NO_COLOR` and `FORCE_COLOR` set colours; `GITHUB_ACTIONS` and `GITHUB_STEP_SUMMARY` turn on [GitHub Actions](ci.md#github-actions) output.
`MCP_REVIEW_CHECK_NO_CTA=1` hides the call to action: the maintainer's e-mail address, which text and markdown reports show above the disclaimer on a `BLOCKED`, legacy-era or auth-required result (JSON always has it in `contact`, SARIF never).

## Config file

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

## Output formats

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

## Tool-definition drift

Every JSON report records a fingerprint of each tool in `toolFingerprints`: `name`, `sha256` (SHA-256 of the canonical JSON, keys sorted at every depth and no whitespace, of the tool's `name`, `title`, `description`, `inputSchema`, `outputSchema`, `annotations` and `_meta`, those present) and `fields` (one SHA-256 per present field). It is `null` when `tools/list` did not finish (failed connect, partial check, a `--max-duration` stop before the listing). With `--baseline`, the tools of this run are paired by name with the baseline's and the report gets a **Changed tool definitions** section: tools added, removed, and changed with the top-level fields that changed (a change of key order alone is not a change).

| Format | Where |
|---|---|
| `text` | `CHANGED TOOL DEFINITIONS (N since baseline)` after the findings, one line per tool (`+` added, `-` removed, `~ name: changed: description, inputSchema`); `Tool definitions: no change since baseline (N tools).` otherwise. With `--quiet`, only when there are changes. |
| `markdown` | `## Changed tool definitions (N since baseline)` with a Tool and Change table, after the findings. |
| `json` | `baseline.toolChanges`: `{"added": [...], "removed": [...], "changed": [{"name": "...", "fields": ["description"]}]}`. |
| `sarif` | One `note` result per change with `ruleId` `BASE-001` ("Tool definition changed since baseline"), `baselineState` `new` and `properties.change` (`added`, `removed` or `changed`, with `fields`). BASE-001 is synthetic: it is added to the run's rules only when there is a change and is not in the catalog (`--list-rules`, `explain` and `--ignore` do not know it). |
| `junit` | In each suite's `<system-out>`, never a failure. |

Drift is informational: it does not change the verdicts, the counts or the exit code unless `--fail-on-drift` is given. A baseline written by 0.3 or older has no fingerprints: it is still accepted (its findings are known as before) and the section reads `Tool definitions not compared: tool fingerprints were not recorded in the baseline`; write it again with `--save-baseline` to start comparing. The fingerprints are taken from the report as written, so secrets are redacted before hashing (a rotated secret echoed in a description is not a change) and tool names in the section are redacted like everything else; a string longer than the input cap (`limits.truncated`) is compared up to the cap.

## JSON Schema

[`schema/report.schema.json`](../../schema/report.schema.json) (JSON Schema draft 2020-12) describes the JSON report and ships in the npm package (`node_modules/mcp-review-check/schema/report.schema.json`). Its `$id`, which every JSON report names in `$schema`, is `https://raw.githubusercontent.com/alisaosipova/mcp-review-check/v0.4.0/schema/report.schema.json` (the schema URL keeps the tag that introduced it). Fields added after 0.1 say since which release in their `description`. Objects do not allow other properties, so a field this schema does not know fails validation; `schemaVersion` is bumped on a breaking change. To check the report in CI, for example with [ajv-cli](https://github.com/ajv-validator/ajv-cli):

```bash
npx mcp-review-check@0.6 --fail-on never --json-output report.json --stdio -- node dist/server.js
npx -y -p ajv-cli@5 -p ajv-formats@3 ajv validate --spec=draft2020 -c ajv-formats -s node_modules/mcp-review-check/schema/report.schema.json -d report.json
```

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Completed, below the `--fail-on` threshold |
| 1 | Completed, threshold reached for a `--target` directory (or for the spec with `--fail-on-spec`), or with `--fail-on-drift` a tool definition changed since `--baseline` (or could not be compared) |
| 2 | Usage or configuration error (an unknown option names the closest one; an unknown `--ignore` or `explain` ID; a wrong [config file](#config-file)), or `--output`, `--json-output` or `--save-baseline` could not be written |
| 3 | Could not reach the server or complete any handshake, also when `--max-duration` ran out before the handshake (a report is still printed, with verdicts `INCOMPLETE` and no manual checklist); with `--fail-on-incomplete`, a partial check (`auth-required`, `token-rejected`, `list-failed`); or the linter itself failed unexpectedly (`fatal:` and a stack trace on stderr; please [report it](https://github.com/alisaosipova/mcp-review-check/issues/new?template=bug.yml)) |
| 4 | `--max-duration` stopped the check after the handshake (whatever `--fail-on`, also with errors found before the stop): the report covers what ran. New in 0.2.0; 0.1.x exited 3 |
| 128+N | Ended by signal N: 130 for SIGINT (Ctrl+C), 143 for SIGTERM (a CI job cancelled), 131 for SIGQUIT, 129 for SIGHUP. A stdio server is ended first, and no report is written. On Windows the exit code is set to the same 128+N |

The exit code follows `--target`: a finding counts at the severity it has for Claude or ChatGPT, so a check for the Claude directory does not fail on a ChatGPT-only error or on an MCP spec error the directory does not check. Spec findings fail the run only with `--fail-on-spec`. The `Result:` line (and the `--output` summary line, and `summary.gate` in JSON) names what failed the run, for example `Result: FAIL (--fail-on error) · claude: 2 errors (TOOL-006, TOOL-011)`, and, on a pass or a fail, the spec findings that no chosen directory counted. A run that could not connect (exit 3) reads `Result: FAIL (could not connect)`, never `PASS`, and its Claude and ChatGPT verdicts read `INCOMPLETE` even when a static check such as SRV-001 (`http://` URL) has an error. A run stopped by `--max-duration` after the handshake (exit 4) reads `Result: INCOMPLETE (stopped at --max-duration during listing)`, followed by the findings that reached the threshold before the stop. On exit 3 and 4, JSON `summary.failed` is `true`.

A partial check (JSON `coverage.toolLevel` is `auth-required`, `token-rejected` or `list-failed`) still exits by `--fail-on`: the auth and server checks ran, the tool checks did not, and the score is `n/a`. Add `--fail-on-incomplete` to make it exit 3 instead. A run that has read 64 MiB of server data in total (the snapshot byte budget) stops reading and is also a partial check: the verdict is `INCOMPLETE (snapshot budget exhausted …)`, `limits.budgetExhausted` names the phase, and the exit code follows `--fail-on` (never 4) or is 3 with `--fail-on-incomplete`.

A `401` without `--bearer` is not fatal: the auth probe runs and the report says which checks need a token.

If the server declares tools but `tools/list` fails (error, crash, timeout, or more than 100 pages), SPEC-020 reports an error and the report says that tool checks could not run.

A failed connect names its cause instead of `fetch failed`: the hostname does not resolve, the connection was refused or timed out, the TLS certificate is not trusted (`CERT_*`, self-signed), or the URL answered 404/405/an HTML page and is not an MCP endpoint, with a suggested URL (`<url>/mcp`, or `/mcp` instead of the deprecated `/sse`). A URL without a scheme is rejected with a suggestion (`https://…`, or `http://` for localhost and for a name without a dot followed by a port, such as `mcp:8080/mcp`). Timeouts, connection resets, 5xx and 429 (honouring `Retry-After` up to 5 s) are retried (at most 3 attempts, a timeout only once) in the preflight, Origin, challenge, OAuth metadata, invalid-token and TLS probes; a probe that still fails only for network reasons is reported as `inconclusive (network)` (info), not as an error.

Findings that apply to several platforms carry a severity per platform (for example `[spec, chatgpt: warning]`), and each platform verdict counts that platform's own severity.

## Local mode

Stdio servers and HTTP targets on a host without a dot (`localhost`, a container name such as `http://mcp:8080`) or whose every address is non-public (`127.0.0.0/8`, `::1`, `10/8`, `172.16/12`, `192.168/16`, …, counting both public DNS and the system resolver, so `/etc/hosts` and container DNS names count) run in **local mode**: deploy-time checks (HTTPS, public DNS, tunnel domains) are reported as info so you can lint before deploying. A banner names the rules that were made informational (on stderr for `json` and `sarif`); `--no-local` keeps them strict and `--local` forces local mode for any host. SRV-004 tells a name that "resolves only locally" (the system resolver answers, public DNS has no A record) from one with no A record at all.
