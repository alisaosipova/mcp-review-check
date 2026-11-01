# WP6-inj-data-pol: remediation report

> Package: `src/rules/{injection,data,policy,lexicon}.ts`. Branch `worktree-wf_365c0c99-4d0-6`.
> 20 items: 19 done, 1 deferred. Rule severities and rule metadata (titles, rationale, fix) are unchanged, so `docs/RULES.md` needs no regeneration.

## Done

| ID | Sev | Commit | What changed |
|---|---|---|---|
| F087 | medium | a1cbfd0 | DATA-001: bare `transcript` moved from the strong names (error) to the weak names (warning, skipped for integer/number/boolean). `chat_transcript` and the new `conversation_transcript` stay errors. |
| F082 | medium | 87d31a5 | POL-002: the media noun must end the word (`s?(?![a-z])`), so `create_article`, `edit_clipboard`, `edit_voicemail`, `make_artifact`, `create_soundboard` are not media generation; `tts` gets the same end. |
| F088 | medium | 4eadcf9 | DATA-002: `memory` counts only with an owner (Claude's / assistant's / model's / host's, your / chat / conversation memory, memory of the conversation); VM, GPU, container and knowledge-graph memory are clean. |
| F093 | medium | 9b6d78c, e9ca123 | INJ-007 / RT-011: the connector pattern is `ownToolExempt` and judged by the captured product phrase; `this`, `these`, `our` are self references, so "Use this app to …" and "Use our app" are clean. |
| F097 | low | 9b6d78c, e9ca123 | INJ-007 / RT-011: the brand pattern (`slack connector` …) is `ownToolExempt`; a product phrase whose every word appears in `serverInfo.name`/`title` is the server's own. "the Acme Billing app" on the Acme Notes server and "the Gmail connector" on the Slack server stay findings. |
| F083 | medium | 72293a3 | POL-001: name matched by tokens (`moneyName`): transfer verbs (transfer, wire, pay, payment, payout, withdraw(al), deposit, remit(tance), swap, bridge, stake, trade) as whole tokens, compounds (place order, execute trade …) on adjacent tokens, and send/buy/sell only with a money word in the name. `get_bestsellers`, `list_stakeholders`, `send_email`, `update_wireframe`, `register_trademark` are clean. |
| F098 | low | 95a3d3a | DATA-001 text heuristic: `all messages` needs a `chat`/`conversation` qualifier; previous/prior messages unchanged. |
| F086 | low | d01a339 | DATA-003: new warning branch for compound names whose last segment is a secret (`new_password`, `github_token`, `aws_secret_access_key`, `credentials`, `authorization`); pagination/count tokens and non-text types are skipped. Exact names stay at the rule severity (chatgpt error). Follows the arbiter: warning, not `isSecretName` at error level. |
| F113 | low (impr.) | 0c3c5db | DATA-004: errors also for `card_cvc`, `cvv_code`, `card_security_code`, `card_exp(_month/_year/_date)`, `passport_no/num/id`, `aadhaar`, `ssn_last4`; warnings for `exp_month`, `exp_year`, `routing_number`, `(bank_)account_number`, `bank_account`, `license_number`, `nino`, `sin`. |
| F089 | low | 1567206 | DATA-005: skip boolean parameters (`long` output flag), `format` email/ipv4/ipv6/uri/hostname/mac, and an `address` whose description names a wallet, contract, e-mail, IP, MAC, chain or `0x…`. |
| F090 | low | 31dfda4 | INJ-001: the ZWJ exemption looks past VS15/VS16 and skin-tone modifiers (U+1F3FB–1F3FF) for the neighbouring pictographs (❤️‍🔥, 👩🏽‍💻, 🏳️‍🌈, 🧑🏿‍🚀). |
| F091 | low | 0ae8849 | INJ-002: Greek counts only for letters that pass for Latin (Α Β Ε … ο ρ υ ν χ …); μs, kΩ, ΔT, μg are clean. Cyrillic unchanged. |
| F110 | low | cd41bee | INJ-004: percent runs are decoded; a run that decodes to UTF-8 without ASCII letters (Russian/Japanese URL examples) is clean, invalid UTF-8 or hidden ASCII text is still flagged; every escape run is checked, not only the first. |
| F095 | low | b2a3aee | INJ-005 warnings: `user` followed by avatar/name/id/generated/content/… is a modifier, not the addressee; "you are now connected/signed/logged/…" is a status report. |
| F111 | low | a67462e | INJ-006 pattern 2: the object must be a whole `tool(s)`, `search`, `web search`, `browsing`, `browser` or `plugin(s)` word; "rather than the default full web page" is clean. |
| F092 | low | 7e5b722 | INJ-006 / RT-011: `better than` / `superior to` before a number, threshold, average, baseline, score, previous … is a value comparison. "Our search is better than Google." stays a warning (content.test.ts:208). |
| F096 | low | 4f6be57 | INJ-008: a quantifier followed (within two words) by about / regarding / related to / concerning / involving is a scope hint. |
| F094 | low | 0f9ef95 | INJ-009 pattern 1: the source after from/at/in/returned by must be fetched or returned content (response, result, output, page, website, URL, document, file contents, e-mail, message, comment, issue, ticket, remote, server). README, schema and YAML-file wording is clean. |
| F114 | low (impr.) | cb63426 | INJ-003: a pseudo-tag directly followed by "element/tag/node/attribute/field" (optionally "XML"/"HTML") is reported as info with a note, not a warning. HTML comments unchanged. |

