# W4B-rules report

Package W4B-rules of wave 4 ([wave4-plan.md](wave4-plan.md)). Branch `worktree-agent-ad0b0ab4fe935a0b2`, based on `14cce30`.

## Items

| Item | Status | Result |
|---|---|---|
| F076 | done | New `TOOL-033` (claude: error, chatgpt: error): the name must use only `A-Z a-z 0-9 _ -`; the message lists each offending character once (up to 10) and the vendor limits. `TOOL-002` (length > 64) now applies to chatgpt too (claude: error, chatgpt: error). |
| F080 | done | New `TOOL-034` (claude: info, chatgpt: info): one finding per server when `snap.tools.length > TOOL_LIST_MAX_COUNT` (40) or `JSON.stringify(tools).length > TOOL_LIST_MAX_BYTES` (64 KiB); constants in `src/limits.ts`. |
| F079 rest | done | New `TOOL-035` (spec: info) over `inputSchema` and `outputSchema` with `walkSchema`: (a) dangling `required`, (b) keyword typos, (c) unknown `format`. `TOOL-020` already covered `outputSchema` (`schema.ts` loops over both keys); confirmed with a new test, no code change needed. |

Rule IDs: `grep -rn "TOOL-03" src docs/RULES.md` showed TOOL-030..032 only, so TOOL-033/034/035 were free and are the ones used.

Deferred: none.

### Design decisions

- **TOOL-033 vs TOOL-002 split.** TOOL-033 checks only the character set (and an empty name); length stays in TOOL-002, so a name that is too long and has a bad character gets two findings with two distinct fixes and no double count of the length. A non-string name is TOOL-001's finding, so TOOL-033 skips it.
- **Claude limit is 128 in the API, 64 in the directory.** The Claude API documents `^[a-zA-Z0-9_-]{1,128}$`, not `{1,64}`. The 64-character cap for Claude comes from the Anthropic Software Directory Policy (§5.C "MCP tool names must not exceed 64 characters"), which TOOL-002 already cites. So Claude's binding limit for a directory connector is 64 (TOOL-002), and the API pattern is used for the character set only (TOOL-033). The message gives both limits.
- **TOOL-002 on chatgpt.** Supported by the OpenAI API reference ("maximum length of 64"); severity error because the API rejects the name deterministically. Source added.
- **TOOL-034 platforms.** claude and chatgpt only. Both vendors document the token cost and the accuracy drop. The MCP specification says nothing about a tool budget, so `spec` is not a platform (CONTRIBUTING: do not add a platform whose documents do not support the rule). The thresholds are linter-defined and named so in the rationale. The size is measured after the TEXT_CAP truncation of the snapshot (16 KiB per string), so a single huge description counts at most 16 KiB. Token estimate in the message: chars / 4.
- **TOOL-035 platform.** `spec: info`. This is JSON Schema hygiene, cited from JSON Schema 2020-12, the OpenAPI format registry and MCP "JSON Schema usage". No directory document requires it.
- **TOOL-035 (a) dangling `required`.** Checked only on a node that has its own `properties` object. It is skipped when the node admits extra keys (`additionalProperties` true or a schema, `patternProperties`, `unevaluatedProperties` true or a schema) or composes properties (`allOf`, `anyOf`, `oneOf`, `$ref`, `$dynamicRef`, `if`, `dependentSchemas`, `dependencies`). It is also skipped inside `allOf/anyOf/oneOf/not/if/then/else/dependentSchemas/dependencies` subtrees, which see the parent's properties. When `additionalProperties` is absent, JSON Schema technically allows the extra key, but the rule still reports it, as the task says ("true or a schema"). That is the typo case.
- **TOOL-035 (b) typos.** Only the keys of schema nodes the walker visits are compared. Property names live inside `properties` and `$defs` maps and are never compared. The fixed list covers draft-04 to 2020-12 keywords plus OpenAPI (`nullable`, `discriminator`, `xml`, `externalDocs`, `example`). A key is flagged when it is one edit away (insert, delete, substitute) or one adjacent transposition away (`requried`) from a keyword of at least 5 characters. Short keywords (`if`, `not`, `id`, `type`, `enum`) are not targets, to avoid flagging real words. Explicit singular aliases are added for the plural keywords more than one edit away (`property`, `additionalProperty`, `patternProperty`, `unevaluatedProperty`). `x-*` keys are ignored.
- **TOOL-035 (c) formats.** Fixed list: JSON Schema 2020-12 §7.3, draft-03/04 legacy names (`host-name`, `ip-address`, `color`, `utc-millisec`, `style`, `phone`) and every name in the OpenAPI format registry. A generator-specific format (for example `url`, `uuid4`, zod `cidrv4`) is reported, as info.
- **False-positive check.** The three new rules were run over the seven frozen real-server listings (`test/fixtures/real/*`: kiwi, huggingface, mslearn, exa, svelte, openzeppelin, aws-knowledge) with a throwaway test. They gave 0 findings. The GOOD and BAD stdio fixtures are unchanged (`test/e2e-stdio.test.ts` passes, `BAD_STDIO_RULES` untouched).

