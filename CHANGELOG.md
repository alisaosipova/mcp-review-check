# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [semantic versioning](https://semver.org/) as described in the README's [Stability policy](README.md#stability-policy): while the version is 0.x, new rules and higher severities ship only in minor releases, and patch releases never make a passing run fail.

Each release notes the rule catalog date and groups rule changes under **Rules added**, **Severity raised**, **Severity lowered / false positives fixed** and **Rules retired** (retired IDs are never reused).

## [Unreleased]

Nothing yet.

## [1.2.0] - 2026-11-06

Rule catalog dated 2026-11-02, 180 rules, no rule added. This release fixes the 88 confirmed findings of review round 4 that the 1.x policy allows before the planned feature releases ([docs/review/2026-11-05](docs/review/2026-11-05/FINDINGS.md), [progress](docs/review/2026-11-05/PROGRESS.md)). It is a minor release, not a patch, for three reasons:
- some failing runs now read FAIL in every format (`--fail-on-drift`);
- a crashed rule now shows as an internal error;
- the engine has new needs (`handshake`, `url`, `transport`), so some rules now report skipped where 1.1.0 counted them as passed.

All three high findings are fixed:
- A06-01: the MCP files `plugin.json` names are read. Their findings stay at info until 1.3.0.
- A09-01: the importmap scan is linear.
- A09-02: the `pyproject.toml` scan is linear.

### Added

- JSON `summary.internalErrors` (since 1.2): how many rules threw; absent when none (A13-02).
- JSON `coverage.diagnosis.kind` can be `no-answer`: the server accepted the connection but answered neither the unauthenticated `initialize` nor the handshake; the summary names host:port and the wait (A10-03).
- `proxyRouteLine` (`src/proxy.ts`) builds the `--verbose` route line, `proxy: <proxy> via <variable> (SOCKS5 | CONNECT tunnel | plain forwarding; NO_PROXY: ...)`, with credentials removed (I-A02-3).
- The `not used from <file>` note names the config file's `url` or `stdio` key when the command line gives the server (I-A01-2).
- Config, `--baseline` and `--tool-args` files may be UTF-16BE with a BOM (I-A01-5).
- "Did you mean" for a misspelt `--format`, `--target` or `--fail-on` value (`--format jsn`: `did you mean json?`) (I-A10-3).
- Each Docker image pushed to ghcr.io gets a build provenance attestation for the tested digest (`actions/attest-build-provenance`, stored with the image); check it with `gh attestation verify oci://ghcr.io/alisaosipova/mcp-review-check:<version> --owner alisaosipova` (I-A08-2).
- `scripts/check-tree.mjs <package dir>` checks an installed mcp-review-check against its npm-shrinkwrap.json (missing, other-version and extra packages, hoisted layouts included); the CI pack smoke and the Docker smoke run it on every platform (I-A08-3).
- Dependabot watches the Dockerfile's `node:22-alpine` digest (`package-ecosystem: docker`, Node majors ignored) (I-A08-1).

### Fixed