All regression tests are in `test/remediation-wp6-inj-data-pol.test.ts` (committed with cb63426; the F087, F082, F088, F093/F097 and F083 tests landed with their commits).

## Deferred

| ID | Reason |
|---|---|
| F109 | needs src/rules/util/text.ts (and possibly src/rules/types.ts + src/report/*): the prompt name is lost in `locationOf()`, which every corpus rule (INJ, DATA, POL, TOOL) uses. Fixing it only inside `injection.ts` would leave DATA/POL text findings without the prompt name and risk double naming once `locationOf` is fixed. Suggested fix: `locationOf` prints `prompt "<name>"` for `prompt.*` entries, or `RawFinding` gains a `prompt` subject rendered by the reporters. |

## Existing tests changed

None. Run and green: `test/rules/content.test.ts`, `test/rules/injection.test.ts`, `test/rules/runtime.test.ts`, `test/real-servers.test.ts`, `test/root-causes.test.ts`, `test/engine.test.ts`, `test/report.test.ts`, `test/docs.test.ts`, `test/e2e-stdio.test.ts`, `test/e2e-http.test.ts`, `test/ci-output.test.ts`.

## Notes for WP10 (docs/design/spec.md is not owned here)

Several fixes change detection patterns that `docs/design/spec.md` §2.4–§2.6 quotes verbatim; the verifiers asked for spec and code to change together. Spec sections to sync: INJ-001 (ZWJ neighbours skip VS15/VS16 and skin tones), INJ-002 (Greek lookalikes only), INJ-003 (named-as-markup → info), INJ-004 (percent runs decoded), INJ-005 warning patterns, INJ-006 patterns 2 and 4, INJ-007 (connector and brand patterns exempt; `our` is a self reference; serverInfo name/title count as own product), INJ-008 (topic qualifier), INJ-009 pattern 1 (source list), DATA-001 (bare `transcript` weak, `conversation_transcript` strong, `all` needs chat qualifier), DATA-002 (memory owner), DATA-003 (compound warning branch), DATA-004 (new names), DATA-005 (skips), POL-001 (token matching), POL-002 (word end).

## CHANGELOG lines (for `## [Unreleased]`)

### Fixed

- DATA-001: a bare `transcript` parameter (meeting, call or video transcription tools) is a warning instead of an error, and a boolean `transcript` flag is not reported; `chat_transcript` and `conversation_transcript` stay errors.
- DATA-001: "send all messages matching the filter" in messaging tools is no longer read as a request for the conversation; `all` needs a chat or conversation qualifier.
- DATA-002: reading VM, GPU, container or knowledge-graph memory is no longer reported as reading Claude's memory; `memory` needs Claude, the assistant, the host or the chat as its owner.
- DATA-005: wallet, e-mail and IP addresses (by description or `format`) and a boolean `long` flag are no longer reported as a precise location.
- POL-001: `get_bestsellers`, `list_stakeholders`, `send_email` and similar names are no longer reported as money transfers; transfer verbs are matched as whole name tokens, and send/buy/sell only next to a money word in the name.
- POL-002: `create_article`, `edit_clipboard`, `edit_voicemail_greeting` and `make_artifact` are no longer reported as AI media generation.
- INJ-001: emoji ZWJ sequences with a variation selector or skin-tone modifier (❤️‍🔥, 👩🏽‍💻, 🏳️‍🌈) are no longer reported as invisible characters.
- INJ-002: unit symbols such as μs, kΩ, ΔT and μg are no longer reported as homoglyphs; only Greek letters that look Latin count.
- INJ-004: percent-encoded non-Latin words in URL examples (Russian, Japanese) are no longer reported as encoded payloads.
- INJ-005: "Do not show user avatars …" and "You are now connected …" are no longer reported as hiding behavior or a persona switch.
- INJ-006 and RT-011: output-format wording ("rather than the default full web page") and value comparisons ("better than the given threshold", "superior to 0.8") are no longer reported as steering.
- INJ-007 and RT-011: "Use this app to …", "Use our app" and a first-party server naming its own brand ("the Slack connector" from the Slack server) are no longer reported as coercing calls.
- INJ-008: "Use this tool for any question about billing" is no longer reported as overly broad triggering.
- INJ-009: "Follow the setup instructions in the README" and "Load rules from a YAML file" are no longer reported as pulling instructions from external sources; the source must be fetched or returned content.

### Changed

- INJ-003: a pseudo-tag the text names as an XML or HTML element ("the `<Secret>` element of the response") is reported as info instead of a warning.

### Added

- DATA-003: compound secret parameter names such as `new_password`, `github_token`, `aws_secret_access_key` and `credentials` are reported as warnings.
- DATA-004: more card, bank and government-ID names are recognized (`card_cvc`, `cvv_code`, `card_exp_month`, `passport_no`, `aadhaar`, `ssn_last4` as errors; `exp_month`, `routing_number`, `account_number`, `license_number`, `nino` as warnings).