### Files outside the stated ownership (append-only)

The repo's own guards require two test edits for any new rule (CONTRIBUTING "How to add a rule", step 4). Without them `test/rules/tools.test.ts` ("has a case for every rule") and `test/catalog.test.ts` ("IDs match the frozen list") fail. No other wave-4 package owns these files. The edits only append:
- `test/rules/tools.test.ts`: `pos`/`neg` cases for TOOL-033, TOOL-034, TOOL-035.
- `test/catalog.test.ts`: `range('TOOL', 32)` → `range('TOOL', 35)`.

## Files changed

- `src/rules/tools.ts`: TOOL-002 (chatgpt, source), TOOL-033, TOOL-034, source constants `CLAUDE_DEFINE_TOOLS`, `OAI_FN_REF`.
- `src/rules/schema.ts`: TOOL-035, `SCHEMA_KEYWORDS`, `KNOWN_FORMATS`, `editDistanceOne`, `keywordTypo`.
- `src/limits.ts`: `TOOL_LIST_MAX_COUNT = 40`, `TOOL_LIST_MAX_BYTES = 64 * 1024`.
- `docs/RULES.md`, `README.md`, `docs/design/spec.md`: regenerated by `npm run readme:rules` (rule table, `RULE_COUNT` 144 → 147). This was the generator's only change to spec.md and README.
- `test/remediation-w4b-tool-names.test.ts`, `test/remediation-w4b-tool-budget.test.ts`, `test/remediation-w4b-schema-lint.test.ts` (new).
- `test/rules/tools.test.ts`, `test/catalog.test.ts` (append-only, see above).
- `src/rules/index.ts`: unchanged; rules come in through `toolRules` / `schemaRules`.

## Verification

| Command | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run build` | pass |
| `npm run readme:rules` | "147 rules, 31 manual items, catalog date 2026-11-01" |
| `npx vitest run test/remediation-w4b-tool-names.test.ts test/remediation-w4b-tool-budget.test.ts test/remediation-w4b-schema-lint.test.ts test/remediation-wp8-tools-schema-rt.test.ts test/rules/tools.test.ts test/catalog.test.ts test/docs.test.ts test/e2e-stdio.test.ts test/real-servers.test.ts` | 9 files, 198 tests, all pass |
| `npx vitest run test/docs.test.ts test/e2e-stdio.test.ts test/real-servers.test.ts test/engine.test.ts test/report.test.ts test/sarif.test.ts test/output-modes.test.ts test/cli-rules.test.ts test/repo-config.test.ts` (final code, before the commit split) | 9 files, 118 tests, all pass |
| `test/limits.test.ts`, `test/unit-rules-util.test.ts` | pass |

`test/docs.test.ts` is the catalog/RULES.md sync check (with `repo-config` and `lifecycle`, which only mention RULES.md). Each of the three commits was regenerated and passed typecheck, build and its own tests on its own. The full suite was not run (D1).

## Verified vendor constraints (2026-11-01)

| Vendor | Constraint (quoted) | URL |
|---|---|---|
| Anthropic (Claude API) | `name`: "Must match the regex `^[a-zA-Z0-9_-]{1,128}$`." | https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools (the old `docs.anthropic.com/.../tool-use/overview` URL 301-redirects to platform.claude.com; the overview page no longer carries the pattern) |
| Anthropic (directory) | §5.C "MCP tool names must not exceed 64 characters." (no character rule) | https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy |
| OpenAI (API reference, Chat Completions `tools[].function.name`) | "Must be a-z, A-Z, 0-9, or contain underscores and dashes, with a maximum length of 64." | https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create (`platform.openai.com/docs/api-reference` returns 403 to the fetcher) |
| OpenAI (function-calling guide, TOOL-034) | "Aim for fewer than 20 functions available at the start of a turn" (soft); "callable function definitions count against the model's context limit and are billed as input tokens." | https://developers.openai.com/api/docs/guides/function-calling |
| Anthropic (tool search, TOOL-034) | "Claude's ability to pick the right tool degrades once you exceed 30–50 available tools"; a multi-server setup "can consume ~55k tokens in definitions". | https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool |
| OpenAPI format registry (TOOL-035) | 53 registered formats, all in `KNOWN_FORMATS` | https://spec.openapis.org/registry/format/ |

The Anthropic documentation differs from the plan's `^[A-Za-z0-9_-]{1,64}$`. Per the task, the docs were followed: 128 for the API character pattern, with the 64-character Claude cap kept from the directory policy in TOOL-002.

## Proposed CHANGELOG lines (`## [Unreleased]`)

