> **Status: DRAFT, not revised.** The planner draft of workflow `wf_557ecc20-a42`. Two critics reviewed it: 31 issues, listed in [evidence/plan-critique.json](evidence/plan-critique.json). The revision step was stopped on 2026-11-04 at the user's request (usage limits). Before implementing, apply the high and medium critique issues (or rerun `.claude/review-r4/plan-round4.js` with `resumeFromRunId: wf_557ecc20-a42`, which replays the draft and the critiques from cache and runs only the revision). Then rename this file to REMEDIATION.md.

# Review round 4 remediation plan

Inputs: [FINDINGS.md](FINDINGS.md) and [evidence/workflow-result.json](evidence/workflow-result.json) (review of 1.1.0 at `bc7090d`, recorded at `ddfe1b0`), [SPEC.md](SPEC.md), the README stability policy, CONTRIBUTING.md and the 1.0.1/1.1.0 CHANGELOG. Format follows [../2026-11-04/REMEDIATION.md](../2026-11-04/REMEDIATION.md).

Release rules (1.x): a **patch** never makes a passing run fail (fixes, false-positive removal, a skip instead of a pass, lower severities, performance, hardening, clearer messages, docs). A **minor** may add rules, raise severities, widen detection and add options, config keys and JSON fields. A **major** is needed to remove or rename options, config keys, exit codes, report fields or rule ids, or to raise the Node minimum. Each feature set ships as its own release. Severity principle: `error` only for a documented MUST with deterministic detection; heuristics are at most `warning`.

## 1. Summary

| | count |
|---|---|
| Findings | 92: 88 confirmed (3 high, 32 medium, 53 low), 1 disputed, 3 refuted |
| Confirmed after merging duplicates | 85 distinct defects (3 duplicate ids) |
| Improvement ideas | 92, of which 87 are distinct (5 duplicate ids) |
| Scheduled | 85 defects + the disputed A05-13 + 87 improvements, in 8 releases |
| 2.0 notes | 4 follow-ups, none of which blocks a 1.x item |
| Rejected | no whole item; 3 sub-options (section 4) |

Duplicates. Each one is fixed once, under the first id listed:

- **A01-01 = A07-02 = A12-01**: a `--fail-on-drift` failure exits 1 while every report says PASS.
- **A04-03 = A13-03**: rules with `needs: []` pass without data in auth-required and token-rejected runs. **I-A04-3** (an explicit "server answered" need) is the fix for A04-03, so it is folded in.
- **A10-05 = I-A09-2**: cap FIX SNIPPETS in the text report.
- **A11-01 = I-A05-4**: add serverInfo, prompt names and titles, and resource names and titles to the corpus.
- **I-A02-1 = I-A04-1**: count server notifications on stdio, HTTP+SSE and the GET stream, so that SPEC-024 also runs there.
- **I-A10-1 = I-A12-10**: check that output paths can be written before connecting.

Overlapping items stay separate ids but go to the same package, so they are fixed together: A02-04 + A10-03 (silent server and timeout text); A07-01 + I-A07-1 (stderr guard); A07-06 + I-A07-7 (encoded secrets); A12-04 + I-A10-1 (output directories); A12-03 + I-A12-7 (Action inputs); A08-05 + I-A08-6 (ref policy). Also A06-10 + I-A06-1/2/3 + I-A11-2: I-A11-2 is the Claude plugin checklist, and it covers only what the other four do not.

Refuted, not scheduled: A02-03, A06-05 and A12-05.

Release map:

| Release | Theme | Confirmed defects | Improvements | Packages |
|---|---|---|---|---|
| 1.1.1 | patch: every patch-level defect, including the 3 high ones | 66 + disputed A05-13 | 33 | 9 |
| 1.2.0 | security detection | 7 | 7 | 5 |
| 1.3.0 | listing checks from the directory gap analysis (and the second half of A06-01) | 5 | 9 | 5 |
| 1.4.0 | CI integration and machine-readable reports | 3 | 13 | 6 |
| 1.5.0 | protocol and spec checks from the gap analysis | 4 | 12 | 5 |
| 1.6.0 | config, suppression and onboarding | 0 | 4 | 5 |
| 1.7.0 | engine, active probes and extension points | 0 | 7 | 5 |
| 1.8.0 | several servers in one config and one run | 0 | 2 | 5 |

Two items are split across two releases so that the patch stays patch-safe:

- **A06-01** (high). 1.1.1 reads the MCP files that `plugin.json` names and reports their problems at `info`. `--fail-on` accepts only error, warning or never, so an info finding cannot turn a run red. 1.3.0 raises those findings to the rule's own severity.
- **A13-02**. 1.1.1 turns a rule that throws into a skip and gives an INCOMPLETE verdict, without changing the exit code. 1.4.0 lets `--fail-on-incomplete` act on it.

## 2. Releases

