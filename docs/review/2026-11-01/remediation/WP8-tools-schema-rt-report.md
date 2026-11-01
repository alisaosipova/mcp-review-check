# WP8-tools-schema-rt: remediation report

Branch `worktree-wf_365c0c99-4d0-8`, based on `8b0f41e`. Owned files: `src/rules/{tools,schema,annotations,runtime}.ts`, `src/rules/util/{schemaWalk,text,obs}.ts`.
Regression tests: `test/remediation-wp8-tools-schema-rt.test.ts` (55 tests).

Checks run: `npm run typecheck`, `npm run build`, `npx vitest run test/remediation-wp8-tools-schema-rt.test.ts test/rules/ test/docs.test.ts test/util.test.ts test/root-causes.test.ts test/real-servers.test.ts test/engine.test.ts` (14 files, 428 tests) and `test/e2e-http.test.ts` (32 tests, because RT-002 changed). All green. The full suite was not run (D1).

## Done

| ID | Commit | What changed |
|---|---|---|
| F062 | 1bb9ad4 | TOOL-017 and RT-006 hand Ajv the dialect's canonical `$schema` id. https draft-07 and http 2019-09/2020-12 no longer give a false "does not compile" error, and RT-006 no longer skips validation silently. |
| F063 | 80982fa | TOOL-023, TOOL-025 and TOOL-026 resolve local `$ref` parameters. A method enum in `$defs` now gives the mixed-methods error. An unresolved `$ref` is no longer treated as a free string. |
| F065 | ee31192 | TOOL-026 treats `body`, `payload` and `request_body` as a raw request only next to a method, url, uri, endpoint or headers parameter, or when the parameter is a free-form object. Query languages still need no context. |
| F064 | 1ce8e51 | TOOL-004 flags `top`, `official`, `preferred` and `leading` only before a word that rates the tool (tool, choice, pick, rated, ...). The other promotional words are unchanged. |
| F103 | 49a3f90 | RT-011 also scans the string values of structuredContent and the text of embedded resources. The message says where the match was (`output`, `structuredContent` or `embedded resource contains ...`). |
| F067 | 8f4b7e1 | TOOL-006 falls back to `annotations.title` when the top-level title is empty or not a string. A non-string title gets a spec warning "title is 42, not a string". |
| F074 | 4127648 | TOOL-018 skips schemas that accept keys through patternProperties, propertyNames, unevaluatedProperties, dependentSchemas, dependentRequired or dependencies, or through a schema-valued additionalProperties. |
| F085, F105 | b0638bc | RT-010 searches all result text for tokens: text items, string values of structuredContent and embedded resources. Prose and fenced JSON are now covered. It uses `isKnownToken` from `util/net.ts`, the redaction's token list, in place of its own narrower `TOKEN_RE`. The text is split into words and each word is tested whole, so the `^…$` anchors stay. Key detection still walks the JSON roots. |
| F104 | f5aa265 | RT-010 skips LEAK_KEY keys that the tool's outputSchema declares. |
| F066 | dfde289 | TOOL-021 says "a property without a type" for a node without a type. For a local `$ref` it reads the target's type, so a `$ref` to a string is no longer an error. |
| F071 | 0a25056 | walkSchema and schemaMetrics now follow `dependentSchemas`, the schema values of `dependencies`, and `additionalItems`. |
| F073 | df897aa | TOOL-031 resolves a root `$ref` in outputSchema and inputSchema, and a `$ref` on the `id` property. |
| F069, F077 (3) | 1e5036b | New `compoundWriteVerb` in util/text.ts: a write verb joined by and/or/then (search_and_replace, get_or_create). `toolKind` treats such a name as write. TOOL-014 skips (c) and (e) for these names, reports (a) "name contains write verb" and (b) for a joined hard-destructive verb. TOOL-027 no longer calls search_and_replace a collection tool. Names without a conjunction (get_order, list_posts) do not change. |
| F077 (2) | 9bede28 | behaviorText no longer drops the clause after "like". Quoted examples are still removed. |
| F070 | 5d45362 | TOOL-019 treats every `$id` in the document (resolved against the root `$id`) as local. A `$ref` to an embedded resource is no longer reported. |
| F068 | c5884e1 | New `wordCount` in util/text.ts uses `Intl.Segmenter` for Han, Hiragana, Katakana, Thai, Lao, Khmer and Myanmar text. TOOL-008 counts words with it. |
| F078 | 18fd3de | escapeHidden keeps a ZWJ between an emoji (or a skin-tone modifier or U+FE0F) and a pictograph. Every other ZWJ is still escaped. |
| F079 (part) | 607198a | TOOL-020 also measures outputSchema. The message names the schema. |
| C-imp-3 | 775a9d2 | RT-002 also reports a success answer to the `invalid-missing` call (`{}` for a tool with required parameters): "call without the required arguments returned a success result". |
| — | edc05ec | Test file cleanup. |

## Deferred

