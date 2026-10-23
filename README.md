# mcp-review-check

Lint an MCP server against the public review criteria of the **Claude connector directory**, the **ChatGPT plugin directory** and the **MCP specification** before you submit it.

Run `npx mcp-review-check https://mcp.example.com/mcp` (no install, no account). Stdio servers, OAuth and CI: see [Usage](#usage), [Token recipe](#token-recipe) and [CI recipes](#ci-recipes).

`mcp-review-check` connects to your server (remote Streamable HTTP, legacy HTTP+SSE, or local stdio), takes a snapshot of what it exposes (tools, resources, prompts, MCP Apps widgets, OAuth metadata), runs side-effect-free protocol probes, and checks everything against 144 automated rules. Every rule links to its public source. Checks that cannot be automated are listed as a manual checklist (in full in markdown and JSON; one line in text unless you pass `--checklist`).

- Requires Node 20.19 or newer; no telemetry.
- Read-only by default. It never calls your tools unless you pass `--active`, and then only tools annotated `readOnlyHint: true`.
- Text, JSON, Markdown and SARIF output; CI-friendly exit codes.

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

This version is not published to npm yet. From a checkout: `npm install && npm run build`, then `node dist/cli.js <url>` or `npm link`.

### Options

| Option | Default | Notes |
|---|---|---|
| `--header "K: V"` | | Repeatable. Values are redacted in every output format. |
| `--bearer <token>` | `$MCP_REVIEW_CHECK_TOKEN` | Sent as `Authorization: Bearer`. Prefer the env var to keep tokens out of shell history. |
| `--target claude\|chatgpt\|all` | `all` | `spec` rules always run and are reported; the exit code counts only the chosen directories (see [Exit codes](#exit-codes)). |
| `--format text\|json\|markdown\|sarif` | `text` | |
| `--output <file>` | stdout | Report to a file, one-line summary to stderr. If the file cannot be written, the report goes to stdout and the exit code is 2. |
| `--timeout <ms>` | `30000` | Per request (at most 2147482647); HTTP connect uses `min(timeout, 15000)`, a stdio start the full timeout, `--active` tool calls `min(timeout, 241000)`. RT-005 reports a call that runs past Claude's documented 240 s tool timeout as an error for Claude and a warning for ChatGPT (use `--timeout 241000` to measure it); its 60 s (Claude) and 5 s (ChatGPT) thresholds are linter-defined. A call that gets no answer before a shorter `--timeout` is an RT-005 warning. The GET probe uses 5 s and the TLS check 10 s. |
| `--max-duration <ms>` | no limit | Overall deadline for the whole check. When it runs out, the report covers what ran, says in which phase it stopped, and the verdicts read `INCOMPLETE` (exit 3 if no handshake completed). |
| `--fail-on error\|warning\|never` | `error` | Controls exit code 1. Each finding counts at its severity for the `--target` directories (`all` = Claude and ChatGPT). |
| `--fail-on-spec` | off | Also count MCP spec findings toward `--fail-on`. Without it, spec-only findings are reported but never fail the run. |
| `--local`, `--no-local` | detected | Force [local mode](#local-mode) on or off, whatever the host; `--no-local` also makes a `--stdio` run strict. Not both. |
| `--active` | off | Runs the RT rules by calling read-only tools. |
| `--active-auth` | off | Probes DCR, `/authorize` and `/token`. **Creates a DCR client** on your authorization server. |
| `--tool-args <file>` | | JSON `{ "toolName": { ...args } }` for `--active`. Otherwise arguments are synthesized from the schema. |
| `--stdio "<command>"`, `--stdio -- <command> [args...]` | | Launch a local server over stdio. The string form splits on whitespace and honours single and double quotes; a backslash outside quotes is literal, so Windows paths such as `C:\Users\me\server.js` work. The `--` form passes every argument verbatim (no quoting rules) and must come last. |
| `--env K=V`, `--cwd <dir>` | | stdio only. `--env` values are redacted in every output format (see Redaction below). |
| `--ignore <RULE-ID>` | | Repeatable, any case. Ignored findings stay visible in JSON under `ignored`. An ID that is neither a rule nor a `MAN` item is a usage error (exit 2), so a typo does not silently ignore nothing. |
| `--list-rules [prefix]` | | Prints the catalog and exits: `--format text` (default; with `--verbose`, each rule's rationale), `json` or `markdown` (the tables in [docs/RULES.md](docs/RULES.md)). A prefix such as `TOOL` or `MAN` keeps the IDs that start with it. |
| `explain <RULE-ID>` | | Prints a rule's severity per directory, rationale, sources and fix, and how to `--ignore` it; also takes `MAN` IDs. An unknown ID exits 2. |
| `--quiet` | off | Text only: prints just the error and warning findings, the Score and Result lines and the disclaimer. A failed connect (with its cause) or a partial check, such as missing auth, is named in the Result line. Ignored by `json`, `markdown` and `sarif`. |
| `--checklist` | off | Text only: prints the manual checklist in full. By default the text report shows one line, `N manual items: --checklist to show`; markdown and JSON always list every item. |
| `--no-color`, `--verbose`, `--help`, `--version` | | `--no-color` turns colours off (they are also off without a TTY or with `NO_COLOR`; `FORCE_COLOR=1` turns them on without a TTY, see [GitHub Actions](#github-actions)). `--verbose` expands collapsed findings, shows TOOL-013 info and each rule's rationale (the markdown report always lists them under "Why these rules"), and prints the redacted HTTP trace. |

Environment variables: `MCP_REVIEW_CHECK_TOKEN` is the default for `--bearer` (see [Token recipe](#token-recipe)); `NO_COLOR` and `FORCE_COLOR` set colours; `GITHUB_ACTIONS` and `GITHUB_STEP_SUMMARY` turn on [GitHub Actions](#github-actions) output.
`MCP_REVIEW_CHECK_NO_CTA=1` hides the call to action (a contact link that text and markdown reports may show above the disclaimer on a `BLOCKED`, legacy-era or auth-required result); this version sets no contact URL, so no report shows one either way.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Completed, below the `--fail-on` threshold |
| 1 | Completed, threshold reached for a `--target` directory (or for the spec with `--fail-on-spec`) |
| 2 | Usage or configuration error (an unknown option names the closest one; an unknown `--ignore` or `explain` ID), or `--output` could not be written |
| 3 | Could not reach the server or complete any handshake (a report is still printed, with verdicts `INCOMPLETE` and no manual checklist) |

The exit code follows `--target`: a finding counts at the severity it has for Claude or ChatGPT, so a check for the Claude directory does not fail on a ChatGPT-only error or on an MCP spec error the directory does not check. Spec findings fail the run only with `--fail-on-spec`. The `Result:` line (and the `--output` summary line, and `summary.gate` in JSON) names what failed the run, for example `Result: FAIL (--fail-on error) · claude: 2 errors (TOOL-006, TOOL-011)`, and, on a pass or a fail, the spec findings that no chosen directory counted. A run that could not connect (exit 3) reads `Result: FAIL (could not connect)`, never `PASS`, and its Claude and ChatGPT verdicts read `INCOMPLETE` even when a static check such as SRV-001 (`http://` URL) has an error.

A `401` without `--bearer` is not fatal: the auth probe runs and the report says which checks need a token.

If the server declares tools but `tools/list` fails (error, crash, timeout, or more than 100 pages), SPEC-020 reports an error and the report says that tool checks could not run.

A failed connect names its cause instead of `fetch failed`: the hostname does not resolve, the connection was refused or timed out, the TLS certificate is not trusted (`CERT_*`, self-signed), or the URL answered 404/405/an HTML page and is not an MCP endpoint, with a suggested URL (`<url>/mcp`, or `/mcp` instead of the deprecated `/sse`). A URL without a scheme is rejected with a suggestion (`https://…`, or `http://` for localhost and for a name without a dot followed by a port, such as `mcp:8080/mcp`). Timeouts, connection resets, 5xx and 429 (honouring `Retry-After` up to 5 s) are retried (at most 3 attempts, a timeout only once) in the preflight, Origin, challenge, OAuth metadata, invalid-token and TLS probes; a probe that still fails only for network reasons is reported as `inconclusive (network)` (info), not as an error.

**Redaction.** One redactor covers the whole report in every format (messages, evidence, target, SARIF URI, the markdown `rerun:` line, GitHub annotations and job summary, fatal message, stdio stderr, `--verbose` trace): `--bearer`, `--header` values, `--env` values, secret query parameters (`api_key`, `token`, ...) and the password in `user:pass@`, and stdio arguments that follow a secret-looking flag (`--api-key X`, `--accessToken X`, `--token=X`, `API_KEY=X`, `"Authorization: Bearer X"`), including when the server echoes them on stdout, on stderr or in what it lists. Usage errors never repeat option values. Values shorter than 4 characters, `true`, `false`, `yes`, `no`, `on`, `off`, `null`, `undefined`, `none` and numbers with up to 6 digits before an optional decimal part are not treated as secrets: they would blank out unrelated report text.

**Input caps.** Before the pattern rules run, metadata strings over 16 KB and UI resources over 2 MB are truncated and the report lists what was cut (JSON `limits.truncated`); SDK error bodies are capped at 64 KB.

Findings that apply to several platforms carry a severity per platform (for example `[spec, chatgpt: warning]`), and each platform verdict counts that platform's own severity.

### Example output

```
mcp-review-check 0.1.0 · rules 2026-10-22 · target: all
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

The protocol revision is in the header (the SRV-020 finding stays in JSON and SARIF only), and the TOOL-013 info about `idempotentHint` on a read-only tool is shown only with `--verbose`. Findings with the same rule and message are collapsed into one line with a count (`--verbose` lists each one), and every tool without a title or annotation hints gets a JSON fragment to paste in. The score counts root causes, not findings: `100 − 12` per rule with an error `− 4` per rule with only warnings, not below 0 (JSON `summary.scoreVersion: 2`); it is provisional. The score is one number per server: it counts the findings of every platform whatever `--target`, while the listed findings, the root-cause count, the verdicts and the exit code follow `--target`. Per-platform verdicts are `BLOCKED`, `NEEDS ATTENTION` or `NO AUTOMATED BLOCKERS`. When tool-level checks cannot run (OAuth without `--bearer`, a failed connect or a failed `tools/list`), the score is `n/a` and a verdict without errors is `INCOMPLETE`, never a pass; after a failed connect every verdict is `INCOMPLETE`.

### Local mode

Stdio servers and HTTP targets on a host without a dot (`localhost`, a container name such as `http://mcp:8080`) or whose every address is non-public (`127.0.0.0/8`, `::1`, `10/8`, `172.16/12`, `192.168/16`, …, counting both public DNS and the system resolver, so `/etc/hosts` and container DNS names count) run in **local mode**: deploy-time checks (HTTPS, public DNS, tunnel domains) are reported as info so you can lint before deploying. A banner names the rules that were made informational (on stderr for `json` and `sarif`); `--no-local` keeps them strict and `--local` forces local mode for any host. SRV-004 tells a name that "resolves only locally" (the system resolver answers, public DNS has no A record) from one with no A record at all.

### GitHub Actions

When `GITHUB_ACTIONS=true` (GitHub sets it on every runner), each finding that is a warning or an error for the `--target` directories (and for the MCP spec with `--fail-on-spec`) is also printed on stderr as an `::error` or `::warning` workflow annotation, at the severity it has for those platforms, as for the exit code. The markdown report is appended to the job summary when `$GITHUB_STEP_SUMMARY` is set. stdout keeps the chosen format, so `--format json` and `sarif` stay a single document. There is no separate switch: without `GITHUB_ACTIONS` (or without `GITHUB_STEP_SUMMARY`, for the summary) nothing is annotated or written. `FORCE_COLOR=1` colours the text report without a TTY (the Actions log shows ANSI colours); `FORCE_COLOR=0` and `--no-color` turn colours off.

The markdown report (and so the job summary) has an Evidence column with the text a rule matched, and a `rerun: npx mcp-review-check …` line with the options of the run, secrets redacted, to reproduce it locally (`--quiet` and `--checklist` are left out: they change only the text report).

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
      - run: npx -y mcp-review-check@0.1 --target claude --stdio -- node dist/server.js
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
      - run: npx -y mcp-review-check@0.1 "$PREVIEW_URL/mcp" --target claude
        env:
          PREVIEW_URL: ${{ github.event.deployment_status.environment_url }}
          MCP_REVIEW_CHECK_TOKEN: ${{ secrets.MCP_REVIEW_CHECK_TOKEN }}
```

`environment_url` is the URL your deployment tool reports for the environment ([deployment statuses](https://docs.github.com/en/rest/deployments/statuses)). A preview on a shared platform domain (`*.vercel.app`, `*.netlify.app`, ...) gets an SRV-005 info note, since the production server's domain should match your service. If previews sit behind a login wall, pass the bypass header your host documents with `--header` (header values are redacted). Drop `MCP_REVIEW_CHECK_TOKEN` if the server needs no auth. For other CI systems the same command works: the exit code is the result, and `--format json` or `--output` give a file to keep.

## Docker Compose

To check a server in a Compose stack before it has a public URL, run mcp-review-check as one more service. The service name has no dot, so the run is in [local mode](#local-mode): deploy-time checks (HTTPS, public DNS) are info.

```yaml
services:
  mcp:
    build: .
    expose: ["8080"]
  review:
    image: node:22-slim
    command: npx -y mcp-review-check@0.1 http://mcp:8080/mcp --target claude
    depends_on: [mcp]
    profiles: [review]
```

```bash
docker compose run --rm review
```

A service with a [profile](https://docs.docker.com/compose/how-tos/profiles/) does not start with `docker compose up`; `docker compose run` starts it and the `mcp` service it depends on. If the server takes a while to start, give `mcp` a healthcheck and use `depends_on: {mcp: {condition: service_healthy}}` ([startup order](https://docs.docker.com/compose/how-tos/startup-order/)), or the first run may exit 3 (connection refused).

## What the tool sends

By default about 20 requests, none of which change state: an unauthenticated `initialize`, `server/discover`, the SDK handshake and list calls, a GET on the endpoint (aborted after headers), an unsupported protocol version, an unknown method, a call to a tool named `mcp_review_check_nonexistent_tool`, a read of `mcp-review-check://does-not-exist`, `initialize` with three `Origin` values, a second `tools/list` and one fresh connection, and `GET /.well-known/openai-apps-challenge`. Every connection declares the MCP Apps client capability (`extensions: {"io.modelcontextprotocol/ui": {"mimeTypes": ["text/html;profile=mcp-app"]}}`), so servers that register UI tools only for capable hosts show them; when a tool links a UI, one more connection without that capability lists the tools a text-only host sees (APPS-019). When the server answers 401 it also fetches the OAuth metadata documents and sends one request with an invalid bearer token. Transient failures of these probes are retried (at most 3 attempts, a timeout only once).

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

**A finding looks wrong for my server. What now?** `mcp-review-check explain <RULE-ID>` shows why the rule exists and its sources; `--ignore <RULE-ID>` drops it from the exit code (it stays in JSON under `ignored`). Heuristic rules are capped at warning and can be wrong; please report a false positive with the JSON report attached.

**Why did the run exit 3?** It could not connect or complete a handshake (`Result: FAIL (could not connect)`). The report names the cause (the name does not resolve, connection refused or timed out, an untrusted TLS certificate, not an MCP endpoint) and, where it can, a URL to try. See [Exit codes](#exit-codes).

**Why does `--target claude` pass with MCP spec errors?** The exit code counts only the chosen directories; add `--fail-on-spec` to fail on spec findings too.

**My server is on localhost or in a container. Is HTTPS a problem?** No: such hosts run in [local mode](#local-mode), where deploy-time checks are info. `--no-local` makes them strict.

**My server needs OAuth.** See [Token recipe](#token-recipe). Without a token the auth checks still run and the score reads `n/a`.

**Does it change anything on my server?** Not by default; see [What the tool sends](#what-the-tool-sends). `--active` calls read-only tools and `--active-auth` registers a DCR client.

## Stability policy

The rule catalog is dated <!-- CATALOG_DATE -->2026-10-22<!-- /CATALOG_DATE --> (shown as `rules <date>` in every report header and as `tool.catalogDate` in JSON, with `tool.catalogAgeDays`). A check run prints a warning on stderr when the catalog is more than 90 days old, because directory requirements change.

While the version is 0.x:

- **Patch releases** (0.1.x) only fix bugs and false positives, lower a severity, or improve messages. They never add a rule or raise a severity, so they cannot turn a passing CI run red.
- **Minor releases** (0.2.0, ...) may add rules, raise severities and change defaults. Each one is listed in [CHANGELOG.md](CHANGELOG.md).
- **Rule IDs are never reused.** A retired rule's ID stays retired, so `--ignore` lists and saved reports keep their meaning.
- **JSON output** carries `schemaVersion` (currently `1`). It changes only when a field is renamed, removed or changes type; new fields can appear at any time.

In CI, pin the minor version so that new rules arrive when you choose to upgrade: `npx mcp-review-check@0.1 <url>`.

## Limitations and disclaimer

- Passing these automated checks **does not guarantee approval**. Directory reviews include manual testing and policy judgment, and requirements change. Rules reflect public documentation as of <!-- CATALOG_DATE -->2026-10-22<!-- /CATALOG_DATE -->.
- Heuristic rules (word lists and regexes for injection, data collection, policy topics and tool shapes) can produce false positives and miss real problems. They are capped at warning; only deterministic markers (hidden characters, explicit "ignore previous instructions" or "don't tell the user", conversation-history and secret parameter names) are errors.
- Tool-level checks on OAuth-protected servers need a valid `--bearer` token; without one only the auth checks run.
- `--stdio` launches the server with your local Node. A server whose `engines` needs a newer Node fails at startup (exit 3); run the check under that Node version, or pass `--env NODE_OPTIONS=...` when a flag is enough.
- DNS checks use the system resolver. Registrable-domain logic uses a small built-in suffix list, not the full Public Suffix List.
- Widget origin extraction is regex-based; origins built at runtime are not detected.
- Listing and plugin manifests are not linted yet; they appear in the manual checklist. For full wire-schema conformance, also run `npx @modelcontextprotocol/conformance`.
- mcp-review-check is independent and not affiliated with Anthropic or OpenAI.

## Development

```bash
npm install
npm run build        # tsc → dist/
npm run typecheck    # tsc --noEmit over src/ and test/
npm test             # vitest: rule unit tests, fixture servers, e2e, auth probe
MCP_REVIEW_CHECK_LIVE=1 npm test   # adds smoke tests against public servers
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to add a rule, [SECURITY.md](SECURITY.md) for what the tool sends, the threat model and how to report a vulnerability, and [docs/design/spec.md](docs/design/spec.md) for the original design document (it may differ from the implementation).

Test fixtures live in `test/fixtures/`: a compliant stdio server (`good-server.mjs`), a server that violates many rules (`bad-server.mjs`), an HTTP bridge with switches for wire-level defects, an OAuth metadata server with good and bad variants, and a raw 2026-07-28 server.

## License

MIT