Under `#### Rules added`:

- `TOOL-033` Tool name matches the vendor API pattern (claude: error, chatgpt: error): a tool name with a character outside `A-Z a-z 0-9 _ -` (for example the `.` the MCP specification allows, a space or `/`) or an empty name is rejected by the Claude API (`^[a-zA-Z0-9_-]{1,128}$`) and the OpenAI API (a-z, A-Z, 0-9, `_`, `-`, at most 64). The message lists the offending characters. (review F076)
- `TOOL-034` Tool list budget (claude: info, chatgpt: info): one finding per server with more than 40 tools or more than 64 KiB of `tools/list` JSON (linter-defined, `src/limits.ts`). Every definition costs context tokens on each turn, and selection gets less accurate with many tools. (review F080)
- `TOOL-035` Schema lint (spec: info), over `inputSchema` and `outputSchema` including nested schemas: `required` names not declared in `properties` (unless the schema admits extra keys or composes properties), keys one edit from a JSON Schema keyword (`propeties`, `require`, `requried`, `additionalProperty`), and `format` values outside JSON Schema 2020-12 and the OpenAPI format registry. (review F079)

Under `#### Severity raised`:

- `TOOL-002` Tool name at most 64 characters now also applies to chatgpt (error), per the OpenAI API's 64-character function-name limit. (review F076)

## Proposed `docs/design/spec.md` rule sections

Replace the TOOL-002 entry in §2.3:

```markdown
**TOOL-002 Tool name at most 64 characters.** Severity: claude=error, chatgpt=error.
- Detect: `[...name].length > 64`.
- Source: https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy, https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
```

Append after TOOL-032 in §2.3:

```markdown
**TOOL-033 Tool name matches the vendor API pattern.** Severity: claude=error, chatgpt=error.
- Detect: a string name that is empty or contains a character outside `[A-Za-z0-9_-]`. The message lists each offending character once (up to 10) and the limits: Claude API `^[a-zA-Z0-9_-]{1,128}$`, OpenAI API 1-64 characters. Length over 64 is TOOL-002; a non-string name is TOOL-001.
- Source: https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools, https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create

**TOOL-034 Tool list budget.** Severity: claude=info, chatgpt=info.
- Detect: `tools.length > 40` or `JSON.stringify(tools).length > 65536` *(linter-defined, `TOOL_LIST_MAX_COUNT` / `TOOL_LIST_MAX_BYTES` in `src/limits.ts`)*. One finding per server. The message gives the count and size, an estimate of context tokens (chars / 4), and suggests consolidating related tools or hiding rarely used ones.
- Source: https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool, https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools, https://developers.openai.com/api/docs/guides/function-calling
```

Append after TOOL-022 in the schema part of §2.3:

```markdown
**TOOL-035 Schema lint: dangling required, keyword typos, unknown format.** Severity: spec=info.
- Scope: every node `walkSchema` visits in `inputSchema` and `outputSchema` (properties, items, combinators, `$defs`, local `$ref` targets).
- Detect:
  - (a) a node with its own `properties` whose `required` names a key not in `properties`. Skipped when the node admits extra keys (`additionalProperties` true or a schema, `patternProperties`, `unevaluatedProperties` true or a schema), composes properties (`allOf`, `anyOf`, `oneOf`, `$ref`, `$dynamicRef`, `if`, `dependentSchemas`, `dependencies`), or sits under `allOf/anyOf/oneOf/not/if/then/else/dependentSchemas/dependencies`.
  - (b) a node key that is not a known keyword and is one edit (insert, delete, substitute, or adjacent swap) from a known keyword of at least 5 characters, or a singular form of a plural keyword (`property`, `additionalProperty`, `patternProperty`, `unevaluatedProperty`). Known keywords: draft-04 to 2020-12 plus OpenAPI `nullable`, `discriminator`, `xml`, `externalDocs`, `example`. Keys starting with `x-` are ignored; property names are never compared.
  - (c) a string `format` outside JSON Schema 2020-12 §7.3, the draft-03/04 legacy names and the OpenAPI format registry.
- Source: https://json-schema.org/draft/2020-12/json-schema-validation, https://json-schema.org/draft/2020-12/json-schema-core, https://spec.openapis.org/registry/format/, https://modelcontextprotocol.io/specification/2026-07-28/basic#json-schema-usage
```

TOOL-020 needs no spec change. Its Detect line should say "for each of `inputSchema` and `outputSchema`" if it does not already: the code checks both, and `test/remediation-w4b-schema-lint.test.ts` covers it.
