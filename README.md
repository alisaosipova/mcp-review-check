# mcp-review-check

Lint an MCP server against the public review criteria of the **Claude connector directory**, the **ChatGPT plugin directory** and the **MCP specification** before you submit it.

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
| `--ignore <RULE-ID>` | | Repeatable. Ignored findings stay visible in JSON under `ignored`. |
| `--list-rules [prefix]` | | Prints the catalog and exits: `--format text` (default; with `--verbose`, each rule's rationale), `json` or `markdown` (the table below). A prefix such as `TOOL` or `MAN` keeps the IDs that start with it. |
| `explain <RULE-ID>` | | Prints a rule's severity per directory, rationale, sources and fix, and how to `--ignore` it; also takes `MAN` IDs. An unknown ID exits 2. |
| `--quiet` | off | Text only: prints just the error and warning findings, the Score and Result lines and the disclaimer. A failed connect or missing auth is named in the Result line. Ignored by `json`, `markdown` and `sarif`. |
| `--checklist` | off | Text only: prints the manual checklist in full. By default the text report shows one line, `N manual items: --checklist to show`; markdown and JSON always list every item. |
| `--no-color`, `--verbose`, `--help`, `--version` | | `--verbose` expands collapsed findings, shows TOOL-013 info and each rule's rationale (the markdown report always lists them under "Why these rules"), and prints the redacted HTTP trace. |

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Completed, below the `--fail-on` threshold |
| 1 | Completed, threshold reached for a `--target` directory (or for the spec with `--fail-on-spec`) |
| 2 | Usage or configuration error, or `--output` could not be written |
| 3 | Could not reach the server or complete any handshake (a report is still printed, with verdicts `INCOMPLETE` and no manual checklist) |

The exit code follows `--target`: a finding counts at the severity it has for Claude or ChatGPT, so a check for the Claude directory does not fail on a ChatGPT-only error or on an MCP spec error the directory does not check. Spec findings fail the run only with `--fail-on-spec`. The `Result:` line (and the `--output` summary line, and `summary.gate` in JSON) names what failed the run, for example `Result: FAIL (--fail-on error) · claude: 2 errors (TOOL-006, TOOL-011)`; on a pass it notes spec findings that were not counted. A run that could not connect (exit 3) reads `Result: FAIL (could not connect)`, never `PASS`.

A `401` without `--bearer` is not fatal: the auth probe runs and the report says which checks need a token.

If the server declares tools but `tools/list` fails (error, crash, timeout, or more than 100 pages), SPEC-020 reports an error and the report says that tool checks could not run.

A failed connect names its cause instead of `fetch failed`: the hostname does not resolve, the connection was refused or timed out, the TLS certificate is not trusted (`CERT_*`, self-signed), or the URL answered 404/405/an HTML page and is not an MCP endpoint, with a suggested URL (`<url>/mcp`, or `/mcp` instead of the deprecated `/sse`). A URL without a scheme is rejected with a suggestion (`https://…`, or `http://` for localhost). Timeouts, connection resets, 5xx and 429 (honouring `Retry-After` up to 5 s) are retried (at most 3 attempts, a timeout only once) in the preflight, Origin, challenge, OAuth metadata, invalid-token and TLS probes; a probe that still fails only for network reasons is reported as `inconclusive (network)` (info), not as an error.

**Redaction.** One redactor covers the whole report in every format (messages, evidence, target, SARIF URI, fatal message, stdio stderr, `--verbose` trace): `--bearer`, `--header` values, `--env` values, secret query parameters (`api_key`, `token`, ...) and the password in `user:pass@`, and stdio arguments that follow a secret-looking flag (`--api-key X`, `--accessToken X`, `--token=X`, `API_KEY=X`, `"Authorization: Bearer X"`), including when the server echoes them on stdout, on stderr or in what it lists. Usage errors never repeat option values. Values shorter than 4 characters, `true`, `false`, `yes`, `no`, `on`, `off`, `null`, `undefined`, `none` and numbers with up to 6 digits before an optional decimal part are not treated as secrets: they would blank out unrelated report text.

**Input caps.** Before the pattern rules run, metadata strings over 16 KB and UI resources over 2 MB are truncated and the report lists what was cut (JSON `limits.truncated`); SDK error bodies are capped at 64 KB.

Findings that apply to several platforms carry a severity per platform (for example `[spec, chatgpt: warning]`), and each platform verdict counts that platform's own severity.

### Example output

```
mcp-review-check 0.1.0 · rules 2026-10-22 · target: all
Server  Acme Docs 1.4.2 · https://mcp.acme.example/mcp
Transport streamable-http · era legacy (2025-11-25) · auth none
          2026-07-28 clients fall back to initialize. Not a defect.
Checked 3 tools · 0 resources · 0 prompts · 0 UI resources · 90 rules run · 52 skipped (...)

ERRORS (6)
  x TOOL-006 [claude] 3 tools: no title: ask_question, read_wiki_contents, read_wiki_structure
      fix  Add `title` (top level, or in `annotations.title`).
      docs https://claude.com/docs/connectors/building/review-criteria
  x TOOL-011 [claude] 3 tools: neither readOnlyHint nor destructiveHint is set: ask_question, read_wiki_contents, read_wiki_structure
  ...
WARNINGS (2)
  ! SPEC-009 [spec] server: tools/call for a non-existent tool returned a result with isError instead of a JSON-RPC error
  ...

FIX SNIPPETS (add to each tool definition; check the guessed hint values)
  ask_question: {"title":"Ask question","annotations":{"readOnlyHint":false,"destructiveHint":true,"openWorldHint":true}}
  ...

22 manual items: --checklist to show

Score 68/100 · 4 root causes · 6 errors · 2 warnings · 4 info
Claude: BLOCKED (6 errors) · ChatGPT: NO AUTOMATED BLOCKERS · Result: FAIL (--fail-on error) · claude: 6 errors (TOOL-006, TOOL-011, ...)
```

The protocol revision is in the header (the SRV-020 finding stays in JSON and SARIF only), and the TOOL-013 info about `idempotentHint` on a read-only tool is shown only with `--verbose`. Findings with the same rule and message are collapsed into one line with a count (`--verbose` lists each one), and every tool without a title or annotation hints gets a JSON fragment to paste in. The score counts root causes, not findings: `100 − 12` per rule with an error `− 4` per rule with only warnings, not below 0 (JSON `summary.scoreVersion: 2`); it is provisional. Per-platform verdicts are `BLOCKED`, `NEEDS ATTENTION` or `NO AUTOMATED BLOCKERS`. When tool-level checks cannot run (OAuth without `--bearer`, a failed connect or a failed `tools/list`), the score is `n/a` and a verdict without errors is `INCOMPLETE`, never a pass.

### Local mode

Stdio servers and HTTP targets on a host without a dot (`localhost`, a container name such as `http://mcp:8080`) or whose every address is non-public (`127.0.0.0/8`, `::1`, `10/8`, `172.16/12`, `192.168/16`, …, counting both public DNS and the system resolver, so `/etc/hosts` and container DNS names count) run in **local mode**: deploy-time checks (HTTPS, public DNS, tunnel domains) are reported as info so you can lint before deploying. A banner names the rules that were made informational (on stderr for `json` and `sarif`); `--no-local` keeps them strict and `--local` forces local mode for any host. SRV-004 tells a name that "resolves only locally" (the system resolver answers, public DNS has no A record) from one with no A record at all.

## What the tool sends

By default about 20 requests, none of which change state: an unauthenticated `initialize`, `server/discover`, the SDK handshake and list calls, a GET on the endpoint (aborted after headers), an unsupported protocol version, an unknown method, a call to a tool named `mcp_review_check_nonexistent_tool`, a read of `mcp-review-check://does-not-exist`, `initialize` with three `Origin` values, a second `tools/list` and one fresh connection, and `GET /.well-known/openai-apps-challenge`. Every connection declares the MCP Apps client capability (`extensions: {"io.modelcontextprotocol/ui": {"mimeTypes": ["text/html;profile=mcp-app"]}}`), so servers that register UI tools only for capable hosts show them; when a tool links a UI, one more connection without that capability lists the tools a text-only host sees (APPS-019). When the server answers 401 it also fetches the OAuth metadata documents and sends one request with an invalid bearer token. Transient failures of these probes are retried (at most 3 attempts, a timeout only once).

## Rules

Generated from the catalog (`npm run build && npm run readme:rules`). Severity is listed per platform; a rule's platforms are the keys.

<!-- RULES:START -->
| ID | Title | Severity by platform | Source |
|---|---|---|---|
| SRV-001 | Remote server served over HTTPS | claude: error, chatgpt: error | [link](https://claude.com/docs/connectors/building/submission) |
| SRV-002 | Local stdio server cannot be submitted as a remote connector | claude: info, chatgpt: info | [link](https://claude.com/docs/connectors/building/submission) |
| SRV-003 | Streamable HTTP transport available | claude: warning, chatgpt: warning, spec: warning | [link](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) |
| SRV-004 | Hostname resolves to public IPv4 | claude: error, chatgpt: error | [link](https://claude.com/docs/connectors/building/troubleshooting) |
| SRV-005 | Temporary tunnel or shared hosting domain | chatgpt: error, claude: warning | [link](https://developers.openai.com/plugins/build/mcp-server) |
| SRV-006 | No cross-host redirect at the registered URL | claude: error | [link](https://claude.com/docs/connectors/building/troubleshooting) |
| SRV-007 | Host-header (DNS-rebinding) protection rejects the public hostname | claude: error, chatgpt: error | [link](https://claude.com/docs/connectors/building/testing) |
| SRV-008 | Origin header handling | claude: info, chatgpt: info, spec: error | [link](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http) |
| SRV-009 | Bot challenge or WAF signature in responses | claude: warning, chatgpt: warning | [link](https://claude.com/docs/connectors/building/authentication) |
| SRV-010 | Handshake and listing latency | chatgpt: info | [link](https://developers.openai.com/plugins/deploy/troubleshooting) |
| SRV-011 | Server name ends with "MCP", "MCP Server" or "Plugin" | chatgpt: warning | [link](https://developers.openai.com/plugins/plugin-guidelines) |
| SRV-012 | Overly generic single-word name | chatgpt: info | [link](https://developers.openai.com/plugins/plugin-guidelines) |
| SRV-013 | serverInfo present with name and version | spec: error | [link](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle) |
| SRV-014 | Server instructions quality | chatgpt: warning, spec: info | [link](https://developers.openai.com/plugins/build/mcp-server) |
| SRV-015 | Server depends on features Claude does not support | claude: info | [link](https://claude.com/docs/connectors/building) |
| SRV-016 | ChatGPT domain-verification file format | chatgpt: info | [link](https://developers.openai.com/plugins/deploy/submission) |
| SRV-017 | Canonical server URL form | spec: warning, claude: info | [link](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization#canonical-server-uri) |
| SRV-018 | stdio server writes non-MCP output to stdout | spec: error | [link](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) |
| SRV-019 | tools/list stable across calls and connections | spec: warning | [link](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#capabilities) |
| SRV-020 | Protocol era report | spec: info | [link](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning) |
| SPEC-001 | initialize result shape | spec: error | [link](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle) |
| SPEC-002 | Capabilities declared for served primitives | spec: error | [link](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#capabilities) |
| SPEC-003 | Request responses use application/json or text/event-stream | spec: error | [link](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http) |
| SPEC-004 | Notification POST returns 202 with no body | spec: error | [link](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) |
| SPEC-005 | GET on the MCP endpoint | spec: warning | [link](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) |
| SPEC-006 | Mcp-Session-Id format | spec: error | [link](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) |
| SPEC-007 | Unsupported protocol version rejected | spec: error | [link](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http) |
| SPEC-008 | Unknown method → -32601 | spec: error | [link](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http) |
| SPEC-009 | Unknown tool → JSON-RPC protocol error | spec: warning | [link](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#error-handling) |
| SPEC-010 | Resource not found → error, never empty contents | spec: error | [link](https://modelcontextprotocol.io/specification/2026-07-28/server/resources#error-handling) |
| SPEC-011 | server/discover result | spec: error | [link](https://modelcontextprotocol.io/specification/2026-07-28/server/discover) |
| SPEC-012 | resultType on every result | spec: error | [link](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts) |
| SPEC-013 | Caching hints on cacheable results | spec: error | [link](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching) |
| SPEC-014 | Header/body mismatch rejected with -32020 | spec: error | [link](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#server-validation) |
| SPEC-015 | No sessions in modern-only servers | spec: warning | [link](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#earlier-streamable-http-revisions) |
| SPEC-016 | JSON-RPC error codes and ids valid | spec: error | [link](https://modelcontextprotocol.io/specification/2026-07-28/basic#error-codes) |
| SPEC-017 | Icons well-formed | spec: warning | [link](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts) |
| SPEC-018 | _meta key syntax and reserved prefixes | spec: warning | [link](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts) |
| SPEC-019 | SSE responses disable proxy buffering | spec: info | [link](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http) |
| SPEC-020 | List methods for declared capabilities succeed | spec: error, claude: error, chatgpt: error | [link](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#listing-tools) |
| TOOL-001 | Tool name characters and length | spec: warning | [link](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) |
| TOOL-002 | Tool name at most 64 characters | claude: error | [link](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) |
| TOOL-003 | Tool names unique | chatgpt: error, spec: warning | [link](https://developers.openai.com/plugins/plugin-guidelines) |
| TOOL-004 | Promotional or comparative tool name | chatgpt: warning | [link](https://developers.openai.com/plugins/plugin-guidelines) |
| TOOL-005 | Opaque tool name | chatgpt: info | [link](https://developers.openai.com/plugins/plugin-guidelines) |
| TOOL-006 | Tool has a title | claude: error, spec: info | [link](https://claude.com/docs/connectors/building/review-criteria) |
| TOOL-007 | Tool has a description | chatgpt: error, claude: error, spec: info | [link](https://developers.openai.com/plugins/plugin-guidelines) |
| TOOL-008 | Description too thin, generic or overloaded | claude: warning, chatgpt: warning | [link](https://developers.openai.com/plugins/plan/tools) |
| TOOL-009 | Every input parameter has a description | chatgpt: info, claude: info | [link](https://developers.openai.com/plugins/plan/tools) |
| TOOL-010 | Annotation field types | spec: error | [link](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts) |
| TOOL-011 | Claude: readOnlyHint or destructiveHint declared | claude: error | [link](https://claude.com/docs/connectors/building/submission) |
| TOOL-012 | ChatGPT: readOnlyHint, destructiveHint and openWorldHint all explicit booleans | chatgpt: error | [link](https://developers.openai.com/plugins/plugin-guidelines) |
| TOOL-013 | Contradictory annotations | chatgpt: error, claude: warning, spec: warning | [link](https://developers.openai.com/plugins/plugin-guidelines) |
| TOOL-014 | Annotations likely do not match behavior (heuristic) | claude: warning, chatgpt: warning, spec: warning | [link](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) |
| TOOL-015 | openWorldHint false on an open-ended tool (heuristic) | chatgpt: warning | [link](https://developers.openai.com/plugins/plugin-guidelines) |
| TOOL-016 | inputSchema present with root type "object" | spec: error | [link](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#tool) |
| TOOL-017 | Schemas valid for their dialect | spec: error | [link](https://modelcontextprotocol.io/specification/2026-07-28/basic#json-schema-usage) |
| TOOL-018 | Parameterless tool should set additionalProperties:false | spec: info | [link](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#tool) |
| TOOL-019 | No network $ref | spec: warning | [link](https://modelcontextprotocol.io/specification/2026-07-28/basic#ref-resolution) |
| TOOL-020 | Schema complexity bounded | spec: info | [link](https://modelcontextprotocol.io/specification/2026-07-28/basic#composition-keyword-resource-use) |
| TOOL-021 | x-mcp-header constraints | spec: error | [link](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#schema-extension) |
| TOOL-022 | x-mcp-header on a sensitive parameter | spec: warning | [link](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#x-mcp-header) |
| TOOL-023 | Catch-all HTTP tool mixing safe and unsafe methods | claude: error | [link](https://claude.com/docs/connectors/building/review-criteria) |
| TOOL-024 | Operation enum mixing read and write, or many modes | claude: warning, chatgpt: warning | [link](https://claude.com/docs/connectors/building/review-criteria) |
| TOOL-025 | Generic executor or operation dispatcher | chatgpt: error | [link](https://developers.openai.com/plugins/plugin-guidelines) |
| TOOL-026 | Free-form query tool must name or link the target API | claude: warning | [link](https://claude.com/docs/connectors/building/review-criteria) |
| TOOL-027 | Collection tools without pagination or limits | claude: info | [link](https://claude.com/docs/connectors/building/review-criteria) |
| TOOL-028 | No option to trim response size | claude: info | [link](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) |
| TOOL-029 | openai/toolInvocation status strings | chatgpt: error | [link](https://developers.openai.com/plugins/reference) |
| TOOL-030 | openai/fileParams file-object schema | chatgpt: error | [link](https://developers.openai.com/plugins/reference) |
| TOOL-031 | openai/profile marker contract | chatgpt: error | [link](https://developers.openai.com/plugins/build/auth) |
| TOOL-032 | Per-tool securitySchemes | chatgpt: info | [link](https://developers.openai.com/plugins/build/auth) |
| INJ-001 | Hidden or invisible characters | claude: error, chatgpt: error | [link](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) |
| INJ-002 | Mixed-script words (homoglyphs) | claude: warning, chatgpt: warning | [link](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) |
| INJ-003 | Markup hidden from humans, or pseudo-system tags | claude: warning, chatgpt: warning | [link](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) |
| INJ-004 | Encoded payloads | claude: warning, chatgpt: warning | [link](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) |
| INJ-005 | Overriding system instructions or hiding behavior from the user | claude: error, chatgpt: error | [link](https://claude.com/docs/connectors/building/review-criteria) |
| INJ-006 | Steering the model away from other tools | claude: warning, chatgpt: warning | [link](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) |
| INJ-007 | Coercing calls to tools or software the user did not request | claude: warning, chatgpt: warning | [link](https://claude.com/docs/connectors/building/review-criteria) |
| INJ-008 | Overly broad triggering | chatgpt: warning, claude: info | [link](https://developers.openai.com/plugins/plugin-guidelines) |
| INJ-009 | Pulling instructions from external sources | claude: warning, chatgpt: warning | [link](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) |
| INJ-010 | Safety-guardrail circumvention language | claude: warning, chatgpt: warning | [link](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) |
| DATA-001 | Requests conversation history, transcripts, memory or system prompt | claude: error, chatgpt: error | [link](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) |
| DATA-002 | Reads Claude memory, chat history or user uploads | claude: warning | [link](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) |
| DATA-003 | Inputs solicit secrets or credentials | chatgpt: error, claude: warning | [link](https://developers.openai.com/plugins/plugin-guidelines) |
| DATA-004 | Inputs collect restricted data (PCI, PHI, government IDs) | chatgpt: error | [link](https://developers.openai.com/plugins/plugin-guidelines) |
| DATA-005 | Inputs request precise user location | chatgpt: warning | [link](https://developers.openai.com/plugins/plugin-guidelines) |
| POL-001 | Money or financial-asset transfer (heuristic) | claude: warning | [link](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) |
| POL-002 | AI image, video or audio generation (heuristic) | claude: warning | [link](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) |
| POL-003 | Advertising, sponsored content, pricing or promotions | claude: warning, chatgpt: warning | [link](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) |
| POL-004 | Subscription upsell or checkout flow | chatgpt: warning | [link](https://developers.openai.com/plugins/plugin-guidelines) |
| POL-005 | Unofficial wrapper, demo or test server | chatgpt: info | [link](https://developers.openai.com/plugins/plugin-guidelines) |
| APPS-001 | UI resourceUri uses ui:// and resolves | spec: error | [link](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx) |
| APPS-002 | Deprecated or duplicated UI link keys | spec: warning, chatgpt: info | [link](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx) |
| APPS-003 | UI resource MIME type and payload | spec: error, claude: error, chatgpt: error | [link](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx) |
| APPS-004 | UI content looks like an HTML document | spec: warning | [link](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx) |
| APPS-005 | UI resource declares a CSP | chatgpt: error, claude: info | [link](https://developers.openai.com/plugins/deploy/app-review) |
| APPS-006 | CSP entries narrow and well-formed | chatgpt: warning, spec: warning | [link](https://developers.openai.com/plugins/build/chatgpt-ui) |
| APPS-007 | External origins used by the widget are declared in the CSP | chatgpt: error, claude: warning, spec: warning | [link](https://developers.openai.com/plugins/build/chatgpt-ui) |
| APPS-008 | Nested frames declared | claude: warning, chatgpt: warning | [link](https://claude.com/docs/connectors/building/mcp-apps/design-guidelines) |
| APPS-009 | csp or permissions placed on the tool instead of the resource | spec: warning | [link](https://github.com/modelcontextprotocol/ext-apps/blob/main/src/spec.types.ts) |
| APPS-010 | Tool visibility | spec: error, chatgpt: warning | [link](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx) |
| APPS-011 | Claude ui.domain equals the URL hash | claude: error | [link](https://claude.com/docs/connectors/building/mcp-apps/troubleshooting) |
| APPS-012 | ChatGPT dedicated widget domain | chatgpt: error | [link](https://developers.openai.com/plugins/reference) |
| APPS-013 | openExternal targets need redirect_domains | chatgpt: warning | [link](https://developers.openai.com/plugins/reference) |
| APPS-014 | App connects to the host | claude: warning | [link](https://claude.com/docs/connectors/building/mcp-apps/troubleshooting) |
| APPS-015 | Widget uses browser APIs the sandbox blocks | chatgpt: warning | [link](https://developers.openai.com/plugins/guides/security-privacy) |
| APPS-016 | Widget style and accessibility hints | chatgpt: info | [link](https://developers.openai.com/plugins/build/chatgpt-ui) |
| APPS-017 | UI resource meta field types | spec: error | [link](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx) |
| APPS-018 | UI tools declare outputSchema | chatgpt: warning | [link](https://developers.openai.com/plugins/reference) |
| APPS-019 | UI tools stay callable without MCP Apps (text-only fallback) | spec: warning, chatgpt: warning | [link](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx) |
| AUTH-001 | Token in the server URL query | claude: error, chatgpt: error, spec: error | [link](https://claude.com/docs/connectors/building/authentication) |
| AUTH-002 | 401 challenge format | claude: error, chatgpt: error, spec: warning | [link](https://claude.com/docs/connectors/building/authentication) |
| AUTH-003 | Wrong status for an unauthenticated request | claude: error, chatgpt: error, spec: warning | [link](https://claude.com/docs/connectors/building/authentication) |
| AUTH-004 | Protected Resource Metadata discoverable | claude: error, chatgpt: error, spec: error | [link](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery) |
| AUTH-005 | PRM `resource` matches the MCP URL | claude: error, spec: error, chatgpt: warning | [link](https://claude.com/docs/connectors/building/authentication) |
| AUTH-006 | PRM authorization_servers | claude: error, chatgpt: error, spec: error | [link](https://claude.com/docs/connectors/building/authentication) |
| AUTH-007 | Authorization server metadata discoverable | claude: error, chatgpt: error, spec: error | [link](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery) |
| AUTH-008 | Issuer identical | claude: error, spec: error, chatgpt: warning | [link](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery) |
| AUTH-009 | Required AS endpoints and response types | claude: error, chatgpt: error, spec: error | [link](https://datatracker.ietf.org/doc/html/rfc8414#section-2) |
| AUTH-010 | AS endpoints over HTTPS with trusted certificates | claude: error, chatgpt: error, spec: error | [link](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations) |
| AUTH-011 | PKCE S256 advertised | claude: error, chatgpt: error, spec: error | [link](https://claude.com/docs/connectors/building/authentication) |
| AUTH-012 | Client registration path | claude: warning, chatgpt: warning, spec: warning | [link](https://claude.com/docs/connectors/building/authentication) |
| AUTH-013 | Authorization-code grant supported | chatgpt: error, claude: warning | [link](https://developers.openai.com/plugins/build/auth) |
| AUTH-014 | RFC 9207 iss parameter | chatgpt: info, spec: info | [link](https://developers.openai.com/plugins/build/auth) |
| AUTH-015 | Scope guidance | claude: info, spec: warning, chatgpt: info | [link](https://claude.com/docs/connectors/building/authentication) |
| AUTH-016 | Invalid token gets 401 | spec: error, chatgpt: warning | [link](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization#token-handling) |
| AUTH-017 | OAuth endpoint latency | claude: error | [link](https://claude.com/docs/connectors/building/authentication) |
| AUTH-018 | Microsoft Entra ID notes | claude: info | [link](https://claude.com/docs/connectors/building/authentication) |
| AUTH-019 | DCR accepts JSON registration | claude: warning | [link](https://claude.com/docs/connectors/building/authentication) |
| AUTH-020 | Redirect URIs accepted at /authorize | claude: error | [link](https://claude.com/docs/connectors/building/authentication) |
| AUTH-021 | Token endpoint form-encoding and error codes | claude: error | [link](https://claude.com/docs/connectors/building/authentication) |
| RT-001 | Error messages are specific | claude: error | [link](https://claude.com/docs/connectors/building/review-criteria) |
| RT-002 | Invalid input silently accepted | claude: warning, spec: warning | [link](https://claude.com/docs/connectors/building/review-criteria) |
| RT-003 | Input-validation errors reported with isError | spec: warning | [link](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts) |
| RT-004 | Result size | claude: error | [link](https://claude.com/docs/connectors/building) |
| RT-005 | Tool latency | claude: error, chatgpt: warning | [link](https://claude.com/docs/connectors/building) |
| RT-006 | structuredContent conforms to outputSchema | spec: error, chatgpt: error | [link](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#output-schema) |
| RT-007 | structuredContent mirrored as text | spec: warning | [link](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#structured-content) |
| RT-008 | UI tools return meaningful content | spec: warning | [link](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx) |
| RT-009 | Auth failures surfaced at the transport level | claude: warning, chatgpt: warning | [link](https://claude.com/docs/connectors/building/lazy-authentication) |
| RT-010 | Results leak internals or secrets | chatgpt: warning | [link](https://developers.openai.com/plugins/plugin-guidelines) |
| RT-011 | Injection patterns in tool output | claude: warning, chatgpt: warning | [link](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) |
| RT-012 | Behavior gated on clientInfo | claude: info | [link](https://claude.com/docs/connectors/building/testing) |

**Manual checklist** (printed as reminders; never scored):

| ID | Platform | Reminder |
|---|---|---|
| MAN-001 | claude | Privacy policy URL (data collection, usage, retention) |
| MAN-002 | claude | Listing: name ≤100, one-liner ≤200, description ≤2000, 1–5 categories, docs URL, privacy URL, support contact, icon; slug is permanent |
| MAN-003 | claude | ≥3 working example prompts; populated test account |
| MAN-004 | claude | Public documentation by publish date |
| MAN-005 | claude [ui] | Carousel screenshots: PNG, ≥1000 px wide, 3–5 images, cropped to the app response |
| MAN-006 | claude [ui] | Allowed link URIs: https origins or owned custom schemes only |
| MAN-007 | claude [oauth] | Rotate refresh tokens for public clients; return the new one in the same response |
| MAN-008 | claude [oauth] | Register `https://claude.ai/api/mcp/auth_callback` exactly; loopback callbacks port-agnostic |
| MAN-009 | claude | WAF/CDN allows Anthropic egress `160.79.104.0/21` |
| MAN-010 | claude | Server calls your own first-party APIs (or legitimately proxied ones) |
| MAN-011 | claude | Compliance acknowledgments: guidelines, first-party API, financial transactions, AI media generation, prompt injection, conversation data, public docs |
| MAN-012 | claude | Tool descriptions accurately describe real behavior (reviewers test each tool in Verified review) |
| MAN-013 | spec [oauth] | Validate token audience (accept the canonical URI); never pass the client's token upstream |
| MAN-014 | spec [oauth] | Low-scope token → 403 `insufficient_scope` with `scope` and `resource_metadata` |
| MAN-015 | chatgpt | Listing (final submission limits): displayName ≤30, shortDescription ≤30, longDescription ≤4000, developerName ≤80, valid category, ≤20 capabilities of ≤120 chars |
| MAN-016 | chatgpt | websiteURL, supportURL, privacyPolicyURL, termsOfServiceURL: HTTPS, no credentials, ≤1024 chars, publicly accessible |
| MAN-017 | chatgpt | Starter prompts: ≤3, ≤128 chars, single line, unique, no @mentions |
| MAN-018 | chatgpt | Brand colors `#RRGGBB`, ≥2:1 contrast vs white / vs #212121 (dark) |
| MAN-019 | chatgpt | Icons square, 48–4096 px, ≤5 MiB, PNG/JPEG/WebP/SVG |
| MAN-020 | chatgpt | Exactly 5 positive and 3 negative test cases; tools_triggered exist; release notes |
| MAN-021 | chatgpt | Demo recording URL covering web, iOS and Android |
| MAN-022 | chatgpt | Works on desktop and mobile, including UI; light and dark themes; WCAG AA contrast |
| MAN-023 | chatgpt | Package: no test_credentials/reviewer_instructions, no clientSecret, no non-empty server headers, no `.app.json`/apps/hooks |
| MAN-024 | chatgpt [ui] | Screenshots are optional and allowed only with custom UI: one PNG or JPEG per starter prompt, exactly 706 px wide, 400–860 px tall |
| MAN-025 | chatgpt | Privacy policy discloses categories, purposes, recipients, retention, user controls; covers every user field tools return |
| MAN-026 | chatgpt [oauth] | Reviewer test account: works externally, no MFA/SMS/magic link, doesn't expire, seeded data |
| MAN-027 | chatgpt | Be ready to justify each tool's three hints (`justification_required` may still appear) |
| MAN-028 | chatgpt [oauth] | Advertised OIDC scopes (openid/email/profile) enabled for the client |
| MAN-029 | chatgpt | Not an unofficial third-party connector, demo or trial; EU data residency projects cannot submit |
| MAN-030 | chatgpt | Physical goods only for commerce; no subscription upsell |
| MAN-031 | spec | Consider running `npx @modelcontextprotocol/conformance server --url <url>` for full schema conformance |
<!-- RULES:END -->

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

Test fixtures live in `test/fixtures/`: a compliant stdio server (`good-server.mjs`), a server that violates many rules (`bad-server.mjs`), an HTTP bridge with switches for wire-level defects, an OAuth metadata server with good and bad variants, and a raw 2026-07-28 server.

## License

MIT
