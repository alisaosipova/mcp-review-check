# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [semantic versioning](https://semver.org/) as described in the README's [Stability policy](README.md#stability-policy): while the version is 0.x, new rules and higher severities ship only in minor releases, and patch releases never make a passing run fail.

Each release notes the rule catalog date and groups rule changes under **Rules added**, **Severity raised**, **Severity lowered / false positives fixed** and **Rules retired** (retired IDs are never reused).

## [Unreleased]

First public release, planned as 0.1.0.

### Added

- Rule catalog dated 2026-10-22: automated rules (SRV, SPEC, TOOL, INJ, DATA, POL, APPS, AUTH, RT) and manual checklist items (MAN), each linked to its public source.
- Checks remote Streamable HTTP, legacy HTTP+SSE and stdio servers, including OAuth discovery probes and opt-in runtime checks (`--active`, `--active-auth`).
- Text, JSON, Markdown and SARIF reports with per-platform verdicts for the Claude connector directory and ChatGPT plugins.
- `npm pack` and `npm publish` build `dist/` themselves (`prepack`), so a package made from a clean clone ships a working `mcp-review-check` binary.
- CI on Node 20.19, 22 and 24 on Linux, macOS and Windows (build, typecheck of sources and tests, tests, a packed-tarball smoke run), a release workflow that publishes a version tag to npm with provenance through trusted publishing (OIDC), and Dependabot updates for npm and GitHub Actions.
- A stability policy in the README.
- `--stdio -- <command> [args...]` passes the server command verbatim, without quoting rules.
- JSON reports carry `schemaVersion` (1) and `tool.catalogAgeDays`.
- A check run warns on stderr when the rule catalog is more than 90 days old.
- Secret redaction for stdio as well as HTTP: one redactor per run scrubs every report format and the `--verbose` output of `--bearer`, `--header` and `--env` values, URL credentials, and stdio arguments after secret-looking flags, kebab-case or camelCase (`--api-key X`, `--accessToken X`, `--token=X`, `API_KEY=X`, `Authorization: Bearer X`), including where the server echoes them on stdout, on stderr or in its tool metadata (also when an input cap, the trace snippet, a connection error message or the stderr tail cuts through the echo: values are masked before any cut). Usage errors no longer repeat option values.
- Redaction recognizes a secret sign in any segment of a stdio flag, `KEY=` or URL query parameter name (`--auth-header`, `--api-key-value`, `?api-key=`, `?credential=`, `?client_secret=`), but not names that point to a secret (`--token-file`, `--key-id`); it also masks a query value as written (`+`, lowercase `%2f`), masks the `rerun:` line by position whatever the value length, hides a URL password that contains `@` in usage errors, and handles server data nested thousands of levels deep instead of crashing. `--list-rules` followed by something that is not a rule ID prefix (a URL, a path) lists the whole catalog without repeating it.
- Connection diagnostics: DNS (NXDOMAIN), refused, timed-out and TLS-certificate failures are named, and a URL that answers 404/405 or an HTML page is reported as "not an MCP endpoint" with a suggested URL (`<url>/mcp`, or `/mcp` instead of `/sse`). A URL without a scheme is rejected (exit 2) with a `https://` suggestion (`http://` for localhost).
- JSON reports gain `coverage.diagnosis` on a failed connect.
- The linter declares the MCP Apps client capability (`io.modelcontextprotocol/ui`) on every connection (SDK handshake, raw `initialize` probes, 2026-07-28 `_meta`), so UI tools registered with the ext-apps `getUiCapability` pattern are checked by the APPS rules. When a tool links a UI, one more connection without the capability lists the tools a text-only host sees.
- Regression fixtures frozen from public servers' listings (`test/fixtures/real/`, refreshed with `scripts/capture-real.mjs`) guard the heuristic rules against known false positives and against new warnings compared with the baseline findings.
- `--max-duration <ms>`: an overall deadline; the report covers what ran and names the phase where it stopped (text, markdown, JSON `limits.stopped`). Without a handshake by then the run exits 3; after it, the verdicts read `INCOMPLETE` and JSON `coverage.toolLevel` is `stopped`.
- The text report prints a ready JSON fragment (title and annotation hints) for each tool that lacks them, and text and markdown show "N root causes" next to the score.
- `--quiet` (text only): just the error and warning findings, the Score and Result lines and the disclaimer. `--checklist` (text only) prints the manual checklist in full.
- Automatic local mode: besides `localhost`, a host without a dot or one whose every address is non-public (public DNS and the system resolver, so `/etc/hosts` and container names count) is checked in local mode. `--local` and `--no-local` force it on or off (`--no-local` also for `--stdio`). The local-mode banner names the rules made informational and goes to stderr with `--format json` and `sarif`. In local mode the AUTH rules accept plain-http OAuth endpoints on any local host (loopback, a non-public IP, a name without a dot, or the MCP server's own host), not only on loopback.
- `explain <RULE-ID>` prints a rule's severity per directory, rationale, sources and fix, and the `--ignore` hint (unknown ID: exit 2). `--list-rules` takes `--format json` or `markdown` and an ID prefix (`--list-rules TOOL`); `--list-rules --verbose`, the `--verbose` text report and the markdown report ("Why these rules") show each rule's rationale. The rule table in `docs/RULES.md` and `--list-rules --format markdown` come from one generator.
- `--ignore` with an ID that is neither a rule nor a manual item exits 2 instead of being silently accepted. An unknown option suggests the closest one ("did you mean --format?") without repeating its value, and `--help` has examples.
- GitHub Actions mode: with `GITHUB_ACTIONS=true`, findings are printed as `::error` and `::warning` annotations on stderr at their severity for the `--target` directories, and the markdown report is appended to `$GITHUB_STEP_SUMMARY` when it is set (stdout stays the report). `FORCE_COLOR` colours the text report without a TTY. The markdown report has an Evidence column and a `rerun: npx mcp-review-check …` line with secrets redacted.
- README: the purpose and the `npx` command in the first lines; a token recipe for OAuth-protected servers, CI recipes (a stdio server, a preview deployment URL), a Docker Compose recipe, Privacy, FAQ, the environment variables (including `MCP_REVIEW_CHECK_NO_CTA`) and a dated comparison with other MCP tools. The rule table moved to the generated `docs/RULES.md`; `npm run readme:rules` writes it and the catalog date in the README, including the example report header.
- `SECURITY.md` (what the tool sends, the threat model, known redaction gaps and a private reporting channel), `CONTRIBUTING.md` (how to add a rule and regenerate `docs/RULES.md`) and issue forms for a false positive (asks for the JSON report), a rejection despite a passing check, and a bug. The design document moved from `SPEC.md` to `docs/design/spec.md`, marked as possibly differing from the implementation.

#### Rules added

- APPS-019 (spec, chatgpt: warning): a UI-linked tool must stay listed for clients that do not declare `io.modelcontextprotocol/ui` (text-only fallback).

#### Severity raised

- TOOL-007 (missing tool description) is an error for Claude as well as ChatGPT (Software Directory Policy: tools must have descriptions).
- SRV-001 checks the MCP server's own TLS certificate, also when the server does not answer 401 (it was only reported by AUTH-010 on OAuth servers): an untrusted certificate is an error. AUTH-010 now covers the authorization server hosts only.

#### Severity lowered / false positives fixed

- SRV-008: a 403 for the assumed Claude/ChatGPT `Origin` values is info, not a warning, until the Origin real hosts send is verified.
- SRV-016: an HTML page at `/.well-known/openai-apps-challenge` (a SPA catch-all) is not checked as a verification file.
- TOOL-027: more limit-like parameters count (`max_length`, `start_index`, `max_tokens`, `maxCharacters`, `numResults`, `page_token`, `top_k`, …); `query` and `all` no longer trigger it, and the description is used only when the tool name has no verb.
- APPS-014: ext-apps mentions in comments do not count, and a widget that sends `ui/initialize` itself has connected.
- RT-*: a 2026-07-28 `resultType: "input_required"` interim result is neither a success nor an error (RT-005 still measures its latency).
- INJ-006: "Do not use it/this for other …" restricts the tool's own scope and is no longer flagged. "Always use this tool/skill when/to/for …" describes when the tool applies and is info, not a warning; unconditional "always use this tool" and disparaging wording stay warnings. The fix names the flagged object (tool, skill, resource, prompt or instructions).
- INJ-005: presentation guidance about raw data ("Never show raw note IDs to the user") is not hiding behavior.
- INJ-004: base64 that decodes to JSON (pagination cursors, JWT segments) is skipped unless the decoded text carries instruction-like wording.
- TOOL-014: quoted strings and examples (`e.g.`, `for example`, `such as`) are ignored, and a write word found only in the description is info and is named in the message; a write verb in the tool name stays a warning.
- POL-004: widget links are compared by whole path words (`contracts-upgradeable` is not `upgrade`), source-code hosts (GitHub, GitLab, …) are skipped, and templated links (`${…}`, `{{…}}`, `$1`) are not extracted.
- RT-011 ignores informational INJ-006 wording in tool output.
- SRV-013: a problem in both `initialize` and `server/discover` is reported once, naming both; an empty `serverInfo.version` is a warning (missing stays an error).

#### Other rule changes

- RT-005: `--active` tool calls are cut off at 241 s, so a call past Claude's documented 240 s timeout is an error ("exceeds Claude's 240 s tool call timeout") and, as before, a ChatGPT warning (5 s threshold); the 60 s and 5 s thresholds are labelled linter-defined.
- MAN-024 states the ChatGPT screenshot rules as published: optional, only with custom UI, one PNG or JPEG per starter prompt, 706 px wide and 400–860 px tall (the "no longer shown" note is gone).
- TOOL-006 reports a tool title longer than 60 characters as info for Claude (linter-defined limit; a title is a UI label), and long titles are shown as snippets in its messages.
- SRV-002: the ChatGPT finding has its own fix and OpenAI docs link instead of the Claude plugin advice.
- SRV-020 cites the 2026-07-28 versioning page.
- SRV-004 also asks the system resolver (`dns.lookup`): a name that only `/etc/hosts` or a container DNS knows "resolves only locally" instead of having "no A record".
- SRV-004 says "does not resolve (NXDOMAIN)" instead of "no A record; Connectors are IPv4-only" when a hostname does not exist, and a failed DNS lookup is `inconclusive (network)` (info).
- TOOL-012 reports one finding per tool listing every missing hint, instead of one per hint.
- TOOL-014 no longer reports a read verb without `readOnlyHint` (spec) when the tool has no `annotations` object at all; TOOL-011 and TOOL-012 already cover it.

### Changed

- The auth-required notice says which token to use (an access token for a test account, issued for the server) and points to the README token recipe.
- The text report shows the manual checklist as one line (`N manual items: --checklist to show`); markdown and JSON still list every item. The protocol revision and its note are in the header of text and markdown instead of an SRV-020 line (JSON and SARIF keep the finding), and the TOOL-013 info about `idempotentHint` on a read-only tool is shown only with `--verbose`.
- The score counts root causes, not findings: 100 − 12 per rule with an error − 4 per rule with only warnings, not below 0 (it counted up to 3 findings per rule), so most scores change; JSON `summary.scoreVersion` is 2. Findings with the same rule and message collapse into one text line with a count from two up (it was from four; `--verbose` lists each).
- The exit code follows `--target`: each finding counts at its Claude or ChatGPT severity for the chosen directories (`all` = both), and MCP spec findings count only with the new `--fail-on-spec` flag. Previously a spec-only error (for example SPEC-004) failed `--target claude`. The `Result:` line, the `--output` summary line and JSON `summary.gate` name the findings that failed the run, and a pass notes spec findings that were not counted. A run that could not connect (exit 3) reads `Result: FAIL (could not connect)`, never `PASS`.
- Timeouts, connection resets, 5xx and 429 (with `Retry-After` up to 5 s) are retried (at most 3 attempts, a timeout only once) in the preflight, Origin, challenge, OAuth metadata, invalid-token and TLS probes. Probes that still fail only for network reasons give `inconclusive (network)` info findings in AUTH-004, AUTH-007, AUTH-010, AUTH-016 and SRV-001 instead of errors, and AUTH-004 and AUTH-007 list the status of every attempt.
- Requires Node 20.19 or newer. The development dependencies moved to vitest 4 and `@types/node` 20, and `npm audit` reports no known vulnerabilities.
- The version in `--version`, the report header, JSON `tool.version` and the `clientInfo` sent to the server is read from `package.json` (one place).
- In `--stdio "<command>"`, a backslash outside quotes is literal, so Windows paths such as `C:\Users\me\server.js` work. Use quotes (or the `--` form) for arguments with spaces.
- A failed HTTP connect is now a spec-only SRV-003 error (its fix is the suggested next step), so the Claude and ChatGPT verdicts read `INCOMPLETE` (as for stdio) instead of `BLOCKED`; the manual checklist is not printed when nothing connected. An HTML error page in an SDK error message is shown by its title only.
- Input caps before the pattern rules: metadata strings over 16 KB and UI resources over 2 MB are truncated (and reported in text, markdown and JSON `limits`); SDK error bodies are capped at 64 KB. Regexes with quadratic worst cases (product-name detection in TOOL rules, tag scans in APPS rules) are bounded, so an 80 000-character description is checked in well under 2 s.
- After a failed connect the Claude and ChatGPT verdicts read `INCOMPLETE` even when a static check (SRV-001 on an `http://` URL) has an error; the score covers every platform, so it is the same for every `--target` (the exit code still follows `--target`); the `Result:` line also names the spec findings no chosen directory counted when the run fails; with `--quiet` it names the connect failure cause and why a check is partial (`auth-required`, …); `mcp:8080/mcp` (a name without a dot and a port, no scheme) gets an `http://` suggestion.
- The call to action is a mechanism that stays off: no contact URL is set, so no report shows one. When a URL is set, it appears only in text and markdown, above the disclaimer, and only when a directory verdict is `BLOCKED`, the server is on the legacy era or it requires auth; `MCP_REVIEW_CHECK_NO_CTA=1` hides it. SARIF never carries it (neither as `informationUri` nor as `properties.contact`); JSON `contact` stays `null`.
