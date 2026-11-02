# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [semantic versioning](https://semver.org/) as described in the README's [Stability policy](README.md#stability-policy): while the version is 0.x, new rules and higher severities ship only in minor releases, and patch releases never make a passing run fail.

Each release notes the rule catalog date and groups rule changes under **Rules added**, **Severity raised**, **Severity lowered / false positives fixed** and **Rules retired** (retired IDs are never reused).

## [Unreleased]

Nothing yet.

## [0.3.0] - 2026-11-02

Rule catalog dated 2026-11-01. No rule changes; this is a minor release for new CLI features and the Node 22.12 minimum.

### Added

- A config file holds the options for a check: `--config <file>`, or else `mcp-review-check.config.json` or `.mcp-review-check.json` found in `--cwd` or the working directory (`--no-config` turns the search off), with the long option names in camelCase as keys (`failOn`, `toolArgs`, …) and `url` or `stdio`/`args` for the server, validated like the options and overridden by the command line; a wrong key or type is a usage error (exit 2) that names the file and the key but never a value, and `header` or `bearer` in the file prints a warning to keep tokens in `$MCP_REVIEW_CHECK_TOKEN`.
- `--json-output <file>` writes the JSON report (the `--format json` document, with `baselined` marks under `--baseline`) besides the chosen format, and `--save-baseline <file>` does the same under the baseline name, so one run can print a text or SARIF report and write the file that later runs pass to `--baseline`.
- `--format junit` writes JUnit XML for CI test views (GitLab `reports: junit`, Jenkins, `dorny/test-reporter`): one test suite per gated platform and one test case per rule, failing when its findings reach `--fail-on` (findings known from `--baseline` never do), `<skipped>` for a rule that did not run, and an `<error>` for a failed connect or a `--max-duration` stop.
- The GitHub Action has outputs read from the JSON report of the same run: `score` (empty for a partial check), `verdict` (`PASS`, `FAIL` or `INCOMPLETE`, as the Result line), `verdict-claude` and `verdict-chatgpt` (the directory verdicts), `errors`, `warnings`, `new-findings` (findings not in the `--baseline`) and `report-json` (the report's path).

### Changed

- Requires Node 22.12 or newer (was 20.19), because Node 20 has been end-of-life since 2026-04-30, and CI runs Node 22 and 24 on Linux, macOS and Windows; while the version is 0.x, a minor release may raise the minimum Node version.
- The GitHub Action's `version` input defaults to `0.3` and needs 0.3 or newer, since its outputs read the report written with `--json-output`.
- Exit code 2 also covers a wrong config file and a `--json-output` or `--save-baseline` file that cannot be written (the primary report is still printed or written).
- The input caps also cover the `--active` tool calls' arguments, JSON-RPC errors and transport errors and the JSON-RPC errors observed during the run, each long string cut at 16 KB and listed under `limits.truncated`, so a multi-megabyte error message no longer reaches the rules' pattern checks and the finding text whole.
- A run stopped by `--max-duration` during the Origin probes keeps the probes already made, so SRV-008 reports what they show, or is listed as skipped (`stopped by --max-duration`) when they show nothing, instead of losing all four.
- Each feature or coherent feature set ships as its own minor release, published through npm trusted publishing, with the `NPM_TOKEN` step kept only as a documented fallback (CONTRIBUTING.md).

### Fixed

- The CI self-test of the GitHub Action checks each output on its own line, so a wrong value fails the job (a `test a && test b` line under `bash -e` let a failing first test pass).

## [0.2.0] - 2026-11-01

Rule catalog dated 2026-11-01 (public sources as of 2026-10-22). Three rules are new (see **Rules added**), several rules report more than before (see **Severity raised**) and exit code 4 changes the exit-code contract (see **Changed**), so this is a minor release.

### Added

- `--ignore` accepts a comma-separated list (`--ignore TOOL-006,TOOL-011`).
- `explain` shows what a rule needs to run (`--active`, `--active-auth`, a `<url>` target, a tools listing) and, for a manual item, the feature it is shown for; `--list-rules --verbose` prints the needs, and the text listing tags manual items `[ui]` or `[oauth]`.
- Warnings on stderr when `--tool-args` is given without `--active`, `--sarif-location` without `--format sarif`, and for each `--tool-args` entry that no `--active` call used, with the reason (unknown tool, not read-only, or past the call cap).
- JSON reports gain `summary.rootCauses` (the basis of `summary.score`) and, for stdio targets, `server.argv` (each argument whole).
- README and `SECURITY.md` list every request `--active` sends (at most 50 tools, and three fresh connections named `mcp-review-check`, `claude-ai` and `Anthropic`), the session `DELETE`s, the read limits, and the exit codes for a signal (128+N) and for an internal error (3).
- `npm run test:coverage` reports the test coverage of `src/`.
- `--fail-on-incomplete` makes a partial check exit 3 (the server requires auth and no token was given, the token was rejected, or `tools/list` failed), so a CI job whose token is missing or expired no longer passes; without it the exit code follows `--fail-on` as before.
- In GitHub Actions a partial check prints one `::warning` titled `mcp-review-check` that names the reason and says that tool-level checks were skipped, with or without `--fail-on-incomplete`.
- `--baseline <report.json>` treats the findings of an earlier `--format json` report as known, matched by rule, tool or resource, path and platforms rather than by wording, so only new findings count toward `--fail-on`, the verdicts, the finding counts and the annotations (JSON marks each finding `baselined` and adds `summary.baselined`, SARIF sets `baselineState` to `new` or `unchanged`, text and markdown list only new findings plus one line with the known count, and a file that is missing or not a JSON report of mcp-review-check is a usage error, exit 2).
- A GitHub Action, `uses: alisaosipova/mcp-review-check@v0.2.0`, runs the check on a URL (`target`) or a stdio command (`stdio`), prints the findings as annotations and the report in the job summary, and writes a SARIF report that it uploads to code scanning even when the check fails (inputs `platform`, `fail-on`, `fail-on-spec`, `active`, `bearer` passed only as `MCP_REVIEW_CHECK_TOKEN`, `version`, `sarif-file`, `upload-sarif`, `extra-args`, `cli-path`; outputs `exit-code` and `sarif-file`).
- In a JSON report of a run stopped by `--max-duration`, `limits.stopped` lists the phases that ran to their end (`completed`) and the phase cut short with every later one (`unfinished`).

#### Rules added

- TOOL-033 (claude, chatgpt: error): a tool name that is empty or has a character outside `A-Z a-z 0-9 _ -` (for example the `.` the MCP specification allows, a space or `/`) is rejected by the Claude API and the OpenAI API, and the message lists the offending characters.
- TOOL-034 (claude, chatgpt: info): one finding per server with more than 40 tools or more than 64 KiB of `tools/list` JSON (linter-defined budget), because every definition costs context tokens on each turn and tool selection gets less accurate with many tools.
- TOOL-035 (spec: info): input and output schemas, nested ones included, are checked for `required` names not declared in `properties` (unless the schema admits extra keys or composes properties), keys one edit from a JSON Schema keyword (`propeties`, `requried`, `additionalProperty`) and `format` values outside JSON Schema 2020-12 and the OpenAPI format registry, all of which validators silently ignore.

#### Severity raised

- SRV-008 checks local legacy HTTP+SSE servers too: the Origin probes open the event stream, so a server that accepts a foreign Origin (DNS rebinding risk) is reported instead of passing silently.
- SRV-010 reports slow servers that answer over SSE: it measures latency until the JSON-RPC result arrives, not until the response headers, and only over calls answered with a result, so fast rejected probes no longer hide a slow handshake or listing.
- SRV-018 also reports JSON log lines (pino, winston, bunyan) on stdout, not only lines that are not JSON at all.
- SPEC-017 warns when an icon's `sizes` is not an array and notes `image/jpg` (use `image/jpeg`).
- SPEC-018 flags the spec's reserved `_meta` prefix examples (`modelcontextprotocol.io/`, `mcp.dev/`, `tools.mcp.com/`).
- SPEC-020 reports a 2026-07-28 result that answers another request id, a non-string `nextCursor` (the listing used to stop silently after the first page) and list entries that are not objects, in both protocol eras.
- SPEC-010 notes (info) a server that returns content for a missing resource URI.
- TOOL-014 reports a tool whose name joins `delete` to another word without `destructiveHint`.
- TOOL-020 also bounds the depth and size of `outputSchema`.
- Schema-walking rules (TOOL-009, TOOL-020, TOOL-021, TOOL-022 and others) also see subschemas under `dependentSchemas`, the schema form of `dependencies` and `additionalItems`.
- DATA-003 reports compound secret parameter names such as `new_password`, `github_token`, `aws_secret_access_key` and `credentials` as warnings.
- DATA-004 recognizes more card, bank and government-ID names: `card_cvc`, `cvv_code`, `card_exp_month`, `passport_no`, `aadhaar` and `ssn_last4` as errors, `exp_month`, `routing_number`, `account_number`, `license_number` and `nino` as warnings.
- APPS-005 warns about CSP keys the hosts ignore (for example camelCase `connectDomains` inside `openai/widgetCSP`) and suggests the known field.
- APPS-006 reports wildcards on multi-label public suffixes (`*.co.uk`) and shared cloud hosts (`*.cloudfront.net`, `*.amazonaws.com`), unencrypted `ws://` entries, wildcards outside the leftmost host label and `data:`/`blob:` sources, and lists `claude: info` for the public-CDN hint it already gave Claude.
- APPS-007 checks the origins of ES module imports and `<script type="importmap">` targets (warning, as for other origins found in scripts).
- APPS-016 also reports Google Tag Manager, Google Analytics, Hotjar and Segment as trackers.
- APPS-017 reports a `_meta.ui` that is not an object.
- AUTH-002 adds a spec warning to quote an unquoted `resource_metadata` in `WWW-Authenticate`.
- AUTH-006 also validates `authorization_servers[1]` and `[2]` for ChatGPT.
- RT-002 also reports a success answer to the `--active` call made without the required arguments.
- RT-010 finds credentials in plain-text and code-fenced results, not only in parsed JSON, and recognizes the token formats report redaction knows (Stripe, GitLab, Slack, Google, npm and Hugging Face keys besides JWT, `sk-`, `ghp_` and `AKIA`).
- RT-011 also scans the string values of `structuredContent` and the text of embedded resources, and says where it found the injection.
- TOOL-002 (tool name at most 64 characters) applies to ChatGPT too, as an error, because the OpenAI API rejects longer function names.
- SPEC-016 warns about a successful response whose id is not the request's ("result answers another request id"), for example a wire probe answered under id 999, while a listing of a declared capability answered that way stays SPEC-020's finding alone.

### Changed

- **Exit code 4** (was 3) when `--max-duration` stops the check after the handshake, so CI can tell a slow server from an unreachable one; this changes the exit-code contract, and exit 3 still means could not connect or complete a handshake (also when the deadline ran out before it) or an internal error.
- A run stopped by `--max-duration` keeps the wire probes and `--active` tool calls that had finished, and a rule that found nothing in data of a phase the stop cut short is listed as skipped ("stopped by --max-duration") instead of passing.
- The package is CLI-only: `package.json` has no `main` any more and its `exports` map exposes only `./package.json`, so `import 'mcp-review-check'` and deep imports of `dist/` fail, while the `mcp-review-check` bin is unchanged.
- `--bearer` and `--header` with `--stdio` are usage errors (exit 2), and `$MCP_REVIEW_CHECK_TOKEN` is ignored for stdio targets, so an exported CI token no longer marks a stdio run as authenticated and turns RT-009 off.
- More usage errors (exit 2) instead of a failed connect or a merged header: `--header "Authorization: …"` together with `--bearer`, a header name given twice in any case or one that is not an HTTP token, a `--cwd` that is not an existing directory, an empty `--output`, `--active-auth` with `--stdio`, and a `--timeout` or `--max-duration` that is not a whole number of milliseconds (`0x10`, `1e2`, `1.5`).
- `--target`, `--format` and `--fail-on` accept values in any case, as `--ignore` and `explain` already did.
- `--active` synthesizes arguments that pass common validation: sample values for string formats (uri, email, date-time, uuid, …), string lengths, numeric bounds and `multipleOf`, `minItems`, required properties of nested objects, the first `anyOf`/`oneOf` branch and local `$ref`.
- The check ends each Streamable HTTP session it opens with one `DELETE`, also a session a stateful server mints for a raw `initialize` probe, so repeated runs leave no sessions behind.
- A 403 handshake failure names a Cloudflare bot challenge or a WAF block (Cloudflare, Akamai, AWS WAF, Imperva) or the HTML page title, with a hint to allow the endpoint.
- A stdio server that announces an HTTP URL on stdout (an HTTP server started with `--stdio`) gets a pointer to check that URL instead.
- stdio messages up to 64 MiB are accepted (the SDK default was 10 MB), and a larger one is named as the cause of the "Connection closed" errors that follow.
- The input caps also cover raw list pages, the text-only `tools/list`, tool call results, 2026-07-28 results and object keys, and at most 50 UI resources are read per run (the report says when more were listed).
- The auth probe requests a metadata URL named by `resource_metadata` only once, waits at most 10 s per metadata request, and shares one budget of six retries across all of them.
- The TLS handshake check stops at the `--max-duration` deadline (and after at most 10 s), and a check the deadline cut off is reported as inconclusive.
- Common settings given under a plain `--env` name (`production`, `debug`, log levels, version numbers) are no longer masked in the report; under a secret-looking name they still are.
- The exported `failed()` helper defaults to the CLI's gate (claude and chatgpt; spec only when passed).
- CI and release builds install dependencies without their install scripts, CI runs the end-of-life Node 20.19 on Linux only (Node 22 and 24 on every OS), runs on `main` are no longer cancelled by a newer push, and releases publish through npm trusted publishing, with the `NPM_TOKEN` secret used only in a separate first-release step while it is set.
- the rule catalog date is now 2026-11-01, because this release changes rule severities.
- SRV-018 counts every non-JSON-RPC stdout line (not only the first 50 kept) and says "non-JSON-RPC line(s)".
- SRV-009 reports one finding per exchange and each bot-challenge signal once, so one Cloudflare challenge page gives one warning instead of three.
- `--help` lists the exit codes one per line, including exit 3 for an internal error and 128+N when ended by a signal.
- The release workflow fails when the published version has no npm provenance attestation on the registry.
- `npm audit` no longer runs on pull requests: it runs on pushes to `main` and weekly (`.github/workflows/audit.yml`).
- `npm run test:coverage` fails below the coverage thresholds (statements 88 %, branches 82 %, functions 89 %, lines 92 %) and reports coverage even when a test fails, while `npm test` does not check coverage.

### Fixed

- The README note on running from a checkout no longer says the package is unpublished; it covers only a machine without registry access.
- `node dist/cli` without the `.js` extension runs the CLI; it exited 0 without checking anything.
- After SIGINT or SIGTERM, a run that still finishes during the shutdown grace period writes no report; it overwrote `--output` with a report that looked complete.
- `--stdio "<command>"` together with `-- <command> [args...]` says "not both" instead of "expected a single <url>".
- The `--output` summary line reads "1 error" and "1 warning" in the singular.
- `--list-rules <prefix> --format markdown` no longer prints an empty rule table or an empty checklist table.
- `--tool-args` no longer matches tools named `constructor`, `toString`, `__proto__` or other `Object.prototype` members.
- A stdio server whose handshake fails or is stopped by `--max-duration` has its stderr and stdout shown: the fatal message names the first stray stdout line, SRV-018 reports it, and `--verbose` prints the stderr.
- A legacy HTTP+SSE server that requires auth only on `GET /sse` gets the auth probe and "requires auth" coverage instead of "not an MCP endpoint, try /mcp", and an SSE handshake error (an endpoint on another origin) is reported as such.
- A server whose `initialize` is public but whose `tools/list` answers 401 gets the auth probe and "requires auth" coverage instead of SPEC-008, SPEC-014 and SPEC-020 errors.
- A 401 to credentials passed with `--header` is reported as rejected credentials, not as "server requires OAuth".
- A server that exits right after `initialize` no longer passes with a score of 100: the check is marked partial (`list-failed`).
- A `--max-duration` deadline that falls while connections close after the last check no longer turns a finished run into INCOMPLETE "during active tool calls", and a stopped run keeps the JSON-RPC errors and 2026-07-28 results it had observed.
- SSE responses whose lines end in a lone CR are parsed.
- A 2026-07-28 response that echoes the request id as a string no longer makes every request wait for the full `--timeout`.
- A list page with hundreds of thousands of entries no longer crashes the run with `fatal: RangeError` (exit 3).
- A `--header`, `--bearer` or `--env` secret shorter than 8 characters is masked only as a whole word, so a short key such as `test` no longer rewrites tool names and descriptions (`run_tests`, `latest`) or breaks the `«redacted»` marker.
- IPv4-mapped IPv6 addresses in hex form (`[::ffff:7f00:1]`), uncompressed loopback, multicast and documentation ranges count as local or non-public.
- The manual checklist shows the OAuth items for servers that use legacy (2025-03-26) discovery without Protected Resource Metadata.
- A rule outside `--target` that throws is reported as an INTERNAL finding instead of disappearing, and SARIF has a rule entry for INTERNAL results.
- A tool or resource named `""` is shown as `(empty name)` in every format instead of an empty subject.
- Findings are sorted by code unit, so JSON and SARIF order no longer depends on the locale or ICU build of Node.
- Finding snippets show emoji ZWJ sequences such as 👨‍💻 as written, and fix snippets no longer depend on the wording of the TOOL-006 message.
- The markdown appended to `$GITHUB_STEP_SUMMARY` is cut at a line end to fit GitHub's 1 MiB step limit, with a note, instead of being dropped whole by GitHub.
- `npm test` from a source archive without `.git` skips the `npm pack` test instead of failing.
- An HTTP URL with `user:pass@` now works. The credentials are sent as an `Authorization: Basic` header and redacted, and `--bearer` or an `Authorization` `--header` takes precedence. Before, every request failed with "Request cannot be constructed from a URL that includes credentials".
- `server/discover`, the auth-probe trigger and the auth probe now follow a same-host redirect of the preflight (`/mcp` -> `/mcp/`). A dual-era or modern server behind such a redirect is no longer marked legacy, and a 401 behind the redirect starts the auth probe.
- TLS certificate checks on the MCP host and on the authorization-server hosts now obey `--timeout` (capped at 10 s) and stop at the `--max-duration` deadline without retrying.
- on legacy HTTP+SSE servers, `transport.timings` now holds the time from each request to its result, which arrives on the GET stream.
- the modern (2026-07-28) wire probes read response bodies under the probes' 256 KB / 10 s cap, so a server that keeps an SSE stream open costs at most 10 s per probe.
- APPS-014 no longer reports "never calls connect()" for a UI resource whose HTML was cut at the 2 MB cap.
- INJ, DATA, POL and TOOL findings on a prompt name the prompt (prompt "<name>" description / argument <arg> description).
- `--verbose` prints control and format characters in the `[http]` trace and the `[stdio stderr]` tail as `\u{..}`, so a server cannot move the cursor, recolour or overwrite lines in a terminal or CI log.
- SRV-010 measures latency until the result arrived (the body, or the matching event on a streamed response), not until the response headers, and on legacy HTTP+SSE servers uses the request-to-result timings; before, every SSE answer looked like about 1 ms.

#### Severity lowered / false positives fixed

- A 401 without any OAuth discovery is one error (AUTH-004); AUTH-002 and the AUTH-013 ChatGPT note are info pointing to it.
- AUTH-017 is a Claude error only when most latency samples exceed 10 s; a single slow sample is a warning.
- In local mode, an untrusted certificate on a local authorization server is a "Deploy-time check" info in AUTH-010 and AUTH-007.
- SRV-006: a cross-host redirect only on GET is a warning; a redirect of the POST handshake stays a Claude error.
- SPEC-011 reports a rejected `server/discover` (-32020, -32021, -32022) as info with its HTTP status, code and `data.supported`, instead of an error saying the result is not an object.
- INJ-003: a pseudo-tag the text names as an XML or HTML element ("the `<Secret>` element of the response") is info instead of a warning.
- DATA-001: a bare `transcript` parameter (meeting, call or video transcription tools) is a warning instead of an error and a boolean `transcript` flag is not reported, while `chat_transcript` and `conversation_transcript` stay errors.
- A missing `initialize.serverInfo` is reported once, by SRV-013 (no longer also by SPEC-001), and on modern-only servers the GET status and session use are reported once, by SPEC-015 (no longer also by SPEC-005 and SPEC-006).
- AUTH-007 no longer repeats AUTH-006 for an issuer that is not a URL, and AUTH-008 says the metadata has no `issuer` instead of printing `undefined`.
- AUTH-012 gives one Claude warning for CIMD without `"none"` and without DCR, instead of two contradictory ones.
- AUTH-020 no longer treats a login page that carries `redirect_uri` in a hidden input as a rejected redirect URI, so a correct authorization server is no longer BLOCKED for Claude with `--active-auth`.
- An unquoted `resource_metadata=https://…` in `WWW-Authenticate` is read whole, as MCP SDK clients do, so the Protected Resource Metadata it names is found.
- The auth probe reads the challenge from the 401 the credentials got when the unauthenticated request got a 403 without `WWW-Authenticate`, so false AUTH-002, AUTH-004 and AUTH-013 errors no longer appear.
- AUTH-003, AUTH-015 and AUTH-016 read `scope=`, `error=` and `resource_metadata` from DPoP challenges.
- SPEC-016 no longer applies the 2026-07-28 error-code range policy to legacy servers answering the discover probe.
- A same-host redirect of the entered URL (such as `/mcp` → `/mcp/`) no longer produces false SPEC-005 and SPEC-007 findings or hides SRV-008: the protocol probes follow it as the SDK client does, and SRV-006 still reports the redirect.
- SPEC-005 no longer reports `GET returned 409` on servers that allow one SSE stream per session (such as the TypeScript SDK with sessions): the GET observation comes from the stream the client already opened.
- SRV-015 no longer reads "audio sampling rate" or "statistical sampling" as MCP sampling.
- The input caps no longer cut names, URIs, regex patterns and other schema syntax at 16 KB, which caused false TOOL-003 duplicates, TOOL-017 "does not compile" errors, a false APPS-019 and skipped APPS checks for long UI URIs.
- TOOL-017 no longer reports a valid schema as not compiling when its `$schema` uses the other URL scheme (`https://json-schema.org/draft-07/schema#`), and RT-006 validates `structuredContent` against such schemas instead of skipping them.
- TOOL-023, TOOL-025 and TOOL-026 resolve local `$ref` parameters, so a method enum kept in `$defs` yields TOOL-023's mixed-methods error and an enum behind `$ref` is no longer a "free-form" parameter.
- TOOL-026 no longer warns about the text field of `create_issue`, `send_email` or `post_message` tools: `body`, `payload` and `request_body` count as a raw request only next to a method, URL, endpoint or headers parameter, or as a free-form object.
- TOOL-004 no longer flags names such as `get_top_stories`, `set_preferred_language` or `get_official_rate`: top, official, preferred and leading count only when they rate the tool itself.
- TOOL-006 no longer reports "no title" when an empty top-level `title` sits next to a set `annotations.title`, and names a non-string title as such.
- TOOL-018 no longer calls a tool parameterless when its schema admits keys through `patternProperties`, `propertyNames`, `unevaluatedProperties`, `dependentSchemas` or a schema-valued `additionalProperties`.
- TOOL-021 says "a property without a type" instead of "a undefined property", and an `x-mcp-header` on a `$ref` to a string, integer or boolean is no longer an error.
- TOOL-031 no longer reports "lacks a required string id" for a profile tool whose `outputSchema` is a root `$ref` into `$defs`.
- TOOL-019 no longer reports a `$ref` to an embedded resource with its own `$id` (for example `urn:acme:addr` in `$defs`) as pointing outside the document.
- TOOL-014 and TOOL-027 classify names like `search_and_replace` and `get_or_create` by their joined write verb, so correctly hinted tools no longer get "read verb "search" but destructiveHint: true" or "collection tool".
- TOOL-014 no longer ignores the rest of a sentence after "like" ("works like a scratchpad and deletes notes").
- TOOL-008 no longer calls full Chinese, Japanese or Thai descriptions "only 1 words".
- RT-002 no longer reports "wrong-type argument returned a success result" for parameters with a type union, no type, or only `anyOf`/`oneOf`/`$ref`: the wrong-type value is taken from outside every allowed type, and the call is skipped when no such value exists.
- RT-010 no longer reports keys that the tool's `outputSchema` declares (`logs` of a `get_logs` tool) as leaked internals.
- INJ-001: emoji ZWJ sequences with a variation selector or skin-tone modifier (❤️‍🔥, 👩🏽‍💻, 🏳️‍🌈) are no longer reported as invisible characters.
- INJ-002: unit symbols such as μs, kΩ, ΔT and μg are no longer reported as homoglyphs; only Greek letters that look Latin count.
- INJ-004: percent-encoded non-Latin words in URL examples (Russian, Japanese) are no longer reported as encoded payloads.
- INJ-005: "Do not show user avatars …" and "You are now connected …" are no longer reported as hiding behavior or a persona switch.
- INJ-006 and RT-011: output-format wording ("rather than the default full web page") and value comparisons ("better than the given threshold", "superior to 0.8") are no longer reported as steering.
- INJ-007 and RT-011: "Use this app to …", "Use our app" and a first-party server naming its own brand ("the Slack connector" from the Slack server) are no longer reported as coercing calls.
- INJ-008: "Use this tool for any question about billing" is no longer reported as overly broad triggering.
- INJ-009: "Follow the setup instructions in the README" and "Load rules from a YAML file" are no longer reported as pulling instructions from external sources; the source must be fetched or returned content.
- DATA-001: "send all messages matching the filter" in messaging tools is no longer read as a request for the conversation; `all` needs a chat or conversation qualifier.
- DATA-002: reading VM, GPU, container or knowledge-graph memory is no longer reported as reading Claude's memory; `memory` needs Claude, the assistant, the host or the chat as its owner.
- DATA-005: wallet, e-mail and IP addresses (by description or `format`) and a boolean `long` flag are no longer reported as a precise location.
- POL-001: `get_bestsellers`, `list_stakeholders`, `send_email` and similar names are no longer reported as money transfers; transfer verbs are matched as whole name tokens, and send, buy and sell only next to a money word in the name.
- POL-002: `create_article`, `edit_clipboard`, `edit_voicemail_greeting` and `make_artifact` are no longer reported as AI media generation.
- POL-004 no longer reports stylesheets, icons or `<base>` hrefs (for example `/css/pricing.css`) as upsell links; only `<a>` and `<area>` links count.
- APPS-007 no longer reports a `new URL("https://…")` target as an undeclared resource origin when the host is declared in `connectDomains`, and a CSP entry without a scheme gives one APPS-006 finding instead of also making APPS-007 report the origin as undeclared.
- When `resources/read` returns the widget under a different URI (for example a cache-busting `?v=2`), the HTML and CSP rules check that item instead of reporting false "no CSP declared" and "no widget domain" errors; APPS-001 still reports the URI mismatch.
- APPS-006 reports a CSP entry repeated in `_meta.ui.csp` and `openai/widgetCSP` once, not twice.
- APPS-003 accepts a quoted MIME parameter, `text/html; profile="mcp-app"`.
- APPS-012 recognizes the shared ChatGPT sandbox domain in any letter case.
- APPS-015 no longer flags dialogs mentioned in comments, the widget's own `prompt`, `confirm` or `alert` functions, or clipboard writes when the `clipboardWrite` permission is declared.
- APPS-016 no longer takes `data-alt` for alt text.
- APPS-019 no longer blames the UI extension for a tool that is also missing from a fresh full-capability connection.

### Security

- Text and markdown reports show control, bidi and zero-width characters from the server (ESC, CR, LF, BEL, U+202E, …) as `\u{..}`, so a server name, tool name or message can no longer recolour or erase terminal output, add a hyperlink, reorder text, or start a line the GitHub runner reads as a workflow command.
- Markdown reports escape `*`, `_`, `~` and `$` in server text, so a server name or message cannot render as bold, italic, struck-through or math.
- A `Cookie` header is redacted pair by pair and a session-like cookie value on its own, and a `Basic` credential also by its decoded `user:pass` and password, so a server that echoes a session cookie or the plain password no longer leaks it into the report.
- Recorded HTTP exchange URLs mask known-format tokens in query values, path segments and fragments under any parameter name, as displayed URLs already did.
- Response bodies the MCP SDK reads (legacy Streamable HTTP and HTTP+SSE) are capped at 64 MiB, per event on SSE streams, as the 2026-07-28 client already was, and each listing at 64 MiB over all its pages, so a hostile server can no longer exhaust the linter's memory.
- A stdio server that floods stdout no longer crashes the check with a JavaScript heap out-of-memory error: only the first transport errors and the first 50 stray stdout lines are kept, with their counts.
- `--active` calls a tool name only when every `tools/list` entry with that name is read-only and non-destructive, and calls it once, so a duplicate destructive entry is never reached.

## [0.1.0] - 2026-10-25

First public release.

### Added

- Rule catalog dated 2026-10-22: automated rules (SRV, SPEC, TOOL, INJ, DATA, POL, APPS, AUTH, RT) and manual checklist items (MAN), each linked to its public source.
- Checks remote Streamable HTTP, legacy HTTP+SSE and stdio servers, including OAuth discovery probes and opt-in runtime checks (`--active`, `--active-auth`).
- Text, JSON, Markdown and SARIF reports with per-platform verdicts for the Claude connector directory and ChatGPT plugins.
- `npm pack` and `npm publish` build `dist/` themselves (`prepack`), so a package made from a clean clone ships a working `mcp-review-check` binary.
- CI on Node 20.19, 22 and 24 on Linux, macOS and Windows (build, typecheck of sources and tests, tests, a packed-tarball smoke run), a release workflow that publishes a version tag to npm with provenance through trusted publishing (OIDC), and Dependabot updates for npm and GitHub Actions. The release builds, tests and packs in a job without write permissions; only the job that publishes the packed tarball gets `id-token: write` and only the one that creates the GitHub release gets `contents: write`, neither installs dependencies or runs tests, and npm is installed at an exact version. Every action is pinned to a commit SHA, `actions/checkout` keeps no token, and every job has `timeout-minutes`.
- A stability policy in the README.
- `--stdio -- <command> [args...]` passes the server command verbatim, without quoting rules.
- JSON reports carry `schemaVersion` (1) and `tool.catalogAgeDays`.
- A check run warns on stderr when the rule catalog is more than 90 days old.
- Secret redaction for stdio as well as HTTP: one redactor per run scrubs every report format and the `--verbose` output of `--bearer`, `--header` and `--env` values, URL credentials, and stdio arguments after secret-looking flags, kebab-case or camelCase (`--api-key X`, `--accessToken X`, `--token=X`, `API_KEY=X`, `Authorization: Bearer X`), including where the server echoes them on stdout, on stderr or in its tool metadata (also when an input cap, the trace snippet, a connection error message or the stderr tail cuts through the echo: values are masked before any cut). Usage errors no longer repeat option values.
- Redaction recognizes a secret sign in any segment of a stdio flag, `KEY=` or URL query parameter name (`--auth-header`, `--api-key-value`, `?api-key=`, `?credential=`, `?client_secret=`), but not names that point to a secret (`--token-file`, `--key-id`); it also masks a query value as written (`+`, lowercase `%2f`), masks the `rerun:` line by position whatever the value length, hides a URL password that contains `@` in usage errors, and handles server data nested thousands of levels deep instead of crashing. `--list-rules` followed by something that is not a rule ID prefix (a URL, a path) lists the whole catalog without repeating it.
- Redaction also recognizes a secret sign glued to the word before it (`--authtoken`, `--apitoken=`, `--secretkey`, `?authtoken=`, `GITHUBTOKEN=`) and secret header names in stdio arguments (`X-Auth: …`); the "not an MCP endpoint" diagnosis shows the URL with secret query values and `user:pass@` hidden; `explain` with something that is not a rule ID does not repeat it; a usage error hides a URL password that contains `/`, `?` or `#`. A secret value that matches a report field name (`--env LOG_LEVEL=error`, `--bearer findings`) no longer renames that field, hides a severity or breaks the run: keys are masked only inside data the server sent, and the report's own values (severities, platforms, verdicts) are kept.
- Connection diagnostics: DNS (NXDOMAIN), refused, timed-out and TLS-certificate failures are named, and a URL that answers 404/405 or an HTML page is reported as "not an MCP endpoint" with a suggested URL (`<url>/mcp`, or `/mcp` instead of `/sse`). A URL without a scheme is rejected (exit 2) with a `https://` suggestion (`http://` for localhost).
- JSON reports gain `coverage.diagnosis` on a failed connect.
- The linter declares the MCP Apps client capability (`io.modelcontextprotocol/ui`) on every connection (SDK handshake, raw `initialize` probes, 2026-07-28 `_meta`), so UI tools registered with the ext-apps `getUiCapability` pattern are checked by the APPS rules. When a tool links a UI, one more connection without the capability lists the tools a text-only host sees.
- Regression fixtures frozen from public servers' listings (`test/fixtures/real/`, refreshed with `scripts/capture-real.mjs`) guard the heuristic rules against known false positives and against new warnings compared with the baseline findings.
- `--max-duration <ms>`: an overall deadline; the report covers what ran and names the phase where it stopped (text, markdown, JSON `limits.stopped`). Without a handshake by then the run exits 3 with `Result: FAIL (could not connect)`; after it, the run also exits 3, whatever `--fail-on` and the findings so far, the verdicts read `INCOMPLETE`, JSON `coverage.toolLevel` is `stopped`, and the `Result:` line in text, markdown, the job summary and the `--output` summary line reads `INCOMPLETE (stopped at --max-duration during <phase>)`, never `PASS`. On exit 3 JSON `summary.failed` is `true`. The stdio servers the run started, a fresh connection's too, are ended before the CLI exits (SIGTERM, then SIGKILL within a bounded wait), also when they ignore stdin EOF.
- The text report prints a ready JSON fragment (title and annotation hints) for each tool that lacks them, and text and markdown show "N root causes" next to the score.
- `--quiet` (text only): just the error and warning findings, the Score and Result lines and the disclaimer. `--checklist` (text only) prints the manual checklist in full.
- Automatic local mode: besides `localhost`, a host without a dot or one whose every address is non-public (public DNS and the system resolver, so `/etc/hosts` and container names count) is checked in local mode. `--local` and `--no-local` force it on or off (`--no-local` also for `--stdio`). The local-mode banner names the rules made informational and goes to stderr with `--format json` and `sarif`. In local mode the AUTH rules accept plain-http OAuth endpoints on any local host (loopback, a non-public IP, a name without a dot, or the MCP server's own host), not only on loopback.
- `explain <RULE-ID>` prints a rule's severity per directory, rationale, sources and fix, and the `--ignore` hint (unknown ID: exit 2). `--list-rules` takes `--format json` or `markdown` and an ID prefix (`--list-rules TOOL`), and with `--format sarif` prints the text catalog with a warning on stderr (exit 0); `--list-rules --verbose`, the `--verbose` text report and the markdown report ("Why these rules") show each rule's rationale. The rule table in `docs/RULES.md` and `--list-rules --format markdown` come from one generator.
- `--ignore` with an ID that is neither a rule nor a manual item exits 2 instead of being silently accepted. An unknown option suggests the closest one ("did you mean --format?") without repeating its value, and `--help` has examples.
- GitHub Actions mode: with `GITHUB_ACTIONS=true`, findings are printed as `::error` and `::warning` annotations on stderr at their severity for the `--target` directories, exit 3 as one `::error` with its cause (could not connect, stopped by `--max-duration`, an unexpected failure), and the markdown report is appended to `$GITHUB_STEP_SUMMARY` when it is set (stdout stays the report). `FORCE_COLOR` colours the text report without a TTY. The markdown report has an Evidence column and a `rerun: npx mcp-review-check …` line with secrets redacted.
- README: the purpose and the `npx` command in the first lines; a token recipe for OAuth-protected servers, CI recipes (a stdio server, a preview deployment URL), a Docker Compose recipe, Privacy, FAQ, the environment variables (including `MCP_REVIEW_CHECK_NO_CTA`) and a dated comparison with other MCP tools. The rule table moved to the generated `docs/RULES.md`; `npm run readme:rules` writes it and the catalog date in the README, including the example report header.
- `SECURITY.md` (what the tool sends, the threat model, known redaction gaps and a private reporting channel), `CONTRIBUTING.md` (how to add a rule and regenerate `docs/RULES.md`) and issue forms for a false positive (asks for the JSON report), a rejection despite a passing check, and a bug. The design document moved from `SPEC.md` to `docs/design/spec.md`, marked as possibly differing from the implementation.

#### Rules added

- APPS-019 (spec, chatgpt: warning): a UI-linked tool must stay listed for clients that do not declare `io.modelcontextprotocol/ui` (text-only fallback).

#### Severity raised

- TOOL-007 (missing tool description) is an error for Claude as well as ChatGPT (Software Directory Policy: tools must have descriptions).
- SRV-001 checks the MCP server's own TLS certificate, also when the server does not answer 401 (it was only reported by AUTH-010 on OAuth servers): an untrusted certificate is an error. AUTH-010 now covers the authorization server hosts only.
- AUTH-001 recognizes a credential in the server URL query by the same names redaction masks (`?api-key=`, `?client_secret=`, `?credential=`, `?session=`, `?cookie=`, `?signature=`, `?pass=`, `?pwd=`, `?dsn=`, camelCase and glued forms such as `?exaApiKey=`), not only nine exact names; it is an error as before, and names that point to a secret (`sessionId`, `key_id`, `token_type`) still do not count.

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
- INJ-008: "for every query" counts only after a call verb in the same clause ("use this tool for every request", "should be used for every query"), so a limit such as "Returns at most 20 matches for any query", a rate limit or a cache note is no longer flagged.

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
- AUTH-010 names a plain network failure of an authorization server host as such ("hostname auth.example.com does not resolve (ENOTFOUND); TLS not checked", with a DNS fix) instead of "TLS handshake failed"; SRV-008 calls a local server with a foreign Origin accepted "local server (loopback, private address or dotless name)" instead of "loopback server" (still a spec error). Severities are unchanged.

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
- The call to action is the maintainer's e-mail address. It appears only in text and markdown, above the disclaimer, and only when a directory verdict is `BLOCKED`, the server is on the legacy era or it requires auth; `MCP_REVIEW_CHECK_NO_CTA=1` hides it. SARIF never carries it (neither as `informationUri` nor as `properties.contact`); JSON has it in `contact` as `{text, url}` with a `mailto:` URL. The contact may be an absolute http(s) URL or a `mailto:` with one plain address (no query, no second address); anything else leaves the call to action out and JSON `contact` `null`.
- SRV-001 reports a certificate issued for another name (`ERR_TLS_CERT_ALTNAME_INVALID`) and the other `ERR_TLS_*` certificate codes as an untrusted certificate (only network errors such as `ENOTFOUND` are left to SRV-003 and SRV-004), and a TLS protocol failure without blaming the certificate: a non-TLS answer (`EPROTO`, `ERR_SSL_WRONG_VERSION_NUMBER`, `ERR_SSL_PACKET_LENGTH_TOO_LONG`) as "not a TLS endpoint?", another `ERR_SSL_*` code as a TLS version or cipher mismatch. A run stopped by `--max-duration` after the handshake reads `INCOMPLETE` even when errors were found before the stop. An HTML page served with status 200 is "not an MCP endpoint" without a made-up `HTTP -1` status. INJ-006 and RT-011 still flag disparaging wording ("better than …") next to conditional "always use this tool when …" wording in the same text.
- A run stopped by `--max-duration` during `--active` tool calls stays stopped (`INCOMPLETE`, `limits.stopped`) when a stdio server takes a while to exit: the calls the deadline cut off are no longer reported as RT-005 "Not connected". The 16 KB input cap also reaches strings nested deeper than 30 schema levels, so they are truncated and reported like top-level ones.
- Redaction keeps the report's own values (severities, verdicts, `kind`, `role`, …) only outside what the server sent: under the server's capabilities, its `initialize` and `server/discover` results and resource reads, a value under such a field is masked like any other server text (field names there stay).
- SARIF: `artifactLocation.uri` is a repository-relative path, `.mcp-review-check` by default or set with the new `--sarif-location <path>` (a scheme, an absolute path or `..` is a usage error that does not repeat the value), instead of the server URL or a `stdio:` URI; the server URL or command moves to `runs[0].properties.target`, redacted like the rest of the report. Every result carries `partialFingerprints` (rule, tool or resource, path), the run carries `automationDetails.id`, and `informationUri` is the repository URL.
- `SECURITY.md` lists the values redaction never treats as secrets, as the README does: values shorter than 4 characters, `true`, `false`, `yes`, `no`, `on`, `off`, `null`, `undefined`, `none` and numbers with up to 6 digits before an optional decimal part.
- The CLI exits only after stdout and stderr are fully written: through a pipe (a CI log, `2>&1 | tee`), stderr over 64 KB was cut at exit, losing `::error`/`::warning` annotations and the `--output` summary line.
- A stdio server that never answers `initialize` and ignores stdin EOF, on the main connection or a fresh connection's tools re-list, is ended before the CLI exits (SIGTERM, then SIGKILL within a bounded wait), also without `--max-duration`; it was left running after the CLI exited.
- A stdio server started through a wrapper (`npx`, a `.cmd` or `.bat` file, `sh -c`) is ended with everything it started: on Windows the CLI ends the process tree (`taskkill /T /F`) before the wrapper, on Linux and macOS the server runs as the leader of its own process group and the CLI ends the group. Only the wrapper was ended, so the server itself outlived the CLI, with `--max-duration` and without. Because the group no longer gets the terminal's Ctrl+C, the CLI ends it on SIGINT, SIGTERM and SIGHUP and then exits by that signal.
- `--max-duration` with `runCli` called in process (a library or a test): once the deadline passes, the run sends the server no further HTTP request and cancels its probes still in flight; the abandoned run went on sending wire probes and new `initialize` requests for up to several `--timeout` periods after `runCli` had returned.
- An `--env` value that is a plain word (`--env FORMAT=text`, `MODE=title`, `X=object`) no longer changes findings, severities or the exit code: before the rules, what the server sent is masked with the strong values only (`--bearer`, `--header` values, `--env` values under a secret-looking name, URL credentials, arguments after a secret-looking flag), the other `--env` values in the finished report and every output. A clean server got false APPS-003, TOOL-006 or TOOL-016 errors and exit 1. Protocol and schema words (`object`, `string`, `title`, `text`, `image`, `json`, …) are never treated as secrets.
- Redaction also covers secrets without a flag sign: a token in a known format (`sk-…`, `sk_live_…`, `ghp_…`, `github_pat_…`, `glpat-…`, `xox…-`, `AKIA…`, `AIza…`, `npm_…`, `hf_…`, a JWT) as a bare stdio argument, a URL path segment or a URL query value under any name; the URL username (`https://TOKEN@host`, also in `user:pass@`), which the connect error quoted; the password inside an `--env` URL and the token after `Bearer` in an `--env` value, which a server could echo apart from the whole value; and secret-named parameters in the URL fragment (`#access_token=…`). They were shown in the target label, `server.command` and `server.url`, the `rerun:` line, SARIF `run.properties.target`, the connect error and stdio stderr. These values are masked before the rules, like the other strong values. A secret of another kind without a flag sign (a password, a random hex key) is still not recognized.
- Redaction masks before every cut: the exported `stderrSummary` and `cleanErrorMessage` require the run's redactor and mask first, so a 200-character cut no longer leaves a secret's prefix; a stdio server's stderr and non-JSON stdout are decoded across chunks, so an echo split inside a UTF-8 character between two writes is masked; the gate texts (`summary.gate.reason`, `notGated`) are no longer masked by value (`--env LOG_LEVEL=error` turned "2 errors" into "2 «redacted»s"); and a `__proto__` key in server data stays a key instead of being dropped.
- The markdown report and the job summary escape server text (the server name, tool, resource and parameter names, finding messages, the coverage and limits notices, the target and the revision): a server's `[text](url)`, image, HTML tag or `@mention` is shown as written instead of becoming a link, an image, markup or a GitHub mention (`@` is followed by a zero-width space). Evidence and the `rerun:` line are code spans whose fence is longer than any backtick run inside, so backticks in server text can no longer end the span and let the rest render.
- Output details: `--ignore MAN-xxx` hides that item from the manual checklist (JSON `manual`, markdown, `--checklist`, the item count); the root-cause count next to the score is counted on the score's basis, every platform, so `--target claude` no longer shows "96/100 · 0 root causes"; with `--quiet` the Score line leaves out the info count it does not show; `EHOSTUNREACH`, `ENETUNREACH`, `EHOSTDOWN` and `EADDRNOTAVAIL` read "no route to <host>:<port>" with a hint (VPN, firewall, macOS Local Network access) instead of "fetch failed"; a connect error for a response with an unexpected content type no longer starts with a made-up "HTTP -1:"; and a missing or ambiguous option value is one line ("error: --timeout needs a value") instead of Node's multi-line text, still without the value.
- Windows details of a stdio check: `--env Path=…` (any letter case) replaces the inherited `PATH` instead of being dropped by Node; `--tool-args` in UTF-8 with a BOM or in UTF-16LE (what Windows PowerShell 5.1 and older Notepad write) is read instead of failing as "not valid JSON" (exit 2); the markdown `rerun:` line on Windows quotes with double quotes, for cmd.exe. In `--stdio "<command>"` a backslash inside double quotes escapes only `"`, by the Windows argv rule and on every OS: `"\\host\My Share\s.js"` and `"C:\srv\\"` work, and `\\` and `\$` inside double quotes now stay as written on Linux and macOS too. The README and SECURITY.md name the variables a stdio server inherits (`HOME, LOGNAME, PATH, SHELL, TERM, USER`; a Windows list) and say to pass the rest, such as `TMPDIR` on macOS, with `--env`.
- A URL username, or a part of an `--env` value under a plain name, that is a plain word no longer changes findings (`--env DATABASE_URL=postgres://postgres:postgres@db/app` turned "Query the postgres database" into a false TOOL-026): such a part (the URL username, password and query values, the token after `Bearer`), and the username of any URL, is masked before the rules only when it looks like a token (a known format, or 16 or more characters with letters and digits), otherwise in the finished report and every output, like the other plain `--env` values. The markdown report and the job summary also escape the server's protocol version in the Transport line.
- Redaction before the cuts (the 200-character start-up error line, the stderr tail, a rule's snippet) no longer misses a secret on Windows that is secret-looking only by its camelCase name (`--env signingKey=…`): the name counts as you typed it, not as upper-cased for the server. Also masked before the cuts: a whole `--env` value under a plain name that looks like a token (`--env GITHUB_PAT=ghp_…`) and a URL password in `--env` in its decoded form when its written form looks like a token (`Pa%24%24word-…`). A known-format token after `=` or `Name: ` in a stdio argument with a plain name (`--upstream=ghp_…`, `UPSTREAM=sk-…`, `"X-Upstream: xoxb-…"`) is masked in every output.
- The markdown report and the job summary also keep a bare URL in server text from becoming a link (`https://` and `www.` get a zero-width space inside, so GitHub does not autolink them), end no table row, code span or `rerun:` line at a lone carriage return, and give every `@` in server text a zero-width space, also after `.`, `-` or `_` and in an e-mail address or `mailto:`, so GitHub reads no `@mention` and links no address; only the AUTH-012 contact address, the report's own text, is shown as written.
- Ending stdio servers: a stdio server that ignores stdin EOF is ended also when the check itself fails after the handshake (exit 3 with `fatal:`, for example on a tool name that is not a string); it was left running. Ctrl+\\ (SIGQUIT) ends the server's process group like Ctrl+C, and a second Ctrl+C while the CLI waits for a server that ignores SIGTERM kills the group at once instead of leaving it running. On Windows, where a process cannot end by a signal, the CLI then exits with 128 + the signal number (130 for Ctrl+C) instead of signalling itself, which Windows turns into exit 1, the threshold code (to be confirmed on a Windows runner). Known limitations on Linux and macOS, where the server runs in a session of its own: the CLI's own SIGKILL (`kill -9`, a timeout or job cancellation that kills its group) cannot be caught and does not end the server's group; and a `--stdio` wrapper that prompts on the terminal (ssh asking for a password or to confirm a new host key, sudo) cannot prompt and fails, since the server has no controlling terminal.
- AUTH-010 gives the DNS fix ("Publish public DNS records …") only when an authorization server host does not resolve; for a refused connection, no route or another network code the fix is that cause's own hint ("Nothing is listening there: …", "Check the address, VPN and firewall …"). The README says the Windows `rerun:` line is quoted for cmd.exe, and that in PowerShell an argument with `"`, `$` or a backtick needs quoting again.
- Redaction also masks a token in a known format inside a stdio argument or an `--env` value, wherever it stands as a word of its own: in a JSON value (`--config '{"apiKey":"sk-…"}'`), a comma list (`--keys=ghp_…,ghp_…`) or after a space; it was shown in the target label, `server.command`, the `rerun:` line, SRV-018 and stdio stderr, and the server's echo of it was not masked. After Ctrl+C (or SIGTERM, SIGHUP, SIGQUIT) a stdio server the check starts is killed at once, so a fresh connection begun after the signal no longer outlives the CLI. The README says that on Windows a `rerun:` argument that holds both `"` and one of `& | < > ^` may split in cmd.exe and needs checking before you run the pasted line.

[Unreleased]: https://github.com/alisaosipova/mcp-review-check/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/alisaosipova/mcp-review-check/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/alisaosipova/mcp-review-check/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/alisaosipova/mcp-review-check/releases/tag/v0.1.0