- A stdio message that both spends the snapshot budget and exceeds the 64 MB read buffer is reported the same way on Linux, macOS and Windows (the budget stop): the budget is now charged before the line reader sees each stdout chunk, so the outcome no longer depends on the pipe chunk size.
- Tests: the cross-spawn spy no longer replaces the real launcher for the other stdio tests of the same file on Windows; the unwritable `--output` test uses a path under a file, which no OS can write (a directory at the drive root is writable on Windows runners).
- A `--fail-on-drift` failure (exit 1) no longer reads PASS: the Result line says `FAIL (--fail-on-drift)`, JSON `summary.failed` is true with `gate.reason` `tool definitions changed since baseline (--fail-on-drift)` or `tool definitions not compared (--fail-on-drift)`, JUnit has a failed `tool definitions since baseline` test case per suite and GitHub an `::error` naming the changed tools. The exit code is unchanged (A01-01).
- In a listing-only run a platform whose input was not given is `INCOMPLETE (not checked: no --openai-manifest)` (or `no --plugin-dir`) instead of NO AUTOMATED BLOCKERS; the exit code and `summary.failed` are unchanged (A10-02).
- JSON and SARIF write DEL, C1 controls (U+009B CSI, U+0085), format characters (bidi overrides) and U+2028/U+2029 from server text as `\uXXXX`, the same value to a parser (A07-03).
- SARIF `message.text` escapes `\`, `[` and `]`, also in BASE-001 drift results, so server text cannot become an embedded link (SARIF 2.1.0 3.11.6) (A07-07).
- A plain-name `--env` value such as `claude`, `chatgpt`, `stdio` or `json` is no longer masked: it broke the JSON `target` enum and the docs URLs (`https://«redacted».com/...`); a finding's catalog title and docs and the `--target` value are never masked (A07-04).
- A secret echoed with escapes is masked: lowercase or partial percent-encoding (Python `quote`), JSON `\uXXXX` and `\/`, `+` for a space, Node's `\x00`; one pattern per secret (A07-06, I-A07-7, A01-06 safety net).
- The JSON Schema accepts the `INTERNAL` rule ID of a rule that threw (A07-05).
- A baseline entry whose whole tool digest differs while every field digest matches (an edited baseline) is no longer a change with an empty `fields` list, which failed the schema's `minItems`; it is unchanged.
- With `--baseline`, text and markdown label the score `(all findings, N known)`, the counts `new` and a clean verdict `NO NEW AUTOMATED BLOCKERS`, also under `--diff-only`; the JSON and SARIF verdict values are unchanged (C-06).
- Text shows at most 10 FIX SNIPPETS lines and `+N more (--verbose for all)`; markdown groups repeated findings as text does (400 tools: 590 KB to under 50 KB) (A10-05).
- Text and markdown counts are pluralised (`1 error`), markdown verdict rows carry the platform's counts (`BLOCKED (1 error)`), and a listing-only header names the plugin (`Plugin acme-notes`) (I-A07-4, I-A07-5, I-A10-5).
- A response body is joined with one copy instead of two (I-A09-6).
- JUnit skips any rule with the `transport` need after a failed connect in the directory suites, not SRV-003 by ID.
- Session-ending DELETEs are no longer awaited one by one: each gets at most 1.5 s and they settle together at the end of the run, so a stateful server that never answers DELETE no longer adds 35 to 50 s to a run (A02-05).
- A stopped run's session DELETE follows a same-origin 307/308 (`/mcp` → `/mcp/`, at most two hops, never to a URL that adds userinfo), so the session behind the redirect is ended (A02-01).
- SOCKS5 proxy failures are diagnosed as the proxy's: rejected or missing credentials, and the proxy's refused, unreachable or not-allowed replies; proxy messages name the proxy kind and the variable that set it, and mention `CONNECT` only where the request is tunnelled (A02-02, I-A02-4).
- An initialize that times out reads `initialize got no answer within <ms> ms` (kind `timeout`, with the HTTP connect-cap hint) instead of `MCP error -32001: Request timed out`, over HTTP and stdio (A02-04).
- A 501 (or 405) to the handshake POST, as a static file server answers, is again `not an MCP endpoint` with the `<origin>/mcp` hint, instead of a server error (A10-01, a 1.0.1 regression).
- A server that accepts TCP and never answers fails in about one connect wait instead of four: the preflight is not retried after a timeout, and `server/discover` and the handshake then wait 2 s each (A10-03).
- The auth probe runs at most once per run: with `--active-auth` a token rejected on `tools/list` no longer registers a second DCR client that no notice named, and the metadata, TLS and timing requests are not repeated (A03-02).
- The `--active-auth` DCR notice is printed even when `--max-duration` stops the run after the registration (I-A03-6).
- stdio messages are read in linear time: a 62 MB `tools/list` is read in about a second instead of timing out, and a message bigger than the snapshot budget stops the run while it is being read (A09-05).
- A run that did not connect, was stopped by `--max-duration` or, with `--fail-on-incomplete`, was partial no longer overwrites the baseline through another output: `--json-output` or `--output` in `--format json` naming the `--baseline` or `--save-baseline` file is skipped with the same `not written` warning, and the "earlier baseline is kept" message is now true (A01-02). `--save-baseline` is no longer written by a partial check that exits 3 under `--fail-on-incomplete` (A01-03).
- A listing-only run with `--fail-on-drift` no longer always exits 1: on the command line it is a usage error (exit 2), from a config file it is not used, with a note; a listing-only baseline used for a server run is named as such (A01-04).
- The baseline pass for `«redacted»` subjects is linear (a glob match by `indexOf`, entries indexed by prefix and suffix): 10,000 entries took 73 s, a long tool name against a many-mark entry 28 s (A01-05).
- A NUL character in a config file string (an `env` value, a `stdio` argument, `bearer`, `cwd`) is a usage error that does not show the value, instead of a secret echoed in the report or an internal error (A01-06).
- A `--plugin-dir` / `--openai-manifest` warning on stderr can no longer start a GitHub workflow command or carry ESC: a manifest's `mcpServers` text is shown on one line with control characters escaped (A07-01).
- `--save-baseline .mcp-review-check/baseline.json`, the documented first step, works in a fresh repository: the parent folder of `--save-baseline`, `--json-output` and `--output` is created (A12-04).
- A config file's `sarifLocation` (or `toolArgs` without `--active`) no longer warns on every run in another format; only the option typed on the command line does (A12-08).
- `"--stdio node server.js"` passed as one argument says how to split it instead of "unknown option --stdio; did you mean --stdio?" (C-05).
- Tool fingerprints canonicalize each tool once and each snapshot is fingerprinted once per run, with the same digests (I-A09-5).
- A tool whose `name` is an object such as `{"toString":"x"}` no longer stops the run with `fatal:` and exit 3 and no report: tool names are turned into text by a total `safeStr()` (A13-01).
- A rule that throws is skipped with `internal error: <message>` and no longer counted as run; the report is then partial: the verdicts are those of a partial check (INCOMPLETE without errors), the score is null (`n/a (internal error: N rules threw)`) and JSON has `summary.internalErrors`. The INTERNAL finding stays at info; `coverage.toolLevel`, `summary.failed`, `--fail-on-incomplete` and the exit code are unchanged (A13-02).
- In an auth-required or token-rejected run SRV-011..015, SPEC-002, SPEC-008, SPEC-016..018, SPEC-020, SPEC-021, SPEC-023 and POL-005 are skipped with the auth reason when they find nothing, instead of counting as passed in JUnit, SARIF and `rulesRun`: they declare the new soft `handshake` need, so a finding made without a handshake (SPEC-016 on a 401's JSON-RPC error, SPEC-021 on an SSE-only server) is kept (A04-03, A13-03).
- On a connect failure, AUTH and era-dependent rules are skipped as `could not connect` (or the auth reason), not `server did not request auth` or `era unknown`; AUTH rules still run when the auth probe did (a 403 challenge without a handshake) (A04-06).
- SRV-003 is skipped with `stdio target` for a stdio server that started, instead of a passed "Streamable HTTP transport available" test (A10-06).
- `ignored[]` is sorted like `findings[]` (I-A13-5).
- `--list-rules --format json` and `explain` show the new needs `handshake`, `url` (was `http` for SRV-001, SRV-004, SRV-005, SRV-017, AUTH-001) and `transport` (SRV-003); the engine no longer keeps a list of URL-only rule IDs (I-A13-3). New self-tests check that every rule's needs cover the server data it reads and that no rule throws on hostile field shapes (I-A13-1, I-A13-2).
- The `<script type="importmap">` scan of UI HTML (APPS-007, APPS-013) is linear: 2 MB of unclosed importmap openers took about 85 s and ran past `--max-duration`; an opener inside an earlier map body is now read as script text, and a map with no `</script` is parsed once (A09-01).
- Every field of a `resources/read` content item is capped, not only `text` and `blob`: `uri` at ID_CAP, `mimeType` and `_meta` at TEXT_CAP, each cut listed in `limits.truncated`; the MIME normalization of APPS-003 splits a parameter on its first `=` instead of a regex that was quadratic on a long run of spaces (A09-03).
- A run stopped by `--max-duration` or the snapshot budget builds the INJ, POL and DATA corpus once, as a complete run does, instead of once per rule (A09-06).
- The UI resource view is built once per snapshot, with a linear lookup of the list entries and each content item decoded once, instead of once per APPS rule with a search of the resource list per linked URI (about 10 s per rule at 40,000 tools) (A09-07).
- Finding messages show a JSON pointer over 1024 characters as its first and last 60 characters and TOOL-009 and TOOL-036 messages are cut to 2 KB (the finding `path` is unchanged, as baselines match on it): deep schemas with long property names made reports many times the input size (A09-08).
- Optional parameters are read through their nullable wrapper (A05-05): pydantic `Optional[X]` and zod `.nullable()` emit `anyOf: [X, {type: "null"}]`, often with X a `$ref` into `$defs`. An `int | None` `history` or `memory` no longer gets a DATA-001 warning, and an Optional enum `url`, `command`, `method` or `sql` is no longer read as free-form by TOOL-015, TOOL-025, TOOL-023 and TOOL-026.
- DATA-001 skips an integer, number or boolean `context_window`, `system_prompt` or other strong name: a model-catalog filter on a minimum context window in tokens was a Claude and ChatGPT error (A05-06).
- INJ-001 no longer reports the England, Scotland and Wales flag emoji (U+1F3F4 with the tag spelling of `gbeng`, `gbsct`, `gbwls`) as tag characters; every other tag run is still an error (A05-07).
- INJ-001 no longer warns on ZWNJ between letters of a joining script (Arabic, Persian, Syriac, NKo, Mongolian, Mandaic), on ZWJ between letters of a Brahmic script (Devanagari, Malayalam and others), at most two per word, or on LRM/RLM/ALM next to a right-to-left letter; inside a Latin word, in another script or in a run they still warn (A05-08).
- INJ-002 accepts biomedical notation led by lowercase Greek: NF-κB, αSMA, γH2AX, αvβ3, αKG (A05-09). Greek letters that pass for Latin do not count, so `pαypal`, `ιOS` and `ρAYPAL` are still flagged.
- INJ-003 reads a `<name-word>` with no whitespace and no closing tag as a placeholder (A05-11): next to `/`, `.`, `:` or `=` (`https://<vault>.vault.azure.net/secrets/<secret-name>`, `--host=<admin-host>`) it is skipped, elsewhere it is reported at info instead of warning.
- APPS-007 and APPS-013 ignore tags, `@import` and CSS `url()` inside HTML comments: a commented-out `<script src>` was a ChatGPT error (A05-12). Comments are found as a browser finds them: not inside a tag's attribute values or a raw-text element (script, style, title, textarea, xmp, iframe, noembed, noframes, noscript, plaintext), ending at once on `<!-->`, otherwise at `-->` or `--!>`.
- TOOL-021 accepts a nullable primitive `x-mcp-header` parameter, `type: ["string", "null"]` or `anyOf: [{type: "string"}, {type: "null"}]` (A05-13). Decision: the 2026-07-28 schema-extension text (basic/transports/streamable-http, read 2026-11-05) limits the annotation to primitive types (integer, string, boolean) and does not forbid null; its own table says a `null` value makes the client omit the header. A `number`, a union of two primitives or a non-primitive is still an error.
- The note "matched with hidden characters folded" is added only when a folded character falls inside the match, and never names a variation selector on its own base (❤️): the bad-server fixture's INJ-003/005/006/008 findings and a description with a plain emoji no longer carry it (A10-04).
- The regex-complexity guard test also feeds importmap openers, MIME parameters and every `resources/read` item field, including `_meta`, and times each rule on its own (I-A09-3).
- The `pyproject.toml` table-header parse of LST-009 is linear: one 256 KB line of `[a` and spaces took about 27 s and a plugin folder with it ran past `--max-duration`; the result is the same as before (A09-02). The `.npmrc`-style package-source match no longer rescans every following blank line from each line start, and a `[index` table header ends at its line (both were quadratic too).
- `env -S` / `--split-string` in a server's argv is unwrapped on a stack, each word once, so 30,000 `-S` arguments no longer take seconds in LST-008 and LST-009 (A09-04).
- `--plugin-dir` reads the `.json` MCP configuration files that `plugin.json` names in `mcpServers` (a string or an array), as `./` paths inside the plugin folder; before, only the root `.mcp.json` was read and a server in such a file was not checked at all. In 1.1.x everything these files add, through any rule (LST-006, 007, 008, 009, 011 and LST-015), is reported at **info** with "(reported at rule severity from 1.3.0)", including a path that leaves the plugin folder or does not exist, so a run that passed on 1.1.0 still passes (A06-01, first half).
- `--plugin-dir` does not walk VCS folders (`.git`, `.hg`, `.svn`) at any depth, nor dependency and build-cache folders (`node_modules`, `.venv`, `venv`, `__pycache__`, `site-packages`, `.tox`, ...) that the plugin's root `.gitignore` lists: an ignored dependency's `.npmrc` was an LST-009 error and installed packages counted toward LST-013's 512 files. A committed dependency folder is still checked. LST-013 names the skipped folders at info (A06-06).
- A plugin folder is read with `opendir` only as far as the 10,000-entry cap needs, instead of reading and sorting a huge folder in full first (I-A06-7).
- The manual checklist keeps MAN-020 and MAN-021 whole when the package's mcp.json does not parse or names no server: it said "the rest is checked by LST-022" when LST-022 had checked nothing (A06-07).
- The `--verbose` [listing] dump redacts a one-string server `command` (`node server.js --api-key ... --password=...`, quoted values such as `--header "Authorization: Bearer ..."` included) like an argv, split as `--stdio` splits it, and the userinfo of a URL after `--flag=` or inside a string (A06-08).
- The listings guide says which files `--plugin-dir` reads, lists and skips (I-A06-8).
- `--active` on a 2026-07-28 server sends the `Mcp-Param-{Name}` headers for `x-mcp-header` parameters, so a conforming server no longer rejects the calls with `-32020` and RT-003 no longer reports a false positive; a tool whose `x-mcp-header` breaks TOOL-021 is not called there, as a Streamable HTTP client drops it (A03-01).
- `Mcp-Name` uses the spec's `=?base64?...?=` form (non-ASCII, control characters, edge whitespace, a sentinel look-alike) instead of percent-encoding, shared with `Mcp-Param-{Name}` (A03-03).
- The `--tool-args` "not used" warning names the real reason: `readOnlyHint`, `destructiveHint`, the write verb in the name, a duplicate name, the cap of 50 tools, or a `--max-duration` stop (A03-04).
- The `--active` name filter skips more write verbs (upsert, append, restore, migrate, unpublish, charge, sign, vote, follow, retweet, launch, scale, resize, mount, format, encrypt/decrypt, rotate, configure, store, attach/detach, broadcast, alert, escalate, acknowledge, resolve_incident and the like) and splits names on any non-alphanumeric character after NFKC folding (`read&delete`, a zero-width-space join) (I-A03-1).
- A `--max-duration` stop during the third clientInfo listing keeps the two finished variants for RT-012 (I-A03-3).
- The pre-commit hook can be installed. As `language: node`, pre-commit installed the repository as a global git dependency whose `prepack` build raced that install (`git dep preparation failed`, `ENOTEMPTY`; reproduced with pre-commit 4.7.0 and npm 11.20.0), so the hook never ran. Decision: the hook (same id) is now `language: system` with `entry: npx --yes mcp-review-check@<MAJOR.MINOR>`, the action's `version` default, so it runs the published package with its shrinkwrap and builds nothing. Rejected: `language: docker_image`, which cannot start a `--stdio` server on the host, the hook's main use; keeping `language: node` with the local npx recipe as the only working option. A CI job installs and runs the hook through pre-commit from the tested commit (A08-01).
- The Action rejects a `target` that is not an `http://` or `https://` URL (exit 2): a value such as `--stdio=<command>`, for example from deployment event data, was read as an option and started a command on the runner (A08-03, CWE-88). An empty `target` with `stdio` is unchanged.
- `--format`, `--output` or `--json-output` in the Action's `extra-args` no longer replace its SARIF file or JSON report: the action's own options now come after `extra-args` and win, and a `::warning` names the option and points at the `sarif-file` input. Not a usage error, so a workflow that passed keeps passing (A12-09).
- The CI pack smoke installs the tree the package ships: it extracts the tarball and runs `npm ci --omit=dev --ignore-scripts` in it, because `npm install <tarball>` ignores npm-shrinkwrap.json and re-resolves the ranges (A08-02).
- Docs: README and SECURITY.md describe 1.x (no moving `v1` ref, pin a tag or a commit SHA; only the latest 1.x minor gets security fixes, as a patch of that minor) instead of 0.x (A08-05, I-A08-6); the Action input table in docs/guide/ci.md is generated from action.yml (`node scripts/action-inputs.mjs --write`) and checked by the docs test (it said the `version` default was 1.0); `--plugin-dir` and `--openai-manifest` run listing-only without a target; both `--fail-on-drift` advice texts are quoted; the local-mode banner goes to stderr for junit too; the preflight is not retried after a timeout; the `--save-baseline` paragraph says when the earlier baseline is kept and that the folder is created (A12-06, A01-02, A12-04).
- The GitLab recipe fails on drift only in merge requests, so an intended tool change merged to the default branch becomes the new baseline instead of failing every default-branch job, and a manual `mcp-review-check-refresh` job re-saves the baseline (A12-07).
- AUTH-020 no longer reports "/authorize rejected redirect_uri" (Claude error) for a 400 that does not name the redirect: a 400 `invalid_client`, `unauthorized_client` or `invalid_request`, or any 400 when no DCR client was registered, is an inconclusive info saying the probe's client_id was refused (A04-01).
- SRV-004 no longer reports a public host as "resolves only locally" (error) when the resolver itself fails (ECONNREFUSED, ETIMEOUT, ESERVFAIL, ...): that is an inconclusive info with the system-lookup addresses (A04-02).
- AUTH-016 no longer repeats AUTH-002's missing `resource_metadata` as a spec and ChatGPT warning; it reports only a pointer that the unauthenticated 401 carries and the invalid-token 401 drops, when no well-known PRM resolves (A04-05).
- SPEC-016 no longer warns about a JSON-RPC error without an `id`, such as the 403 Origin rejection the 2026-07-28 transport page allows; it is read like `id: null` (C-01).
- RT-003 no longer counts a 2026-07-28 header-validation error (-32020, -32021, -32022) to an invalid-argument call as "a JSON-RPC error instead of isError" (A03-01).
- SPEC-017 and SPEC-018 no longer throw on a resource `uri` or prompt `name` such as `{"toString":"x"}`, and SPEC error-code messages use `safeStr()` (A13-01).

### Changed

- Every stderr line but the tool's own GitHub annotations goes through one guard (control characters escaped, no line starts a workflow command), and the annotations come last (I-A07-1).
- `--output`, `--json-output` and `--save-baseline` paths are checked before connecting: a directory, a path through a file or an unwritable folder is exit 2 at once, with no server started, instead of after the whole check (I-A10-1). A write that still fails says the report was printed to stdout.
- No output may overwrite a file the run reads (the config file, `--tool-args`, the `--openai-manifest` file and its `mcp.json`, the files `--plugin-dir` reads): exit 2. An output naming `$GITHUB_STEP_SUMMARY` is written once, without the automatic append (I-A01-3).
- `--help` is 84 lines: `--stdio "<command>"` is listed under Options and the `--no-*` opposites share one entry (I-A10-6).
- The image build pins the privileged `tonistiigi/binfmt` (qemu-v10.2.3) and `moby/buildkit` (v0.34.2) images by digest instead of `latest` and `buildx-stable-1` (A08-04).
- The npm publish job runs on Node 24.22.2, whose bundled npm 11.19.1 supports trusted publishing, and checks `npm --version` instead of running `npm install -g npm@...` in the job that holds `id-token: write` (I-A08-4).
- SRV-004 messages say "configured resolver" instead of "system resolver" / "public DNS" and name the resolver servers (`dns.getServers()`, recorded as `DnsResult.servers`); baselines that match the old message text need a refresh (I-A04-5).
- SPEC-010: empty `contents` for a missing URI on the 2025-11-25 probe is a warning citing the 2025-11-25 resources page (a SHOULD there); it stays an error on the 2026-07-28 probe (A04-04).
- SRV-008 and SPEC-005 findings on a legacy HTTP+SSE server cite the 2024-11-05 transports page first (I-C-4).

## [1.1.0] - 2026-11-04

Rule catalog dated 2026-11-02. 180 rules: one is new (TOOL-036) and several report more than before (see **Rules added** and **Severity raised**), so this is a minor release. It ships the minor-level findings of review round 3 ([docs/review/2026-11-04](docs/review/2026-11-04/FINDINGS.md)) and the 1.0.1 deferrals. Ten new command-line switches and one new JSON report field (`authProbe.active.clientId`); no option, config key, exit code, report field or rule id was removed or renamed.

### Rules added

- TOOL-036 "Every $ref resolves inside the schema" (spec: warning) reports, in `inputSchema` and `outputSchema`, a `$ref` or `$dynamicRef` whose `#/...` pointer names no subschema, whose `#name` fragment names no `$anchor`, `$dynamicAnchor` or draft-07 `$id: '#name'`, or that is relative while the schema has no absolute `$id`. Every key under `properties`, `$defs` and the other name maps is walked, also one named `default`, `enum` or `x-...` (A05-05, R110-Q1-01).

### Severity raised

- INJ-001, INJ-003 and INJ-005 also read property titles, `enum`/`const` values, `default` and `examples` values, and INJ-001 property names; INJ-002, INJ-004, INJ-006..010 and DATA-001..003 read titles and `enum`/`const`, POL-003/004 titles only. Paths point at the string, such as `/properties/format/enum/1` (A05-01).
- INJ-001 reports a run of two or more variation selectors (emoji smuggling) as an error, and a stray variation selector, the Hangul fillers, the Braille blank, CGJ and the Khmer inherent vowels as warnings (A05-02).
- INJ-002 flags words that mix ASCII letters with fullwidth or mathematical Latin letters, or Latin with Armenian or Cherokee (A05-10).
- The regex rules (INJ-003..010, DATA-001..003, POL-002..004) match on text with invisible characters folded (format characters including U+FEFF, CGJ, variation selectors; Hangul fillers and the Braille blank read as a space), so they can no longer split a keyword (A05-02, R110-Q1-02).
- APPS-006 judges a wildcard by its host: `https://*.vercel.app:443` is overly broad (A05-06).
- APPS-007 sees XHR `.open()` of any method, `navigator.sendBeacon`, `new Worker`/`SharedWorker`, `<video poster>`, `<embed src>` and `<object data>` origins (A05-07, R110-Q1-05).
- LST-008 and LST-009 recognise `npm exec`, `npm x`, `pnpx`, `bun x` and `uv tool run`, also behind `env [K=V ...]` (and `env -S`), `cmd /c` and `sh -c`/`bash --login -c`. `uv run` counts `--locked`/`--frozen` only among its own options before the script (C-01).
- LST-009 reads the uv package-index settings of `pyproject.toml`: `[[tool.uv.index]]` and the index keys of `[tool.uv]` and `[tool.uv.pip]`, also as dotted keys, quoted keys and inline tables (C-02).
- SPEC-013 warns when `ttlMs` is not an integer (the caching page defines it as integer milliseconds; a negative or missing value stays an error) (A04-06).
- SRV-015 (info) notes the 2026-07-28 `io.modelcontextprotocol/tasks` extension, in every capability object the server announced, `server/discover` included (A04-05).

### Added

- `--no-fail-on-spec`, `--no-fail-on-incomplete`, `--no-fail-on-drift`, `--no-diff-only`, `--no-active`, `--no-active-auth`, `--no-verbose`, `--no-quiet`, `--no-checklist` and `--color` (for `noColor`) turn off on the command line a switch the config file turns on (A01-03).
- JSON report field `authProbe.active.clientId`: the `client_id` of the DCR client `--active-auth` registered, so you can delete it (`null` if the server returned none; present only when the active auth probes ran; in the schema since 1.1) (A03-03).
- A status line on a terminal's stderr while the check connects and probes, with the phase (`listing`, `wire probes`, ...) and the elapsed seconds, cleared before the report. Never in CI, without a TTY or with `--quiet`, and it names no server, URL or value.
- A warning when a switch given on the command line is not used by the chosen `--format`: `--quiet` and `--checklist` (text only), `--diff-only` (text and markdown).
- INJ, DATA and POL messages whose match needed folded hidden characters end with `(matched with hidden characters folded: \u{...})`, so the evidence still names them (R110-Q1-04).

### Changed

- `--max-duration` also bounds the rules: rules not started by the deadline are skipped (`stopped by --max-duration`), `limits.stopped.phase` is `rules`, `limits.stopped.completed` lists only the phases that ran, the run reads `INCOMPLETE (stopped at --max-duration during rules)` and exits 4, as `--help` documented. The rules get at least 1 s; a running rule finishes first (A09-04).
- A command-line option overrides the config file's opposite or other-transport key instead of exit 2: `--local` over `noLocal` (and the reverse), a `<url>` ignores the file's `env` and `cwd`, `--stdio` its `header`, `bearer` and `activeAuth`, and `--bearer` replaces the file's `Authorization` header; a note on stderr names what was not used (A01-03).
- A run stopped by `--max-duration`, the snapshot byte budget or Ctrl+C ends the Streamable HTTP sessions the server issued: one `DELETE` each with the session id, best effort, at most 1.5 s, not recorded in the report (Q4-SESSION).
- `--fail-on-incomplete` is applied inside report building, so every format shows the failed partial check from one place; the output is the same as in 1.0.1 (A10-01).
- `--version` and `--help` load no transport, rules or renderers (about 5x faster); `explain` and `--list-rules` load the rules but not the transport, and undici only when a proxy is installed.
- Rule evaluation builds the text corpus once per run, matches a repeated text once per rule and skips plain-ASCII text in INJ-001/002.
- TOOL-034's fix no longer suggests one tool with an `action` parameter, which TOOL-024 flags (A05-08).
- Release pipeline: a release tag must point at a commit on `main` with a green CI run of a push to `main` (Q4-GUARD); the Docker image is built after a successful Release run (`workflow_run`) instead of polling npm (Q4-DOCKER); the CI pack smoke checks that the tarball has `npm-shrinkwrap.json` and the checkout has none.

### Fixed

- After a server stops answering following `initialize`, a timed-out Origin or domain-challenge probe is no longer retried: each costs one short (2 s) wait, not two (A10-02 follow-up).
- TOOL-023/025/026 follow a chain of local `$ref`s to the enum or type they judge, and a resolved node is judged by its target's shape.
- LST-014 no longer accepts a font file (`.woff2`, `.ttf`, `.otf`, `.eot`) as the plugin icon (A06-11).
- A text file whose first 4 KiB mention `<svg` without an SVG root element is no longer taken as an SVG image; the 1.0.x compatibility branch is gone (A06-06).

### Security

- A05-01, A05-02, A05-06 and A05-10 close detection bypasses: payloads in schema values and property names, invisible characters outside `\p{Cf}` (U+FEFF included), lookalike letters, and a port on a broad CSP wildcard.
- The npm package ships `npm-shrinkwrap.json` with the production tree of `package-lock.json`, so `npx`, a global install, the GitHub Action and the Docker image install the tree CI tested and audited (A08-03).
- `release.yml` checks that the npm provenance attestation names this repository, `release.yml`, the tag, the tagged commit, the run and the tarball's sha512 (Q4-PROVENANCE), and refuses a tag on a commit that is not on `main` or has no green CI run (Q4-GUARD). The guard catches a tag on the wrong commit; it runs the tagged commit's own workflow, so it is no barrier against a hostile tag.

### Docs

- The listings guide explains the trust model of a config file found in a plugin folder under review (A01-01).
- README and the CI guide: the package now fixes its dependency tree, but the Action's `version` input still floats over patch releases unless pinned exactly.
- CONTRIBUTING's release steps: tag the head of a green push to `main`, the provenance content check, and the Docker build after the Release run.
- The options guide, the privacy guide and SECURITY.md describe `authProbe.active.clientId`, the deadline on the rules and that a timed-out probe is not retried after a stall.

## [1.0.1] - 2026-11-04

Rule catalog dated 2026-11-02. Fixes the 57 patch-level findings of review round 3 ([docs/review/2026-11-04](docs/review/2026-11-04/FINDINGS.md)). As a patch release it never makes a passing run fail: no rules added, no severity raised, no new JSON report fields. Some findings now come out as skipped or "not checked" warnings, where 1.0.0 silently passed or checked the wrong file.

### Security

- A config file that is **discovered** (no `--config`) can now set options only. It can no longer supply the server (`url`, `stdio`, `command`, `args`), output paths, `cwd`, `env`, headers, `bearer`, `active` or `activeAuth`: those keys are ignored with a warning that names the file. So `$MCP_REVIEW_CHECK_TOKEN` is never sent to a URL that came from a file in the folder you ran in. An explicit `--config` keeps full power. Every applied config file is named on stderr (A01-01).
- `ALL_PROXY` credentials are redacted like `HTTPS_PROXY` and `HTTP_PROXY` ones, through one shared list of proxy variables (A02-01).
- Server text printed by `--verbose`, the fatal-error path and GitHub annotations can no longer start a workflow command (`::`, legacy `##[`), and ESC, bidi and other hidden characters are shown as `\u{..}` (A07-04, A07-05, A07-07).
- A token-shaped `<url>` argument, or a URL without a scheme, is no longer echoed in the usage error (A01-09).
- The `--verbose` listing dump redacts credential-named keys, `--header=Name: value`, `--flag=<token>` and known token formats (A06-07).
- `--active` skips more read-only-annotated tools whose names say they write: more mutating verbs, inflected and glued names, and words after a conjunction (A03-01).
- `--active-auth` prints the `client_id` and endpoint of the DCR client it registered on stderr, so you can delete it (A03-03).
- The GitHub Action installs the npm package with scripts off, before the token is exported, uses the project's `.npmrc`, and rejects a multi-line bearer before echoing it (A08-01, A08-02, A08-06).
- The Docker image that is pushed is the exact digest that was smoke-tested, for both platforms (A08-05).

### Fixed

- Baseline and drift:
  - A run that did not connect or was stopped no longer overwrites the accepted baseline (`--save-baseline`). The GitLab recipe refreshes the baseline only after a successful job (A01-02).
  - Fingerprints and baseline matching use the snapshot the rules saw and ignore non-secret `--env` values (A01-04, A01-05, A01-07).
  - A listing-only run records no tool fingerprints (A07-06).
  - Matching is linear in the number of findings (improvement).
  - `--output` naming the `--baseline` or `--save-baseline` file is caught, including through links and case differences (A01-06).
  - A saved baseline with no fingerprints, or larger than the read cap, gets a warning (A01-08).
- `--fail-on-incomplete`: a failed partial check reads as failed in the Result line, JSON summary, JUnit and the GitHub annotation, and is named once (A10-01).
- `--bearer ""` and `--tool-args ""` print a warning instead of being dropped silently (A01-10).
- Proxy and transport:
  - `NO_PROXY` is decided exactly as undici does (A02-02).
  - The response is taken from an SSE or batch body, not from a server request with the same id (A02-03).
  - A 5xx gateway page is diagnosed as the gateway failing, not as a wrong MCP path (A02-04).
  - A TLS failure behind a proxy names the proxy and `NODE_EXTRA_CA_CERTS` (A02-05).
  - A stdio server is closed once (A02-06).
  - Notification methods are tallied safely (A04-04).
- A server that stops answering after `initialize` gets a short wait instead of the full timeout per request, with a notice on stderr as it happens (A10-02). The GET and `subscriptions/listen` probes wait at most 5 s (A03-02).
- Connect failures:
  - Rules that need the server's answers are skipped, not counted as passed (A10-05).
  - SPEC-024 and SRV-018 are skipped for a stopped run (A04-02).
  - SRV-003 names the exit code or signal of a stdio server that ended before `initialize` (A10-06).
  - No `--fail-on-spec` advice on a connect-failed run (A10-07).
  - SRV-003 is shown as skipped in the claude and chatgpt JUnit suites (A10-05).
- False positives:
  - AUTH-021 reads a well-formed RFC 6749 error correctly and caps its body-text match at warning (A04-03).
  - TOOL-015 and DATA-001/003/005 resolve a local `$ref` and `const` lists before judging a parameter (A05-04).
  - INJ-007 no longer takes the article as a tool name, and INJ-002 exempts biomedical Greek notation (A05-03, A05-09).
- Performance: linear-time `snakeCase` and `tokenize` on long uppercase runs, the POL-003 percent pattern, CSS `url()` scanning and the INJ-002 Greek check, and one origin pass per UI resource (A09-01, A09-02, A09-03).
- Listings:
  - A manual checklist item is kept unless every LST rule that covers it ran (A06-01, A06-02).
  - Listing files behind a linked folder are refused (A06-03).
  - The ChatGPT package root comes from the path you named, so a linked manifest folder or `plugin.json` no longer moves it (A06-04).
  - An icon ref is reported once, at the LST-021 level (A06-05).
  - An SVG is detected by its root element after the prologue (A06-06).
  - The `--verbose` listing dump keeps its line breaks (A06-08).
  - A declared `mcpServers` path is read on its own, outside or missing paths are a "not checked" warning, and the read caps for JSON and images are warnings instead of errors (A06-09, A06-10).
- Reports:
  - The JSON Schema accepts listing-only and snapshot-budget reports (A07-02, A07-03).
  - `$schema` and the schema `$id` point at the tag of the installed release (A10-04).
  - JSON and SARIF reports with more than 10 000 findings are printed compact, and a report too large to write ends with a clear error and exit 3 instead of a crash (A09-05).
- GitHub Action: every line of a multi-line `extra-args` is now passed. Options from the second line on, such as `--fail-on-incomplete`, `--baseline` or `--ignore`, now apply where 1.0.0 dropped them (A08-01).

### Docs

- The privacy guide and SECURITY.md give the real request count (20 to 40), the 2026-07-28 probes, the Origin-less `initialize` and the session-closing DELETEs (A03-04).
- The options guide describes the discovered-config trust model and config discovery with `--cwd`.
- The CI guide's Docker recipe runs the image as the host user so a mounted output folder is writable, with rootless Docker and Podman variants (A08-04).

## [1.0.0] - 2026-11-03

Rule catalog dated 2026-11-02. No rule changes. The first stable release: from 1.0.0 the CLI options, config keys, exit codes, JSON report fields and rule ids follow semantic versioning (see the README's Stability policy).

### Added

- A stability policy for 1.x in the README and CONTRIBUTING.md: what needs a major, a minor or a patch release, and what is not covered.
- SOCKS5 proxies (`socks5://`, `socks5h://`) in `HTTPS_PROXY`, `HTTP_PROXY` and the new `ALL_PROXY` fallback; SOCKS4 and unknown schemes are a usage error (exit 2) that names the variable, with credentials redacted. A bad proxy variable does not block `--version`, `--help`, `--list-rules` or `explain`.
- The Docker image is smoke-tested in CI before it is pushed: `--version`, a listing-only run with no network, and a non-root user check.

### Changed

- `http://` targets go through an HTTP proxy as plain forwarded requests, so forward-only proxies work; `https://` targets still use `CONNECT`.
- The raw TLS check message no longer says "HTTP proxy" when the proxy is SOCKS.
- `undici` 6 to 7.

### Fixed

- The experimental-feature warning about proxy support is no longer printed; other warnings still are.

## [0.7.0] - 2026-11-03

Rule catalog dated 2026-11-02. One rule is new and two report more than before (see **Rules added** and **Severity raised**), so this is a minor release.

### Added

- A read-only `tasks/get` probe with a random task id that does not exist, sent only when a 2026-07-28 server declares the `io.modelcontextprotocol/tasks` extension.
- A `subscriptions/listen` probe that reads only the response headers and closes at once, sent only when a 2026-07-28 server declares `listChanged` or resource subscriptions.
- The JSON report records the server notifications seen during the run, by method name and count, without payloads.

#### Rules added

- SPEC-024 (spec: error) reports `notifications/message` sent without `io.modelcontextprotocol/logLevel` on the request, without a declared `logging` capability, or without a valid level.

#### Severity raised

- SPEC-023 reports a declared tasks extension whose `tasks/get` is not implemented as an error, instead of "declared, not verified".
- SPEC-005 warns when `subscriptions/listen` is answered with something other than an event stream (a JSON-RPC error answered with HTTP 200 is accepted).

## [0.6.0] - 2026-11-03

Rule catalog dated 2026-11-02. Two rules are new (see **Rules added**), so this is a minor release.

### Added

- Listing-only runs: `--plugin-dir` and `--openai-manifest` (or the config keys `pluginDir` and `openaiManifest`) work without a `<url>` or `--stdio` target and check only the files, before deploy. Rules that need a server are skipped with "no server target (listing-only run)", the reports say listing-only, and the JSON report has `server.listingOnly` and a null score.
- `--verbose` prints the parsed listing on stderr, with header, env and credential values removed.

#### Rules added

- LST-027 checks the icons named in a ChatGPT manifest: square, 48 to 4096 px, at most 5 MiB, read from the PNG, JPEG, WebP or SVG header without fetching anything (automates MAN-019).
- LST-028 checks the screenshots named in a ChatGPT manifest: PNG or JPEG, 706 px wide, 400 to 860 px tall (automates part of MAN-024).

### Changed

- With `--openai-manifest` the manual checklist drops MAN-019 and shortens MAN-024.
- `--plugin-dir` or `--openai-manifest` without a server target is no longer a usage error; options that need a server (`--bearer`, `--header`, `--env`, `--cwd`, `--active`, `--active-auth`, `--tool-args`) are usage errors in a listing-only run.

## [0.5.0] - 2026-11-03

Rule catalog dated 2026-11-02. No rule changes; a minor release for corporate proxy support, the user guide and new ways to run the check.

### Added

- Corporate proxy support: `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY` (and their lower-case forms) apply to every HTTP request the check makes; the proxy must support `CONNECT`, and its credentials are redacted in every output.
- A proxy that refuses the connection or answers `407 Proxy Authentication Required` is named as the cause of a failed connection.
- A user guide in `docs/guide/`: a step-by-step walkthrough from the first run to directory submission, a troubleshooting page, and the reference pages for options and the config file, CI, authentication, listings, and privacy and requests.
- A complete GitLab CI recipe (JUnit report, baseline cache), a pre-commit hook (`.pre-commit-hooks.yaml`) and a Docker image `ghcr.io/alisaosipova/mcp-review-check`, published on every release tag.
- `--help` lists the environment variables the check reads and links to the guide.

### Changed

- The raw TLS handshake check reports a host reached through a proxy as inconclusive (info) instead of measuring the proxy.
- The README is shorter: an overview, a quick start and the common commands; the detailed reference moved to `docs/guide/` (README anchors such as `#options`, `#config-file` and `#ci-recipes` now live there).
- New runtime dependency: `undici` 6, used only when a proxy variable is set.

## [0.4.0] - 2026-11-03

Rule catalog dated 2026-11-02. 29 rules are new (see **Rules added**) and the AUTH-012 message changes, and the CLI gains drift detection and manifest linting, so this is a minor release.

### Added

- `--baseline` also compares the tool definitions. `--save-baseline` and `--json-output` write `toolFingerprints` (one SHA-256 per tool over its `name`, `title`, `description`, `inputSchema`, `outputSchema`, `annotations` and `_meta`, plus one digest per field), and a later run reports **Changed tool definitions** (tools added, removed or changed, with the changed fields) in text, markdown, JSON (`baseline.toolChanges`) and JUnit (`<system-out>`); a baseline written by 0.3 or older still works and the report says its fingerprints were not recorded.
- Each changed tool is a `note` result of the synthetic rule `BASE-001` ("Tool definition changed since baseline") in SARIF; it is not part of the rule catalog and never changes the exit code by itself.
- `--fail-on-drift` exits 1 when a tool was added, removed or changed since `--baseline`, also with `--fail-on never`.
- `--diff-only` (with `--baseline`) limits the text and markdown reports to the new findings and the changed tool definitions, without the known-findings line and the manual checklist.
- `schema/report.schema.json` (JSON Schema draft 2020-12) describes the JSON report and ships in the npm package; the JSON report names it in `$schema`.
- `--plugin-dir <dir>` lints a Claude plugin folder (`.claude-plugin/plugin.json`, `.mcp.json`, README, LICENSE) and `--openai-manifest <file>` lints a ChatGPT plugin package manifest, next to a `<url>` or `--stdio` check; with them the manual checklist drops the items the new LST rules automate, and a missing path or the wrong kind of path is exit 2.
- The config file accepts the keys `pluginDir` and `openaiManifest` (paths relative to the file), `failOnDrift` and `diffOnly`.
- CI has a `coverage` job (Linux, Node 24) that runs `npm run test:coverage` and uploads the report; the branch threshold is now 83.

#### Rules added

- LST-001..LST-026 (claude: error, warning, info; chatgpt: error, warning, info), run only with `--plugin-dir` or `--openai-manifest`: the Claude plugin folder (manifest, name, README, LICENSE, `.mcp.json`, remote URLs, version-pinned launchers, package sources, bundles, credentials in headers or env, system files, file limits, directory listing fields) and the ChatGPT package manifest (listing text limits, the four HTTPS listing URLs, starter prompts, brand color contrast, icons, review test cases, forbidden fields, the MCP server), with cross-checks against the live server; severity follows the vendor checklists (error only where they say a submission is blocked or rejected, and a heuristic is at most a warning), and no rule quotes a header, environment or credential value.
- SPEC-021 (spec: info): `logging`, `sampling` or `roots` in the server's capabilities, an HTTP+SSE-only transport, `sampling/createMessage` or `roots/list` requested through `input_required` results and `includeContext: "thisServer"` or `"allServers"` are deprecated in the 2026-07-28 specification (SEP-2577, SEP-2596).
- SPEC-022 (spec: info, 2026-07-28 servers only): results without `_meta["io.modelcontextprotocol/serverInfo"]`, or with a value that is not an object with a string `name` and `version`.
- SPEC-023 (spec: error): `capabilities.extensions` must be an object keyed by `vendor-prefix/name` identifiers with object settings; a well-formed identifier under a prefix reserved for MCP is a warning, and `io.modelcontextprotocol/tasks` declared without verifiable `tasks/get`, `tasks/update` and `tasks/cancel` is info.

#### Severity raised

- None.

#### Severity lowered / false positives fixed

- AUTH-012: the DCR-only finding (info, unchanged) now says that Dynamic Client Registration is deprecated in 2026-07-28 for new servers and that Claude uses CIMD only with `client_id_metadata_document_supported: true` and `"none"` in `token_endpoint_auth_methods_supported`.
- SPEC-021 no longer reports `constructor`, `toString` and other `Object.prototype` names as deprecated requests.

#### Rules retired

- None.

### Changed

- A run reads at most 64 MiB of server data (HTTP bodies, SDK responses and stdio messages together); when that budget is spent, reading stops, `limits.truncated` lists `snapshot budget` with `unit: "bytes"`, `limits.budgetExhausted` names the phase, and the rules run on what was observed.
- A run that spent the byte budget is a partial check: the verdict is INCOMPLETE, rules that needed the unfinished phase are skipped with "snapshot budget exhausted", the exit code follows `--fail-on` and is never 4, and `--fail-on-incomplete` makes it 3.
- The run no longer keeps the parsed body of every HTTP exchange, only a masked snippet, its size, a SHA-256 and a summary of the JSON-RPC responses, so a large `tools/list` is held once instead of several times.
- `release.yml` publishes only through npm trusted publishing; the `NPM_TOKEN` fallback step is removed.
- `--baseline`, `--config` and `--openai-manifest` must be regular files (a pipe, device or directory is exit 2), and `--baseline` and config files are capped at 16 MiB.
- `--fail-on-drift` exits 1 with a warning on stderr when the tool definitions could not be compared (a baseline without fingerprints, or a run whose `tools/list` did not finish), instead of passing silently.

### Fixed

- A malformed `.mcp.json` or manifest no longer has a window of its content copied into the listing warning.
- No input file can hang the run on a FIFO: the listing reader opens files without blocking and checks the descriptor again.

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

[Unreleased]: https://github.com/alisaosipova/mcp-review-check/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/alisaosipova/mcp-review-check/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/alisaosipova/mcp-review-check/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/alisaosipova/mcp-review-check/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/alisaosipova/mcp-review-check/compare/v0.7.0...v1.0.0
[0.7.0]: https://github.com/alisaosipova/mcp-review-check/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/alisaosipova/mcp-review-check/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/alisaosipova/mcp-review-check/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/alisaosipova/mcp-review-check/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/alisaosipova/mcp-review-check/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/alisaosipova/mcp-review-check/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/alisaosipova/mcp-review-check/releases/tag/v0.1.0