| ID | Reason |
|---|---|
| F076 | feature: a new platform rule for Claude/OpenAI tool-name characters (`^[A-Za-z0-9_-]{1,64}$`), plus a chatgpt variant of TOOL-002. The vendor patterns in the finding come from memory and need checking against current Anthropic and OpenAI docs first. A new rule ID or a severity change also requires regenerating docs/RULES.md and the README table (WP10). |
| F080 | feature: a new "tool list budget" rule (number of tools, total size of tools/list) with linter-defined thresholds. The finding wants them in `src/limits.ts` (WP2), so this needs src/limits.ts, plus RULES.md/README regeneration. |
| F081 | Changing walkSchema's `seen` from a global set to the current ancestor stack walks each reused `$ref` target once per reference site and again under `$defs`. That duplicates TOOL-009/021/022 findings, and on DAG-shaped schemas the walk grows exponentially unless a node budget is added. It changes how every walker-based rule behaves, so the maintainer should decide on it; it is not a local fix. |
| F079 (rest) | feature: new schema-lint checks (keyword typos by edit distance, `required` naming missing properties, unknown `format`). These go beyond the TOOL-017 rule spec and need a new rule or a spec change. |
| F077 (1) | TOOL-015 still flags the `url` name token (shorten_url, validate_url). Dropping it would also drop true positives such as fetch_url with a target parameter outside TARGET_PROP. The free `url`/`format: uri` parameter check below it would also still fire for shorten_url, so the change would gain little. Whether shortening a URL is "open world" is a judgment call; left as it is. |

## Existing tests changed

- `test/rules/runtime.test.ts` RT-010 `pos` case: the fake JWT `eyJhbGciOi.eyJzdWIiOiIx.c2lnbmF0dXJl` became a realistic one (`eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJlMTIz`). RT-010 now uses the redaction's `KNOWN_TOKEN` list, which requires at least 8 characters per JWT segment, and the old header segment had 7.

## Notes for WP10 (spec/docs)

docs/design/spec.md still describes the old behaviour and needs updating:
- TOOL-004: the word list; top/official/preferred/leading count only before a word that rates the tool.
- TOOL-018: the new exemptions.
- TOOL-020: outputSchema is measured too.
- TOOL-026: body/payload/request_body need a request context or a free-form object.
- RT-002: the invalid-missing call is judged too.
- RT-010: all result text is searched with the redaction token list; keys declared in outputSchema are exempt.
- RT-011: structuredContent and embedded resources are scanned.

Rule metadata (titles, severities, rationale, fix) is unchanged, so RULES.md needs no regeneration for this package.

## CHANGELOG lines

### Fixed

- TOOL-017 no longer reports a valid schema as not compiling when its `$schema` uses the other URL scheme (`https://json-schema.org/draft-07/schema#`, `http://json-schema.org/draft/2020-12/schema`), and RT-006 validates structuredContent against such schemas instead of skipping them.
- TOOL-023, TOOL-025 and TOOL-026 resolve local `$ref` parameters: a method enum kept in `$defs` now yields TOOL-023's mixed-methods error, and an enum behind `$ref` is no longer a "free-form" parameter.
- TOOL-026 no longer warns about the text field of `create_issue`, `send_email` or `post_message` tools: `body`, `payload` and `request_body` count as a raw request only next to a method, URL, endpoint or headers parameter, or as a free-form object.
- TOOL-004 no longer flags ordinary names such as `get_top_stories`, `set_preferred_language` or `get_official_rate`; top, official, preferred and leading count only when they rate the tool itself (`top_rated_tool`, "official tool").
- TOOL-006 no longer reports "no title" when an empty top-level `title` sits next to a set `annotations.title`; a non-string title is named as such.
- TOOL-018 no longer calls a tool parameterless when its schema admits keys through `patternProperties`, `propertyNames`, `unevaluatedProperties`, `dependentSchemas` or a schema-valued `additionalProperties`.
- TOOL-021 says "a property without a type" instead of "a undefined property", and an `x-mcp-header` on a `$ref` to a string, integer or boolean is no longer an error.
- TOOL-031 no longer reports "lacks a required string id" for a profile tool whose outputSchema is a root `$ref` into `$defs`.
- TOOL-019 no longer reports a `$ref` to an embedded resource with its own `$id` (for example `urn:acme:addr` in `$defs`) as pointing outside the document.
- TOOL-014 and TOOL-027 classify names like `search_and_replace` and `get_or_create` by their joined write verb: no more "read verb "search" but destructiveHint: true" on correctly hinted tools or "collection tool" on them; a joined `delete` without `destructiveHint` is reported.
- TOOL-014 no longer ignores the rest of a sentence after "like" ("works like a scratchpad and deletes notes").
- TOOL-008 no longer calls full Chinese, Japanese or Thai descriptions "only 1 words".
- RT-010 no longer reports keys that the tool's outputSchema declares (`logs` of a `get_logs` tool) as leaked internals.
- Finding snippets show emoji ZWJ sequences such as 👨‍💻 as written instead of escaping the joiner.

### Changed

- RT-010 finds credentials in plain-text and code-fenced results, not only in parsed JSON, and recognizes the same token formats as the report redaction (Stripe, GitLab, Slack, Google, npm and Hugging Face keys in addition to JWT, `sk-`, `ghp_` and `AKIA`).
- RT-011 also scans the string values of `structuredContent` and the text of embedded resources, and says where the injection was found.
- RT-002 also reports a success answer to the `--active` call made without the required arguments.
- TOOL-020 also bounds the depth and size of `outputSchema`.
- walkSchema-based rules (TOOL-009, TOOL-021, TOOL-022, TOOL-020 and others) now see subschemas under `dependentSchemas`, the schema form of `dependencies`, and `additionalItems`.