Package keys are unique across the plan. "Owns" lists every file the package may edit. Other packages in the same release do not touch these files; when a package needs a change in a file it does not own, that change is a handoff (listed after the release's packages). Test file names are suggestions. Each item needs a test that fails before the change and passes after it.

### 2.1 Release 1.1.1: fixes (patch)

**Goal.** Fix every confirmed defect a patch may fix. The three high ones are A06-01 (first half), A09-01 and A09-02. The release adds no rule and raises no severity. A run that passes on 1.1.0 still passes, except where the run was false: a crashed rule, or a platform that was never checked, now reads INCOMPLETE without changing the exit code.

**P1: CLI, config, baseline and outputs.** Owns `src/cli.ts`, `src/config.ts`, `src/input-file.ts`, `src/baseline.ts`, `src/report/drift.ts`. Tests: `test/r111-p1-cli.test.ts`, `test/r111-p1-baseline.test.ts`.
- **A01-02**: a fatal or stopped run skips every output whose path `samePath()`s `--baseline` or `--save-baseline` (`--output` in json format, `--json-output`), with the same "not written" warning; fix the misleading "is kept" text. Test: a stopped run with `--json-output` equal to the baseline leaves the baseline file byte-identical.
- **A01-03**: `--save-baseline` is not written when `--fail-on-incomplete` is set and the check is partial (exit 3). Test: an auth-required fixture with both flags exits 3 and creates no baseline.
- **A01-04**: in a listing-only run, `--fail-on-drift` on the command line is a usage error (exit 2, "needs a <url> or --stdio target"). From a config file it is dropped with a "not used from" note. A listing-only baseline is named as such. Test: both paths, plus the message for a listing-only baseline.
- **A01-05**: the wildcard pass uses a linear glob matcher (split on the mark, `indexOf` leftmost-first, no gap across `"`) and indexes entries by literal prefix and suffix. Test: 5,000 findings × 500 wildcard entries in under 1 s, with the same matches as the old regex.
- **A01-06**: a config string (or list or map entry, `stdio`, `args`, `url`) containing U+0000 is a `ConfigError` that does not echo the value. The redactor safety net is handed off to P7. Test: a NUL in `bearer` and in `cwd` gives exit 2, and the message does not contain the value.
- **A07-01**: the listing warning line goes through `ciSafeLine(... scrub(...))`, so CR/LF are escaped and the line cannot start a workflow command. Test: a manifest whose `mcpServers` holds `\n::error::x` produces no `::error` line on stderr.
- **A12-04**: create the parent directory (`mkdirSync(dirname, {recursive:true})`) before writing `--save-baseline`, `--json-output` and `--output`. Test: the documented first-baseline command in an empty temp repo exits 0 and writes `.mcp-review-check/baseline.json`.
- **A12-08**: the `sarifLocation` warning fires only when `--sarif-location` was given on the command line (`cliGiven`); apply the same rule to the `tool-args`-without-`--active` warning. Test: a config with `sarifLocation` and `--format text` prints no warning.
- **C-05**: when an unknown token contains whitespace and its first word is a known option, say "passed as one argument; pass two arguments or write --stdio=<value>", and never suggest the name already shown. Test: `"--stdio node x.mjs"` as a single argv word.
- **I-A01-2**: the "options from --config" note names `url`/`stdio` as not used when the command line gives a server. Test: stderr contains `key "url" (a server is given on the command line)`.
- **I-A01-3**: no output path may equal an input path (`--config`, `--tool-args`, `--openai-manifest`, `--plugin-dir` files, `$GITHUB_STEP_SUMMARY`). Test: `--output` equal to the `--config` path gives exit 2 and leaves the file unchanged.
- **I-A01-5**: decode UTF-16BE with a BOM in config, baseline and tool-args, or name the encoding in the error. Test: an FE FF config loads.
- **I-A07-1**: one per-line `ciSafeLine` guard over all assembled stderr except our own annotation lines, which are appended last. Test: inject `::warning` through three different warning sources, and no line starts a command.
- **I-A09-5**: `toolFingerprint` canonicalizes each tool once, and `pinFingerprints` is computed once per run. Test: same fingerprints as 1.1.0 on `test/fixtures/real/*`, plus a call-count assertion.
- **I-A10-1** (also covers I-A12-10): before connecting, check that the parent directories of `--output`, `--json-output` and `--save-baseline` exist or can be created and are writable. A failure is a usage error, and the message says whether the report went to stdout. Test: an unwritable directory gives exit 2 with no server process started.
- **I-A10-3**: suggest "did you mean" for enumerated values (`--format jsn` → `json`; `--target`, `--fail-on`). Test: three misspellings.
- **I-A10-6**: shorten `--help`: list `--stdio "<command>"` under Options and fold the ten `--no-*` switches into one line. Test: a help snapshot contains `--stdio` and is at most 90 lines.
- Handoffs consumed by P1: the drift outcome contract from P7 (A01-01) and `activeSkipReason()` from P8 (A03-04).

**P2: transport, diagnosis and auth probe.** Owns `src/connect.ts`, `src/diagnose.ts`, `src/proxy.ts`, `src/probe/network.ts`, `src/probe/auth.ts`, `docs/guide/troubleshooting.md`, `docs/guide/privacy-and-requests.md`. Tests: `test/r111-p2-transport.test.ts`, `test/r111-p2-auth.test.ts`.
- **A02-05** (medium): do not await session DELETEs inline. Collect the promises and await them once at `finishHttp` or on a stop, bounded by `SESSION_END_TIMEOUT_MS`. Test: a server that never answers DELETE adds at most 2 s to the run.
- **A02-01**: the stop and Ctrl+C DELETE follows a same-origin 307/308 (at most two hops, `isWithinOrigin`, no userinfo added). Test: a 308 `/mcp` → `/mcp/` case in `r110-q4-session` style.
- **A02-02**: SOCKS diagnosis. `UND_ERR_SOCKS5_*` counts as a proxy hop, AUTH_* as proxy auth, REPLY_2/3/4/5 map to their causes, and the message names the proxy kind ("SOCKS proxy", not "HTTP proxy that allows CONNECT"). Test: a table over the codes.
- **A02-04**: an initialize timeout reads "initialize got no answer within <ms> ms", with the HTTP connect-cap hint, and maps to kind `timeout`. Test: `hang-server.mjs` over stdio and HTTP.
- **A03-02** (medium): the auth probe runs at most once per run. The tools/list 401 path reuses `snap.authProbe`, and every DCR registration is collected and announced. Test: with `--active-auth`, the fixture's DCR endpoint is hit once and the reported `clientId` matches.
- **A10-01**: 501 and 405 on POST are classified as `not-mcp` with the `<origin>/mcp` hint, before the 5xx branch. Test: an HTML 501 gives kind `not-mcp` (1.0.1 regression).
- **A10-03**: when both preflight attempts time out with no answer, skip discover and the SDK initialize, or run them with `STALLED_TIMEOUT_MS`. Retry a preflight timeout only on ECONNRESET-like errors. New diagnosis kind `no-answer` with host:port and wait. Test: a TCP-accept-and-hang server fails in about 15 s, not 60 s.
- **A09-05**: a linear stdio read buffer (a chunk list, a newline search in the new chunk only, one `Buffer.concat` per line), with the budget charged as bytes arrive. Test: a 62 MB tools/list over stdio completes, or hits the budget, within the timeout.
- **I-A02-3**: proxy diagnosis table tests (SOCKS codes, plain-forwarding 407, CONNECT 407) and a `proxy:` line in `--verbose`. Test: the same, in `test/p5a-proxy.test.ts` style.
- **I-A02-4**: correct the `proxy.ts` plain-forwarding comment and the diagnosis text to match what undici does. Test: the message assertion from A02-02.
- **I-A03-6**: publish partial auth-probe results as soon as DCR returns, so a `--max-duration` stop still prints the client_id notice. Test: a stop after the DCR POST still prints the notice.
- Handoff provided to P4: `DnsResult.servers = dns.getServers()` (I-A04-5).

**P3: rule engine.** Owns `src/rules/engine.ts`, `src/rules/types.ts`, `src/rules/util/access.ts`, `src/rules/index.ts`. Tests: `test/r111-p3-engine.test.ts`, `test/r111-p3-fuzz.test.ts`, `test/r111-p3-needs-selftest.test.ts`.
- **A04-03** (medium, also covers A13-03 and I-A04-3): add a `handshake` need, met when `initializeRaw` or `discoverRaw` is present, with skip reason `authReason(snap)`. Assign it (or `tools`/`resources`/`prompts`) to the rules that read handshake or list data: SRV-011..015, SPEC-002/008/016..023 and the ones listed in A13-03. Test: the `auth-required.json` snapshot shows those rules as skipped in JUnit.
- **A04-06**: on `fatal` or `connect-failed`, the needs auth, legacy, modern, ui, tools, resources and prompts skip with `authReason ?? CONNECT_REASON`. Test: the skip texts on a connect failure.
- **A10-06**: SRV-003 skips with "stdio target" for a stdio target that did not fail. Test: the stdio JUnit has no passed SRV-003.
- **A13-01** (medium): a total `safeStr()` (string as is, else JSON.stringify or String in a try, length-capped) used in `toolName`. The `spec.ts` coercions are handed off to P4. Test: a tool named `{"toString":"x"}` gives a report, not exit 3.
- **A13-02** (medium, patch half): a throwing rule goes to `skipped` with `internal error: <msg>` and does not count as run. `EngineResult.internalErrors` makes the report INCOMPLETE with score null, through P7. The INTERNAL finding stays `info` and the exit code is unchanged. Gating under `--fail-on-incomplete` comes in 1.4.0 (C2). Test: an injected throwing rule leads to INCOMPLETE and exit 0.
- **I-A13-1**: a hostile-shape fuzz test. Every server-controlled field set to null, number, array, `{}`, `{"toString":"x"}` or `__proto__` objects; `runRules` over the catalog gives no INTERNAL and no throw.
- **I-A13-2**: a rule-metadata self-test. Run every rule through a read-recording Proxy against the auth-required, connect-failed and listing-only fixtures, and fail when a rule reads data its needs do not guarantee and still counts as run.
- **I-A13-3**: replace `URL_ONLY` with rule metadata (a `url` need or `judges: 'url'`) and compute the listing-only reason once. Test: the self-test above, plus an equal-output check on the fixtures.
- **I-A13-5**: `sortFindings(ignored)`. Test: `ignored[]` comes out in sorted order.

**P4: protocol, server and auth rules.** Owns `src/rules/server.ts`, `src/rules/spec.ts`, `src/rules/auth.ts`, `src/rules/runtime.ts`. Tests: `test/r111-p4-rules.test.ts`, with cases in `test/rules/{server,spec,auth}.test.ts`.
- **A04-01** (medium): AUTH-020 counts a 400 as a redirect rejection only when the body names the redirect. An `invalid_client`/`unauthorized_client`/`invalid_request` without redirect wording, or any 400 with no DCR `client_id`, becomes an info "inconclusive". Test: three bodies.
- **A04-02** (medium): SRV-004 says "resolves only locally" only for ENOTFOUND, ENODATA or an empty answer. Any other resolver error gives the INCONCLUSIVE info with the system-lookup addresses, and the wording is "configured resolver". Test: ESERVFAIL and ECONNREFUSED stubs.
- **A04-04**: SPEC-010 empty contents on the legacy era (2025-11-25) is a warning (SHOULD) with the 2025-11-25 citation. The modern era stays error. Add a severity note. Test: both eras.
- **A04-05**: AUTH-016 does not report a missing `resource_metadata` when a well-known PRM resolved (AUTH-002 covers it). Test: a PRM fixture gives no AUTH-016.
- **C-01** (medium): SPEC-016 treats a missing id in an error response like `id: null` (at least for 4xx and the Origin, notification and header probes). Test: a 403 Origin rejection whose body has no id produces no warning.
- **I-A04-5**: SRV-004 messages name the resolver servers that answered (`DnsResult.servers` from P2). Test: the message contains the stub server address.
- **I-C-4**: on sse-legacy targets, SRV-008 and SPEC-005 cite the 2024-11-05 transports page first. Test: an SSE fixture finding has that `docs` URL.
- Handoff consumed: `safeStr()` from P3 for the `spec.ts` coercions at about lines 434/435/522/523 (A13-01).

**P5: content rules (false positives) and rule-phase performance.** Owns `src/rules/injection.ts`, `src/rules/data.ts`, `src/rules/schema.ts`, `src/rules/tools.ts`, `src/rules/annotations.ts`, `src/rules/apps.ts`, `src/rules/policy.ts`, `src/rules/util/schemaWalk.ts`, `src/rules/util/text.ts`, `src/rules/util/html.ts`, `src/rules/util/ui.ts`, `src/limits.ts`, `test/r3-p5-content-rules.test.ts` (regex guard). Tests: `test/r111-p5-content.test.ts`, `test/r111-p5-perf.test.ts`.
- **A09-01** (high): `importMapUrls` is linear. Skip matches inside the previous importmap body; on an unclosed `</script` parse the rest once and stop. Add `<script type=importmap>` and `...{` units to the guard. Test: 2 MB of openers in under 200 ms.
- **A09-03** (medium): `capSnapshot` applies `capStrings` to every read content item (uri gets ID_CAP; mimeType and `_meta` get TEXT_CAP), and `normalizeMime` splits on the first `=` with `indexOf`. Test: a 1 MB mimeType runs in milliseconds and the cut is recorded.
- **A09-06** (medium): key the corpus memo by the raw lists (a WeakMap on `snap.tools`), checked with the existing signature, so tracked proxies share it. Test: in a stopped run, `buildCorpus` is called once.
- **A09-07** (medium): `uiResources` builds a `Map<uri, resource>` once per snapshot (memoized like A09-06) and caches decoded HTML per item. Test: 40k tools in under 1 s for the 15 call sites.
- **A09-08**: cut each pointer in a message to its first and last 60 characters, and the message to 2 KB; `path` is bounded too. Test: a 100 KB property name yields a message of at most 2 KB.
- **A05-05** (medium): a shared `unwrapNullable()` for anyOf/oneOf `[X, {type:null}]`, used in `resolvedNode`; `enumValues` resolves `$ref` branches. Test: an optional enum parameter is no longer "free-form" (TOOL-015/023/025/026, the DATA skips).
- **A05-13** (disputed): first decide from the 2026-07-28 schema-extension text. If a nullable primitive is allowed, accept a `[prim,'null']` type array and an anyOf of a primitive plus null (via `unwrapNullable`). If it is not, keep the error but say "nullable union" instead of "without a type". Record the decision in the CHANGELOG. Test: both shapes.
- **A05-06**: DATA-001 skips a non-text `context_window`. Test: an integer `context_window` produces no finding.
- **A05-07**: INJ-001 exempts the RGI subdivision flags (gbeng, gbsct, gbwls). Test: the three flags are clean; any other tag run still errors.
- **A05-08**: INJ-001 exempts ZWNJ/ZWJ between joining or Indic letters, and LRM/RLM/ALM next to RTL letters. Test: Persian, Hindi and Hebrew near-misses; the same characters inside a Latin word still warn.
- **A05-09**: INJ-002 accepts lowercase-Greek-prefix-plus-capitals (NF-κB, αSMA, γH2AX, αvβ3, αKG). Test: those clean, `pαypal` still flagged.
- **A05-11**: INJ-003 treats `<name-word>` with no whitespace and no closing tag as a placeholder. Test: `<secret-name>` and `<admin-host>` are clean; `<system>` still warns.
- **A05-12**: APPS-007 ignores origins inside `<!-- -->` outside script and style. Test: a commented `<script src>` produces no error.
- **A10-04**: the "matched with hidden characters folded" note appears only when the unfolded form does not match, or a removed character falls inside the match. Test: a plain emoji text gets no note.
- **I-A09-3**: widen the regex-complexity guard with per-rule timing, the importmap opener, uncapped read-item fields and `_meta`, all through `resourceReads`. (P6 covers the listing inputs in its own test.)

**P6: listings.** Owns `src/listing/**`, `src/rules/listing.ts`, `src/rules/manual.ts`, `docs/guide/listings.md`. Tests: `test/r111-p6-listings.test.ts`, plus new fixtures under `test/fixtures/listing/plugin-mcpfiles/` and `plugin-deps/`.
- **A06-01** (high, patch half): `loadPluginDir` reads every `.json` path in `plugin.json` `mcpServers` (string or array) with the `declaredMcp` logic (`./` only, no `..`, inside realRoot) into `plugin.mcpFiles[]`. `pluginServers()` merges them in load order. LST-006..011 findings on those servers, and LST-006 "path escapes plugin folder" / "path not found", are emitted at **info** with "(reported at rule severity from 1.3.0)". The MAN items for those servers are kept. Test: a fixture with `./config/mcp.json` holding an unpinned `npx` gives an info LST-008; `../x.json` gives an info LST-006; exit code unchanged.
- **A06-06** (medium): in a git work tree, list files with `git ls-files -z --cached --others --exclude-standard`. Otherwise skip `node_modules/`, `.venv/`, `venv/`, `__pycache__/` and dist caches with a note, and never read package configs under `node_modules/` or `site-packages/`. Test: a dependency's `.npmrc` no longer produces LST-009, and LST-013 does not count it.
- **A06-07**: `listingRuleChecked('LST-022')` also requires `!o.mcp?.error` and at least one server. Test: a broken `mcp.json` keeps the MAN-020/021 items whole.
- **A06-08**: the `--verbose` listing dump word-splits a string `command`, applies `displayUrl` to `scheme://` inside strings (also after `=`), and applies `maskKnownTokens` to all strings. Test: both shapes from the finding are redacted.
- **A09-02** (high): the pyproject header regex becomes `/^\[\[?([^\]]*)\]\]?\s*(#.*)?$/` with a trimmed key. Test: a 256 KB line runs in under 50 ms, with the same results on the existing pyproject tests.
- **A09-04** (medium): `env -S` expansion is limited to the wrapper limit (4), or done on a reversed stack. Test: 10k `-S` args are linear, in under 100 ms.
- **I-A06-7**: `walk()` uses `opendirSync` and stops at the 10,000-entry cap, sorting at the end. Test: a folder with 50k entries stops at the cap quickly.
- **I-A06-8**: the listings guide says which files `--plugin-dir` reads after A06-01 and A06-06, including the skipped dependency folders. Test: a `docs.test` anchor check.

**P7: reports, schema and redaction.** Owns `src/report/{index,text,markdown,junit,github,sarif,score,json,constants}.ts`, `schema/report.schema.json`, `src/redact.ts`, `src/protocol/trace.ts`. Tests: `test/r111-p7-reports.test.ts`, `test/r111-p7-redact.test.ts`, extended `test/r3-p7-schema.test.ts`.
- **A01-01** (medium, also covers A07-02 and A12-01): `buildReport(..., { drift: { failOn, changes, notCompared } })` sets `summary.failed`, appends the `gate.reason` text, gives the Result line `FAIL (... --fail-on-drift)`, adds one JUnit `<failure type="drift">` testcase per suite and one GitHub `::error` naming the changed tools. The exit code is unchanged; P1 passes the outcome. Test: a drift fixture checked in all five formats.
- **A07-03**: `stringifyReport` escapes `[\u007F-\u009F\p{Cf}  ]` as `\uXXXX` after `JSON.stringify` (the same value for every parser). Test: CSI, NEL and RLO survive a parse but do not appear raw in the bytes.
- **A07-04**: add the platform, format and transport words to `PLAIN_SETTING`, and `target`, `docs`, `fix` and `title` to `OWN_VOCABULARY` outside server data. Test: with `--env X=claude` the report validates against the schema and docs URLs are intact.
- **A07-05**: the schema `ruleId` pattern becomes `^([A-Z]+-\d{3}|INTERNAL)$`. Test: an INTERNAL report validates.
- **A07-06**: per-secret patterns let each URL-reserved character match itself or its `%XX` escape with hex in either case; one alternation per secret. Test: a lowercase and a partially percent-encoded echo are redacted.
- **A07-07**: `sarifText()` escapes `\`, `[` and `]` in `message.text` (and in BASE-001 through `baseline.ts`: P1 calls the exported helper). Test: `[x](https://evil)` is not a link in SARIF.
- **A10-02** (medium): in a listing-only run, a platform with no rule run (or no input of its own) gets INCOMPLETE "(not checked: no --openai-manifest)"; the exit code is unchanged. Test: plugin-only input gives `ChatGPT: INCOMPLETE`.
- **A10-05**: FIX SNIPPETS shows 10 lines and "+N more (--verbose for all)". Markdown uses `groupFindings`. JSON and SARIF are unchanged. (I-A09-2 is merged here.) Test: 400 tools give at most 15 snippet lines and markdown under 50 KB.
- **C-06**: with `baselined > 0`, every format labels the score "(all findings, N known)" and the verdicts "NO NEW AUTOMATED BLOCKERS"; the "N known from baseline" line stays under `--diff-only`. Test: text and markdown with `--diff-only`.
- **I-A07-3**: a table-driven schema test over every report shape: INTERNAL, drift with `--fail-on-drift`, a plain-name env equal to a platform, `--fail-on-incomplete`, a max-duration stop, budget exhaustion, listing-only, and an evil-string server.
- **I-A07-4**: pluralise the counts in the text and markdown score lines (`plural()`). Test: "1 error".
- **I-A07-5**: markdown verdict rows show per-platform error and warning counts. Test: `| Claude | BLOCKED (1 error) |`.
- **I-A07-7**: encoding-aware secret matching that also accepts `\uXXXX` and `\/` escapes for non-alphanumeric characters (extends A07-06). Test: a JSON-escaped echo is redacted.
- **I-A09-6**: `readBody` uses `Buffer.concat(chunks, size)` without `Buffer.from` copies. Test: unit equality, plus a peak-copy assertion with a spy.
- **I-A10-5**: a listing-only header names the plugin or manifest (`Plugin acme-notes · listing-only`). Test: text and markdown headers.
- Handoffs: the A01-06 safety net (`createRedactor` adds the `\u0000`-escaped form of each secret) is implemented here. The A13-02 report side turns `internalErrors` into INCOMPLETE with score null.

**P8: active probes.** Owns `src/probe/active.ts`, `src/protocol/modern.ts`, `src/probe/wire.ts`. Tests: `test/r111-p8-active.test.ts`.
- **A03-01** (medium): modern `tools/call` sends `Mcp-Param-{x-mcp-header}` headers built from the argument values (string, integer, boolean lowercase, and the `=?base64?…?=` form where needed). Test: the `modern-server.ts` fixture with an `x-mcp-header` param accepts the call, and there is no RT-003.
- **A03-03**: `Mcp-Name` uses the spec's `=?base64?…?=` encoding (non-ASCII, controls, edge whitespace, sentinel look-alike), with the encoder shared with A03-01. Test: a non-ASCII tool name gets no HeaderMismatch.
- **A03-04**: export `activeSkipReason(tool, all, limits)` with the real reason (readOnlyHint, destructiveHint, write verb, duplicate name, stopped). P1 uses it in the `--tool-args` "not used" warning. Test: four reasons.
- **I-A03-1**: wider write-verb list (upsert, append, restore, migrate, unpublish, charge, sign, vote, follow, retweet, launch, scale, resize, mount, format, encrypt/decrypt, rotate, configure, store, attach…) and camel/snake token splitting. Fewer calls, so this is patch-safe. Test: each listed name is skipped.
- **I-A03-3**: write each clientInfo variant to `ctx.into` as it finishes. Test: a stop during the third listing keeps two variants.

**P9: pipeline, Action and release docs.** Owns `action.yml`, `.pre-commit-hooks.yaml`, `.github/workflows/*.yml`, `.github/dependabot.yml`, `Dockerfile`, new `scripts/check-tree.mjs`, `README.md`, `SECURITY.md`, `docs/guide/ci.md`, `docs/guide/options-and-config.md`. Tests: `test/r111-p9-pipeline.test.ts`, `test/r3-p8-pipeline.test.ts`, `test/workflows.test.ts`.
- **A08-01** (medium): make the published hook installable. Reproduce first. Then either drop the git-dep build (`language: docker_image` with the ghcr image, or make the `repo: local` + `npx -y mcp-review-check@1.1` recipe primary and deprecate the `language: node` hook in docs), keeping the hook id. Fix the `ci.md` description. Test: a workflow job runs `pre-commit try-repo` on Linux.
- **A08-02**: the pack smoke extracts the tarball and runs `npm ci --omit=dev --ignore-scripts` in `package/`, so the shrinkwrap is honoured. Test: a workflow assertion in `test/workflows.test.ts`.
- **A08-03**: the Action rejects a `target` that is not `http(s)://` (exit 2). Test: a `--stdio=...` target is refused.
- **A08-04**: pin the binfmt and BuildKit images by digest, with the resolution date and a refresh-routine entry. Test: the workflow test finds no unpinned image.
- **A08-05**: README says "There is no moving `v1` ref"; SECURITY.md describes the 1.x support policy. Test: a docs test flags `0.x`/`v0` outside the CHANGELOG.
- **A12-06**: the four doc contradictions (the Action default `1.1`, the `--plugin-dir`/`--openai-manifest` rows, both `--fail-on-drift` advice variants, "json, sarif and junit"). Also generate the Action input table from `action.yml` and check it in `docs.test`.
- **A12-07**: the GitLab recipe uses `--fail-on-drift` only for `merge_request_event`, and adds a manual refresh job with `--save-baseline`. Test: a docs snapshot.
- **A12-09**: the Action rejects reserved options in `extra-args` (`--format`, `--output`, `--json-output`) with a pointer to the `sarif-file` input. Test: `extra-args: --format json` gives exit 2.
- **I-A08-1**: Dependabot `package-ecosystem: docker` for the Dockerfile digests. Test: a workflow-config assertion.
- **I-A08-2**: `actions/attest-build-provenance` for the pushed ghcr digest (`id-token`, `attestations: write`, `push-to-registry`). Test: a workflow assertion; manual `gh attestation verify` at release.
- **I-A08-3**: `scripts/check-tree.mjs` compares the installed tree with `npm-shrinkwrap.json`, and runs in the pack smoke, the Docker smoke and the Action test. Test: a unit test with a mismatched fixture.
- **I-A08-4**: the publish job uses a Node 24.x whose bundled npm is at least 11.5.1, asserts `npm --version`, and drops `npm install -g npm`. Test: a workflow assertion.
- **I-A08-6**: state the explicit no-moving-ref policy (pin a tag or SHA) next to A08-05. The moving-`v1` variant is rejected (section 4).
- Doc lines from other packages go here as well: the `mkdir` note for the A12-04 recipe, the A01-02 wording at `ci.md:57`, and the A01-04 `options-and-config.md` row.

**Handoffs in 1.1.1 (merge order).** P3 before P4 (`safeStr`). P7 before P1 (drift contract, `sarifText`). P8 before P1 (`activeSkipReason`). P2 before P4 (`DnsResult.servers`). P9 last (docs reflect the merged behaviour).

**CHANGELOG headline.** *1.1.1: fixes from review round 4. Three inputs that took tens of seconds now take milliseconds (importmap, pyproject header, env -S). Plugin MCP files named in plugin.json are read (reported at info until 1.3.0). A `--fail-on-drift` failure shows as FAIL in every format. Stderr, JSON and SARIF are neutralised against control characters and workflow commands. False positives fixed in AUTH-020, SRV-004, SPEC-010, SPEC-016, AUTH-016, DATA-001, INJ-001/002/003 and APPS-007. No rule added, no severity raised.*

### 2.2 Release 1.2.0: security detection (minor)

**Goal.** Close the injection and data-exfiltration detection gaps. All new matches are either deterministic markers (error) or heuristics (warning).

**S1: corpus coverage.** Owns `src/rules/util/text.ts`, `docs/design/spec.md` (§1.5, updated first per SDD). Tests: `test/r120-s1-corpus.test.ts`.
- **A05-01** (medium): `buildCorpus` pushes `description` from every schema node (root, items, anyOf/oneOf branches, `$defs`, additionalProperties) as `schema.description` with its pointer, and skips `$ref` revisits. Test: a payload in an `items.description` gets an INJ-005 error.
- **A11-01** (medium, also covers I-A05-4): push serverInfo name, title and description (initialize and discover), resource and template name and title, and prompt name, title and argument titles, with `where` values and a corpus-where opt-out for name-unsuited rules. Test: a payload in `serverInfo.description` and `prompt.title`.
- **A05-03** (medium): `scanForm` collapses `[\s\u0085 　]+` to one space after folding. Test: a double space, a tab and a newline in each rule family's error phrase still match.

**S2: injection rules.** Owns `src/rules/injection.ts`, `test/rules/injection.test.ts`. Tests: `test/r120-s2-injection.test.ts`.
- **A05-02** (medium): INJ-001 adds a `\p{Cc}` branch. ESC, U+009B and the C1 controls are hard (error); other C0 controls except `\t\n\r`, and a bare CR, are soft (warning). Source: Trail of Bits 2025. Test: an ANSI-hidden text gives an error; a tab gives nothing.
- **A05-04** (medium): INJ-005 adds `ignore` and determiners (`the|your|these|those|my`, an optional qualifier). It is an error when the qualifier or `your` is present; "ignore everything above" is a warning. Test: "Ignore the previous instructions" gives an error; "ignore case" is clean.
- **A05-10**: INJ-003 warns on chat-template markers (`<|im_start|>`, `[INST]`, `<<SYS>>`, `Human:` after a blank line) and on spaced pseudo-tags. Test: each marker gives a warning; a near miss stays clean.
- **I-A05-3**: INJ-004 gets a hex-pair branch (≥32 hex characters that decode to printable text) and base64url. Test: hex "ignore all previous…" is reported; a SHA-256 is clean.
- Wires S3's utilities into INJ-001, INJ-002 and INJ-005.

**S3: Unicode utilities.** Owns new `src/rules/util/unicode.ts`, new `src/rules/util/confusables-data.ts`, new `scripts/gen-confusables.mjs`. Tests: `test/r120-s3-unicode.test.ts`.
- **I-A05-2**: decode tag-character payloads (and variation-selector byte smuggling) to ASCII. INJ-001 shows the decoded text (capped), and INJ-005 scans it. Test: a tag-encoded "ignore all previous instructions" gets an error with the decoded quote.
- **I-A05-6**: a UTS #39 confusable skeleton for non-Latin words in Latin-majority text. INJ-002 warns when the skeleton is an ASCII word. Generated data is dated. Test: Cyrillic "рау" and "Аррlе" are flagged; a genuine Russian sentence is clean.
- **I-A05-7**: tighter single-VS bases (FE0E/FE0F after emoji only; StandardizedVariants or FE00–FE02 after Han). Any other single VS is soft. Test: VS-per-character after CJK gives a warning; ︎/️ after emoji is clean.

**S4: domains and origins.** Owns `src/rules/util/net.ts`, new `src/rules/util/psl-data.ts`, new `scripts/update-psl.mjs`, `src/rules/apps.ts`, `src/rules/util/html.ts`. Tests: `test/r120-s4-domains.test.ts`.
- **I-A05-1**: vendor a dated Public Suffix List (ICANN and private sections) for `registrableDomain` and APPS-006. Add a refresh script and a date check like the catalog date. Test: `*.com.ua`, `*.s3.eu-west-1.amazonaws.com`, `*.githubusercontent.com` and `*.supabase.co` are flagged.
- **I-A05-5**: APPS-007 reports at info any absolute `http(s)`/`wss` string literal in `<script>` that no CSP list covers ("possible connect origin"). Existing confidence levels are unchanged. Test: `const u='https://x'; fetch(u)` gives an info finding.
- **C-04**: `isNonPublicIPv6` unwraps embedded IPv4 (`::/96`, `::ffff:0:0/96`, `64:ff9b::/96`, `2002::/16`) and adds `100::/64`, `fec0::/10`, Teredo and `192.88.99.0/24`. Test: a table over each form, including the APPS-006 and SRV-004 consumers.

**S5: policy, false-positive gate and docs.** Owns `src/rules/policy.ts`, new `test/r120-fp-gate.test.ts`, `README.md` (Limitations). Tests: as named.
- **I-A11-5**: POL-003's ENDORSE pattern also runs over the serverInfo name and title (the corpus from S1) and warns on implied OpenAI or Anthropic endorsement. Test: "Official ChatGPT Betting" as the server name is flagged.
- The FP gate runs the whole catalog over `test/fixtures/real/*`. It fails when any S1–S4 change adds an error on a listed server; new warnings are reviewed and listed in the CHANGELOG. README Limitations is updated for the PSL and for runtime origins.

**Handoffs.** S1 before S2 and S5 (corpus `where` values). S3 before S2 (utility exports).

**CHANGELOG headline.** *1.2.0: security detection. Scanning covers serverInfo, prompt and resource names, and every schema description. Matches survive tabs and double spaces. INJ-001 catches ANSI/C1 controls and decodes tag-character payloads. INJ-005 catches "ignore the previous instructions". INJ-003 catches chat-template markers. INJ-002 catches whole-word confusables. APPS-006 uses the Public Suffix List. Severity raised: INJ-001/003/004/005, INJ-002, APPS-006/007, POL-003.*

### 2.3 Release 1.3.0: listing checks from the directory gap analysis (minor)

**Goal.** Cover the Claude plugin pre-submission checklist and the ChatGPT package limits that can be checked offline and deterministically. Also finish A06-01 at the rules' own severity.

**L1: existing LST rules.** Owns `src/rules/listing.ts`, `src/rules/index.ts`. Tests: `test/r130-l1-listing.test.ts`, cases in `test/rules/listing.test.ts`.
- **A06-01** (second half): findings on servers from referenced plugin MCP files, and the LST-006 path errors, move from info to the rule's own severity (CHANGELOG "Severity raised"). Test: the 1.1.1 fixture now gives an LST-008 error.
- **A06-02** (medium): LST-024 reports an error for an inline `mcpServers` object and for a path other than `./.mcp.json`/`.mcp.json`. An inline object is still read so that LST-023/024 can check it. Test: both shapes.
- **A06-03** (medium): an SVG icon without a numeric viewBox or width/height is an error, with the documented wording. Test: a viewBox-less SVG icon.
- **A06-09**: LST-028 reports an error for screenshots in a skills-only package, and when a server was checked without a UI template. Test: both cases.
- **A06-10**: LST-002 warns on `claude`/`anthropic` as a whole word. It reports an error for invisible characters or mixed scripts in `displayName`/`author.name` (reusing the hidden-character detector). Test: `my-claude-tool` gives a warning; a Cyrillic "а" in displayName gives an error.
- **I-A06-1**: LST-013 reports "validation stops": any file over 5 MiB, Windows-invalid names, case-only collisions, `.gitattributes` export-ignore/export-subst/filter (error). Test: one fixture per case.
- **I-A06-2**: warnings (held for a reviewer) for a server started through `sh -c`, `-c` programs or `npm run`, and for package.json next to a lockfile at the plugin root. Test: both cases.
- **I-A06-4**: LST-013 warns about a top-level `bin/` folder (claude.ai and Cowork do not install the plugin). Test: a `bin/` fixture.
- **I-A06-5**: `homepage` must parse as a URL (error). Test: `homepage: "not a url"`.
- Registers the L2 and L3 rule arrays in `src/rules/index.ts`.

**L2: plugin loader and new plugin rules.** Owns `src/listing/load.ts`, `src/listing/types.ts`, `src/listing/index.ts`, new `src/rules/listing-plugin.ts`. Tests: `test/r130-l2-plugin.test.ts`, fixtures `test/fixtures/listing/plugin-checklist-*`.
- **I-A06-3**: new LST rules (next free ids). Errors for `hooks/hooks.json` that is not valid JSON, lacks top-level `hooks`/`modules`, uses an unknown event or type, or has a non-https HTTP hook. Errors for component paths that do not start with `./`, do not exist or leave the folder. Test: one fixture per case.
- **I-A11-2** (the part not covered by A06-10 and I-A06-1/2/3): component keys misspelled or placed under `experimental`; skill, command and agent front matter that does not parse or has a non-string description; wrong component folder or file capitalization (`hooks/`, `skills/`, `SKILL.md`); a credential read from an env var such as `$GITHUB_TOKEN` (warning). Test: one fixture per case.
- Provides the loader data (sizes, names, `.gitattributes`, hooks, front matter, OpenAI manifest fields) to L1 and L3.

**L3: ChatGPT package rules.** Owns new `src/rules/listing-openai.ts`. Tests: `test/r130-l3-openai.test.ts`.
- **I-A11-3**: new LST rules for the package `name` (≤64, pattern), explicit semver `version` (≤64), plugin description (≤1,024 and the 4,000 page limit, both cited), `author.name`/email/URL and `homepage` lengths and https, `skills/get-started/SKILL.md` front matter and lengths, translations (locale key, one-line subtitle ≤30, description ≤4,000, no tabs or control characters), and a protected server configured as `none` (cross-checked with `authProbe`). Test: one positive and one near-miss per limit.

**L4: images.** Owns `src/listing/image.ts`. Tests: `test/r130-l4-image.test.ts`.
- **A06-04**: `svgSize` scans the root start tag up to the first `>` outside quotes. Test: `<svg data-x="a>b" width="64" height="64">` has size 64.
- **I-A06-6**: read the EXIF orientation of JPEG screenshots and swap width and height for 5–8. Test: a rotated 706×500 JPEG fixture.

**L5: manual checklist, apps message and guide.** Owns `src/rules/manual.ts`, `src/rules/apps.ts`, `docs/guide/listings.md`. Tests: `test/r130-l5-manual.test.ts`.
- **I-A11-9**: the ChatGPT APPS-008 message names `frame_domain_explanation_required`, and the MAN items list each external frame domain. Test: message and checklist snapshot.
- MAN items that L1–L3 now automate say "the rest is checked by LST-0xx"; the listings guide documents every new rule.

**Handoffs.** L2 before L1 and L3 (loader data). L1 registers the rule arrays from L2 and L3.

**CHANGELOG headline.** *1.3.0: plugin and package checks from the directory pages. Rules added for hooks.json, component paths, front matter and the ChatGPT package limits. LST-013 covers the checklist's "validation stops" items. Severity raised: plugin MCP files referenced from plugin.json (A06-01), SVG icons without dimensions, inline ChatGPT `mcpServers`, and screenshots in skills-only packages.*

### 2.4 Release 1.4.0: CI integration and machine-readable reports (minor)

**Goal.** Make the Action, SARIF, JUnit and JSON describe the run's outcome correctly, and remove first-run and cold-start friction in CI.

**C1: code-scanning outputs.** Owns `src/report/sarif.ts`, `src/report/github.ts`. Tests: `test/r140-c1-sarif.test.ts`.
- **A07-08** (medium): add `run.invocations[{executionSuccessful, exitCode, toolExecutionNotifications}]`. The Action half is in C5. Test: a connect-failed SARIF has `executionSuccessful: false` and validates against the 2.1.0 schema.
- **I-A07-6**: SARIF `run.properties.summary` gains `rootCauses` and `coverage.toolLevel`/reason. Test: a schema check plus field presence.
- **I-A12-6**: SARIF rules get `help.markdown`, `defaultConfiguration.level`, and `tags: ['security']` with `security-severity` for INJ, AUTH and DATA. Test: SARIF snapshot fields.
- **I-A09-1**: group GitHub annotations by rule and message (count plus the first 3 subjects), with a total cap and one overflow line. Test: 20,000 tools give at most 50 annotation lines.
- **I-A10-2**: LST findings carry `physicalLocation` and `file=` relative to the repository, from the listing source file. Test: a plugin fixture shows `.claude-plugin/plugin.json` in SARIF and in the annotations.

**C2: report outcome fields.** Owns `src/report/index.ts`, `src/report/json.ts`, `src/report/junit.ts`, `src/report/text.ts`, `src/report/markdown.ts`, `schema/report.schema.json`. Tests: `test/r140-c2-outcome.test.ts`.
- **I-A07-2**: `summary.exitCode` and `summary.failedBy[]` (`gate | incomplete | drift | connect | stopped | internal`), plus `limits.requests` from C6. Test: one row of the schema matrix per cause.
- **A13-02** (second half): `--fail-on-incomplete` also gates on `internalErrors` (exit 3), listed under "Changed". Test: an injected throwing rule with the flag exits 3.

**C3: baseline and drift.** Owns `src/baseline.ts`, `src/report/drift.ts`. Tests: `test/r140-c3-baseline.test.ts`.
- **I-A01-4**: BASE-001 `partialFingerprints` include the sorted changed fields and the new sha256. Test: two different changes to one tool give different fingerprints.
- **I-A01-6**: an opt-in lean baseline (`--baseline-format lean`, config key `baselineFormat`) holding only findings keys and `toolFingerprints`, still valid for `--baseline`. Making it the default is a 2.0 note. Test: a round trip with a lean baseline, and the file is under 10% of the full size on a fixture.

**C4: CLI options.** Owns `src/cli.ts`, `src/config.ts`, `docs/guide/options-and-config.md`. Tests: `test/r140-c4-cli.test.ts`.
- **I-A01-1**: `--baseline-optional` (config `baselineOptional`). A missing baseline file means no baseline, with a stderr note, and drift reads "not compared" without failing. Test: the first run with `failOnDrift` in config exits 0.
- **I-A10-4**: `--timeout` and `--max-duration` accept `ms`, `s` and `m` suffixes; a bare number stays milliseconds. Test: `5s` equals `5000`.
- Wires the C3 flags and the C6 `--connect-timeout` flag.

**C5: GitHub Action.** Owns `action.yml`, `docs/guide/ci.md`, `test/remediation-w4d-action.test.ts`, `test/remediation-w5d-action.test.ts`. Tests: `test/r140-c5-action.test.ts`.
- **A12-02** (medium): `platform` and `fail-on` default to `''` and are passed only when set, so the config file applies. This changes behaviour for config users; listed under "Changed". Test: a config with `failOn: warning` is honoured.
- **A12-03** (medium): `sarif-location` and `category` inputs, the upload's `category`, and a "Several servers in one repository" recipe. Test: two Action invocations produce different `automationDetails.id`.
- **I-A12-7**: inputs `working-directory`, `baseline`, `fail-on-incomplete`, `fail-on-drift`; output `tool-changes`. Test: each input maps to the flag; the output is set from the JSON.
- **I-A12-8**: cache the npm install keyed on the resolved version (`actions/cache` pinned by SHA). Test: a workflow assertion.
- A07-08, Action half: upload SARIF only on exit 0 or 1, or behind `upload-sarif-on-incomplete`. The doc says a partial run does not replace the analysis. Test: exit 3 does not upload.

**C6: transport timing and request count.** Owns `src/connect.ts`, `src/probe/network.ts`, `src/protocol/trace.ts`, `docs/guide/privacy-and-requests.md`. Tests: `test/r140-c6-transport.test.ts`.
- **I-A02-2**: `--connect-timeout <ms>` (config `connectTimeout`, default 15000) lifts the HTTP handshake cap. Test: a server that answers in 20 s connects with `--connect-timeout 25s`.
- **I-A03-5**: count requests per run (`{total, byLabel}`) and print one stderr summary line. The privacy guide quotes the count. Test: the fixture run total equals the sum of labels.

**Handoffs.** C6 and C3 before C4 (flags). C1 and C2 before C5 (fields the Action reads).

**CHANGELOG headline.** *1.4.0: CI integration. The Action honours the config file and gains working-directory, baseline, drift, incomplete and SARIF category inputs and a tool-changes output. SARIF says whether the run succeeded, carries GitHub security severities and anchors listing findings to files. JSON gains `summary.exitCode`/`failedBy` and the request count. New `--baseline-optional`, `--connect-timeout`, a lean baseline format, and time units.*

### 2.5 Release 1.5.0: protocol and spec checks (minor)

**Goal.** Add the deterministic MCP spec checks and the directory-policy heuristics found in the gap analysis. New probes are read-only and documented.

**R1: server rules.** Owns `src/rules/server.ts`. Tests: `test/r150-r1-server.test.ts`.
- **A04-07**: SRV-006 handles 303, and says that a POST becomes GET. Test: a cross-host 303 is reported.
- **A11-02**: SRV-003 severity `{claude: warning, chatgpt: error, spec: warning}`, with the OpenAI production-endpoint source and a severity note. Test: an SSE-only fixture gives a ChatGPT error.
- **C-03**: SRV-008 gives a spec warning when a foreign Origin gets a 4xx other than 403/401 and no Origin gets 2xx. Test: a 400 rejection.
- SRV-015 info for `taskSupport: 'required'` (the Claude half of I-A11-7).

**R2: spec rules.** Owns `src/rules/spec.ts`. Tests: `test/r150-r2-spec.test.ts`.
- **I-A11-1**: new SPEC-025 checks prompts/list, resources/list and templates/list entries against the schema (`name`, `uri`, `PromptArgument.required` boolean, `mimeType` string, RFC 6570 `uriTemplate`). It is a spec error. Test: `raw-server`-style fixture items.
- **I-A11-6**: SPEC-021 validates elicitation `inputRequests` (a flat primitive `requestedSchema`; URL mode with https). Test: a nested schema and an http URL.
- **I-A11-7**: a spec error for an unknown `Tool.execution.taskSupport` value. Test: `taskSupport: 'sometimes'`.
- **I-C-2**: a notification POST must get 202 with no body (spec error), read from the recorded `notifications/initialized` exchange. Test: a fixture that answers 200 with a body.
- Consumes R3 data: SPEC-016 warns on unsolicited responses (C-02); SPEC-014 judges the version and Mcp-Name probes (I-C-1); SPEC-024 runs on stdio and SSE (I-A02-1).

**R3: transport recording and wire probes.** Owns `src/protocol/recording.ts`, `src/protocol/trace.ts`, `src/connect.ts`, `src/probe/wire.ts`, `src/snapshot.ts`, `schema/report.schema.json`, `src/report/json.ts`, `docs/guide/privacy-and-requests.md`, `SECURITY.md`. Tests: `test/r150-r3-wire.test.ts`.
- **C-02**: `record()` notes unsolicited responses (a count and the first ids), also for results. Test: a fixture that sends an unknown-id response.
- **I-A02-1** (also covers I-A04-1): tally notifications from RecordingTransport on stdio, HTTP+SSE and the standalone GET stream, so SPEC-024 needs no `http`. Test: a stdio server sending `notifications/message` without the logging capability gets SPEC-024.
- **I-C-1**: read-only probes for a protocol-version header mismatch on tools/list, a missing header on modern-only servers, and an Mcp-Name mismatch on resources/read or prompts/get (never tools/call). They are listed in the privacy guide and SECURITY.md. Test: a non-validating fixture gets SPEC-014.
- **I-C-3**: `transport.errors {count, first[]}` in JSON and `--verbose`. Test: a parse-failure fixture.

**R4: auth.** Owns `src/rules/auth.ts`, `src/probe/auth.ts`. Tests: `test/r150-r4-auth.test.ts`.
- **I-A04-2**: AUTH-003 notes (spec warning, SHOULD) a 403 `insufficient_scope` challenge without `resource_metadata`. Test: a 403 challenge fixture.
- **I-A04-4**: when `--active-auth` ran with a placeholder client_id, show one AUTH-019 info "inconclusive" and the reason. Test: a CIMD-only AS fixture.

**R5: policy, apps and checklist.** Owns `src/rules/policy.ts`, `src/rules/lexicon.ts`, `src/rules/apps.ts`, `src/rules/manual.ts`. Tests: `test/r150-r5-policy.test.ts`.
- **I-A11-4**: new POL-006 (warning, heuristic) for prohibited categories: adult content, gambling, drugs, weapons, tobacco, malware and surveillance, fake IDs. Test: `place_bet` and `adult_videos` are flagged; near misses (a "bet" in statistics, "adult education") are clean.
- **I-A11-8**: APPS-017 gives a Claude info when camera, microphone or geolocation is requested (not available on mobile). Test: a permissions fixture.
- **I-A11-10**: a conditional MAN item (and an info heuristic) for legal, healthcare, insurance and finance: human-in-the-loop and disclosure. Test: a medical tool text adds the MAN item.

**Handoffs.** R3 before R2. R1 and R2 merge in either order.

**CHANGELOG headline.** *1.5.0: spec and policy checks. Added SPEC-025 (list-entry schema) and POL-006 (prohibited categories). Added checks for notification 202, elicitation input requests, `taskSupport`, header mismatch probes and unsolicited responses. SPEC-024 now also runs for stdio. Severity raised: SRV-003 for ChatGPT, SRV-006 (303), SRV-008 (non-403).*

### 2.6 Release 1.6.0: config, suppression and onboarding (minor)

**Goal.** Make first runs, per-finding decisions and upgrades easy for integrators.

**O1: per-finding suppression.** Owns new `src/suppress.ts`, `src/rules/engine.ts`, `src/report/sarif.ts`, `src/report/junit.ts`, `src/report/text.ts`, `schema/report.schema.json`. Tests: `test/r160-o1-suppress.test.ts`.
- **I-A12-1**: config `suppress: [{rule, tool|resource, path, reason, expires}]`, matched on the baseline subject key. Suppressed findings go to `ignored[]` with the reason, and to SARIF `suppressions[{kind:'external', justification}]`. A suppression or `--ignore` that matched nothing gives a warning; an expired one is a usage error. Test: a matched, a stale and an expired entry, and SARIF suppressions validate.

**O2: config schema.** Owns `src/config.ts`, new `schema/config.schema.json`, new `scripts/config-schema.mjs`, `package.json` (`files`). Tests: `test/r160-o2-config-schema.test.ts`.
- **I-A12-4**: generate `schema/config.schema.json` from `KEYS`, ship it, and accept and ignore `"$schema"`. Test: the schema is regenerated in CI and matches `KEYS`; `$schema` is accepted; an unknown key is still an error.
- Parses `suppress` for O1.

**O3: CLI and catalog metadata.** Owns `src/cli.ts`, `src/explain.ts`, `src/catalog.ts`, new `src/rules/history.ts`, `scripts/rules-table.mjs`, `docs/RULES.md` (generated). Tests: `test/r160-o3-catalog.test.ts`.
- **I-A12-5**: `addedIn`, `severityRaisedIn` and `kind: deterministic|heuristic` per rule, from a history table keyed by id. They appear in `--list-rules --format json` and SARIF rule properties (handoff to O1), and `--list-rules --since 1.0` lists only those. Test: every rule has a kind; `--since 1.1` lists TOOL-036.
- Dispatches `mcp-review-check init` to O4.

**O4: `init`.** Owns new `src/init.ts`. Tests: `test/r160-o4-init.test.ts`.
- **I-A12-3**: `init` writes a commented starter config (server detected from package.json `bin`/`main` or `.mcp.json`) and runs `mkdir .mcp-review-check`. It writes the first baseline with `--fail-on never` and prints the GitHub Action or GitLab snippet. It never overwrites an existing file. Test: a temp repo with a `bin` script, run twice.

**O5: docs.** Owns `docs/guide/options-and-config.md`, `docs/guide/ci.md`, `docs/guide/walkthrough.md`, `README.md` (quick start). It documents I-A12-1, I-A12-3, I-A12-4 and I-A12-5 (no ids of its own). Test: `docs.test` anchors and generated-section checks.

**Handoffs.** O2 before O1 (the key). O3 before O4 (dispatch). O1 adds the SARIF rule properties from O3.

**CHANGELOG headline.** *1.6.0: suppressions with reasons and expiry (also as SARIF suppressions), a JSON Schema for the config file, `mcp-review-check init`, and rule history (`addedIn`, `kind`) with `--list-rules --since`.*

### 2.7 Release 1.7.0: engine, active probes and extension points (minor)

**Goal.** Make `--max-duration` a hard bound, give teams a safe extension point, let reviewers approve active calls, and shrink the shipped dependency tree.

**E1: rule-phase deadline.** Owns `src/rules/engine.ts`, new `src/rules/worker.ts`, `src/limits.ts`. Tests: `test/r170-e1-worker.test.ts`.
- **I-A09-4**: run `runRules` (and the report-time `uiResources`/counts) in a `worker_thread` that is terminated at the deadline, with exit 4 and `limits.stopped.phase: rules`. Test: a rule that sleeps forever is stopped at the deadline.
- **I-A13-4**: per-rule timing, with the 5 slowest rules in `--verbose` (printed by E3). Test: the timing list is present and sorted.

**E2: declarative custom checks.** Owns new `src/rules/custom.ts`. Tests: `test/r170-e2-custom.test.ts`.
- **I-A13-6**: `custom` checks from an explicit `--config` only (never a discovered file). Ids are `X-…`, severity is warning or info only, and they do pattern matching over `corpus()` and tool, annotation and `_meta` keys. No user code is executed. Test: a forbidden tool-name pattern fires; a discovered config's `custom` key is refused with a note.

**E3: active probes and CLI.** Owns `src/probe/active.ts`, `src/cli.ts`, `src/config.ts`, `docs/guide/privacy-and-requests.md`, `docs/guide/options-and-config.md`. Tests: `test/r170-e3-active.test.ts`.
- **I-A03-2**: `--active-tools <name|glob>` (an allowlist that is still intersected with the read-only filter) and `--active-dry-run`, which prints the planned calls and synthesized arguments and sends nothing. Test: the dry run makes no tools/call request; the allowlist limits calls.
- **I-A03-4**: argument synthesis handles `prefixItems`, `allOf` with properties and required, and a top-level `$ref`/`allOf`. Synthetic calls that fail validation produce a coverage note. Test: pydantic tuple and allOf fixtures produce valid arguments.
- Parses E2's `custom` key (calling `parseCustomChecks`) and prints E1's timings.

**E4: schema walker.** Owns `src/rules/util/schemaWalk.ts`. Tests: `test/r170-e4-walk.test.ts`.
- **I-A05-8**: visit a shared `$ref` target once per referencing property, keyed by node and rawName and bounded by MAX_DEPTH and a node budget. Test: `a` and `action` both reference an enum, and TOOL-024 sees both.

**E5: dependency tree.** Owns `package.json`, `npm-shrinkwrap.json` (generated), `scripts/shrinkwrap.mjs`, `scripts/check-tree.mjs`, `.github/workflows/ci.yml`. Tests: `test/r170-e5-deps.test.ts`.
- **I-A08-5**: spike first. List the SDK subpaths the CLI imports, then choose between asking upstream for optional server deps and bundling the client and transport pieces into `dist` (with SDK license notices). Add a CI guard on the prod package count. Test: the package-count guard, and the pack smoke still passes on three OSes.

**Handoffs.** E2 before E3. E1 before E3.

**CHANGELOG headline.** *1.7.0: `--max-duration` is a hard bound for the rules (worker thread), declarative custom checks in an explicit config, `--active-tools` and `--active-dry-run`, better argument synthesis, and a smaller runtime dependency tree.*

### 2.8 Release 1.8.0: several servers in one config and one run (minor)

**Goal.** Monorepo support without a matrix of jobs.

**M1: config.** Owns `src/config.ts`. Tests: `test/r180-m1-config.test.ts`. Adds the `servers: {name: {url|stdio, cwd, env, header, baseline, …}}` map with per-server overrides and validation (only in an explicit or discovered config, under the A01-01 trust rules of 1.0.1). It supports I-A12-2.

**M2: CLI orchestration.** Owns `src/cli.ts`. Tests: `test/r180-m2-multi.test.ts`.
- **I-A12-2**: `--server <name>` picks one server; otherwise every server runs in turn. Output files take a `{server}` placeholder. JSON to stdout with several servers is a usage error. The exit code is the most severe by the existing precedence (2 > 3 > 4 > 1 > 0). Test: two fixture servers, exit-code aggregation, and per-server JSON files.

**M3: SARIF and JUnit.** Owns `src/report/sarif.ts`, `src/report/junit.ts`, `src/report/github.ts`, `src/report/markdown.ts`. Tests: `test/r180-m3-reports.test.ts`.
- **I-A12-9**: `--report-name` (and, with `servers`, the server name) goes into the JUnit suite names and classnames and into one SARIF run per server, each with its own `automationDetails.id`. The default naming for a single server is unchanged (see the 2.0 notes). Test: two servers give distinct suites and runs.

**M4: baselines per server.** Owns `src/baseline.ts`, `src/report/drift.ts`. Tests: `test/r180-m4-baseline.test.ts`. Per-server baseline paths and drift, using I-A01-6's lean format when chosen. It supports I-A12-2.

**M5: Action and docs.** Owns `action.yml`, `docs/guide/ci.md`, `docs/guide/options-and-config.md`. Tests: `test/r180-m5-action.test.ts`. A `servers` input that takes all or a list, one SARIF upload per run category, and a monorepo recipe. It supports I-A12-2.

**Handoffs.** M1 before M2 and M4. M3 before M5.

**CHANGELOG headline.** *1.8.0: several servers in one config (`servers`, `--server`), with one SARIF run, JUnit suite and baseline per server.*

## 3. Id scheme

Finding ids are as in FINDINGS.md (A01-01 … A13-03, C-01 … C-06). Improvement ids are `I-<area>-<n>`, numbered in the order they appear in `workflow-result.json` (A01..A13), then `I-C-<n>` for the critic. The full mapping of every id to a release and package is in the assignment table that goes with this plan.

## 4. 2.0 notes and Rejected

**2.0 notes.** Each of these is a breaking follow-up. None blocks the 1.x item it comes from, which ships in a compatible form.

1. **Lean baseline by default** (I-A01-6). 1.4.0 adds it as opt-in. Making `--save-baseline` write the lean document by default changes the documented content of a file that some users read as a full report.
2. **An internal rule error fails the run with exit 3** (A13-02 alternative). This changes the meaning of exit codes for runs without `--fail-on-incomplete`. 1.x uses INCOMPLETE plus `--fail-on-incomplete` instead.
3. **JUnit suite and classname include the server name by default** (I-A12-9). That is a JUnit structure change for existing dashboards, so 1.8.0 makes it opt-in (`--report-name`, or with `servers`).
4. **Retire the `language: node` pre-commit hook id**, if A08-01 ends up replacing it with another hook id. 1.1.1 keeps the id working or deprecated.

**Rejected** (only sub-options; no whole item is rejected):

- The moving `v1` tag in I-A08-6. It contradicts the SHA-pinning recommendation and the release guard, so the explicit no-moving-ref policy is chosen instead.
- `"//"` comment keys in the config file (part of I-A12-4). They would weaken the unknown-key error that catches typos. Only `"$schema"` is accepted.
- `--force-save-baseline` (optional part of A01-03). A01-02 and A01-03 already prevent a bad run from replacing a baseline, so the extra flag adds surface without a case.

## 5. Execution notes

- **One workflow per release**, in order: 1.1.1, 1.2.0, …, 1.8.0. A release starts only after the previous one is tagged. All agents run on Opus (user choice). Each package runs in its own worktree from `origin/main`, with the disjoint files listed above. Agents do not run the whole suite (SPEC D1). Each package runs typecheck, build, its own new test files and the existing test files of the modules it owns.
- **Per package**: a test per item that fails before the change and passes after it; SDD first where the design spec is affected (S1 §1.5 corpus, the new rules in L2/L3/R2/R5, the worker in E1); a CHANGELOG fragment in the package report, not in `CHANGELOG.md`, so packages do not collide.
- **Review per package**: one adversarial Opus reviewer per package, then a fixer for high and medium review findings, then re-review. Security-relevant packages (1.1.1 P2, P7, P8, P9; 1.2.0 S1–S4; 1.4.0 C5; 1.5.0 R3; 1.7.0 E2, E3) also get a reviewer who tries to bypass the fix.
- **Handoffs**: the merge order listed in each release. A package that needs a line in a file it does not own describes the change in its report, and the owner (or the integrator) applies it. No package edits another package's files.
- **Integration and release** (maintainer session): rebase each package in the stated order and fast-forward push (no force push, linear history). Run the full suite with the CI environment and the regex guard. On minors, run the FP gate over `test/fixtures/real/*`. Move the package fragments into `CHANGELOG.md` under the right headings ("Rules added", "Severity raised", "Severity lowered / false positives fixed", "Changed", "Security"). Then `npm version`, `npm run build && npm run readme:rules` (`docs/RULES.md`, the README markers, `docs/design/spec.md`), and on a minor the `action.yml` `version` default and the `@MAJOR.MINOR` references in README and `docs/guide`. Wait for CI green on three OSes for the head of `main`, tag `vX.Y.Z` on that commit, and let the release guard, npm trusted publishing with provenance (checked by `verify-provenance`), the GitHub release, and the ghcr image (with the new attestation from 1.1.1) run. Check the npm provenance and the image digest afterwards. Commits carry no co-author trailer.
- **Docs**: edits to `docs/guide/**`, `README.md` and `SECURITY.md` are allowed now when they document new behaviour; each is owned by exactly one package per release as listed. `docs/launch/**` stays untouched. The design spec (`docs/design/spec.md`) changes with the packages that change the design.
- **Approval**: pushing, tagging and publishing follow the user's standing approval rule for this roadmap. Nothing is posted outside the repository.
- **Status log** (to append as work proceeds):

| When | Event |
|---|---|
| 2026-11-04 | Review round 4 recorded at `ddfe1b0` (88 confirmed, 1 disputed, 3 refuted; 92 improvements). Remediation plan written: 1.1.1 plus seven minors, 9/5/5/6/5/5/5/5 packages. |
