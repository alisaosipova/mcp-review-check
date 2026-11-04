# P5 report: content rules, false positives and performance (1.0.1)

Base: origin/main 5c521cb. Tests: `test/r3-p5-content-rules.test.ts`. Every change only removes findings or makes a scan faster. None adds a finding or raises a severity.

## Fixed

### A05-03: INJ-007 own-tool exemption with "call the \`own_tool\`"
- `src/rules/injection.ts` `referencedIdentifiers`: the unquoted capture is now `(?:the\s+)?(?!(?:the|a|an)\b)([A-Za-z0-9_.-]+)`. Before, when a quote followed "the ", the optional group backtracked and the word `the` was captured as an identifier. That broke `ids.every(isOwn)`. Dropping an article from `ids` can only make the exemption apply more often. RT-011 shares `ownToolFilter`, so it gets the same fix.
- Tests: `A05-03 backtick / single quote / double quote: a hint to call the server's own tool is exempt`, `the article is not captured as a referenced identifier`. A control test checks that a foreign tool (`web_search`) is still reported.

### A05-04: `$ref`-unaware type skip in TOOL-015
- `src/rules/util/schemaWalk.ts`: new shared helpers. `resolvedNode(root, node)` follows a chain of local refs (at most 8, with a cycle guard), lets the node's own keywords override the target's, and flags refs that are not local or do not resolve. `enumValues(node)` covers enum, const, and anyOf/oneOf of const/enum, and is the same logic as in tools.ts.
- `src/rules/annotations.ts` TOOL-015: a property is free-form only if the raw node **and** the resolved node are both free-form, the ref resolves locally, and the resolved node has no closed value list. The `target` test is unchanged and still uses the raw node. So the rule can only report fewer properties.
- Tests: `A05-04 an enum kept in $defs (pydantic Enum, zod nativeEnum) is constrained`, `A05-04 a chained ref, an anyOf of consts and an unresolved ref are not free-form`. A control test checks that an inline `{type:string}` host and a ref to a plain string are still reported.
- Not fixed in this package: the DATA side (`src/rules/data.ts`). See integratorNotes.

### A05-09: INJ-002 on biomedical Greek notation
- `src/rules/injection.ts` `mixedScript`: Cyrillic mixed with Latin is still always reported. A Greek look-alike is no longer reported when the whole word matches `/^[A-Z]+(?:[α-ω]+[A-Z]*)+$/u`: Latin capitals followed by lowercase Greek, as in TNFα, NFκB, PPARγ, ERα, IFNγ, IκBα. The following are still mixed-script: `pαypal`, `gοοgle`, `Tοken` (a Greek letter in a lowercase run), `PΑYPAL` (capital Alpha), and anything with Cyrillic.
- Tests: `A05-09 gene, receptor and cytokine names are not homoglyphs`, `A05-09 a PubMed tool description gets no INJ-002 warning`. A control test covers the spoofing cases.

### A09-01: quadratic snakeCase/tokenize
- `src/rules/util/schemaWalk.ts` `snakeCase` and `src/rules/util/text.ts` `tokenize`: `/([A-Z]+)([A-Z][a-z])/g` is replaced by the linear `/([A-Z])(?=[A-Z][a-z])/g` (`'$1_'` / `'$1 '`). The output was checked to be identical to the old pair of replaces on 20 000 random names.
- Tests: `A09-01 output is unchanged on random names`, `A09-01 a 1 MB run of capitals takes milliseconds` (budget 1 s per call).

### A09-02: POL-003 ADS digit-run regex
- `src/rules/policy.ts`: the trailing alternative is now `(?<!\d)\d+% off!`. The leftmost match is unchanged, because the old regex also started a match at the first digit of the run.
- Tests: `A09-02 "N% off!" is still reported, at the same position` (cases: Get 50% off!, save 5% off! now, a50% off!, x100% off!), `A09-02 a tool name of 1 MB of digits takes well under a second`.

### A09-03: quadratic CSS url() scan and the duplicate pass
- `src/rules/util/html.ts`: a new `cssUrls()` returns exactly the matches of the old regex `/(?<![\w$.]|\bnew\s+)url\(\s*["']?([^"')\s]+)["']?\s*\)/gi`. The reviewer's suggested regex is not used because it captures different values (for example quoted values with spaces), and that could add findings in a patch release. Why the new scan gives the same matches: a value cannot backtrack, so a match is decided by the end of its run of value characters, and every start inside one run shares that end. The run end is computed once per run, so the scan is linear. `extractOrigins` now caches the last result per HTML string (a frozen copy is returned), so APPS-007 and APPS-013 share one pass.
- Tests: `A09-03 finds exactly what the old regex found, on random and hand-written input` (5 000 random inputs over url(/URL(/new /x./quotes/parens), `A09-03 2 MB of unterminated url( takes well under a second` (inputs `url(`, `url("`, `url('`, `url("url(`), `A09-03 the result is cached per HTML and callers cannot corrupt it`.

### Improvement: regex-complexity guard
- `regex-complexity guard: every rule over large server-controlled fields`. For each of 31 units ('A', '0', 'Aa', 'url(', '<a ', '<!--', '<system', quotes, '${', 'https://', Cyrillic а, Greek α, '0% off', ZWSP, ...), the test builds a 200 KB run and puts it into the tool name, title, description, annotations.title, property name and description, resource uri/name/description, resource template, prompt name/description/arguments, instructions, and the UI resource HTML (800 KB). It applies `capSnapshot` and then runs all `RULES`, with a budget of 5 s per unit. The whole file runs in about 15 s on the fixed code. A static ReDoS linter in CI (recheck/safe-regex2) was not added because it needs a new dependency.

## Review fixes
### GREEK_NOTATION ReDoS in INJ-002 (high)
- Confirmed: `/^[A-Z]+(?:[α-ω]+[A-Z]*)+$/u` nests quantifiers, so `mixedScript('A'+'α'.repeat(22)+'b')` took 159 ms locally and grew by about 6x for every 2 Greek letters.
- Fix: `/^[A-Z]+[α-ω][A-Zα-ω]*$/u`. It accepts the same language (a word of Latin capitals and lowercase Greek letters that starts with capitals and has at least one Greek letter). Because the classes do not overlap, each character can match only one way. A differential check over 20 000 random words from `A B α κ b 1` found 0 mismatches. `'A'+'α'.repeat(100000)+'b'` takes 0.2 ms.
- Tests: a direct timing test (5000 Greek letters, under 200 ms), the reviewer's PubMed repro through INJ-002, and two guard units, `'A'+'α'*30+'b'` with and without a trailing space.
### enumValues mixed anyOf (medium)
- Confirmed: `enumValues` returned the consts as soon as any branch had const/enum. Now it returns a list only when every branch is a const/enum branch. A bare `{type:'null'}` branch (an optional enum) is allowed, and any other branch opens the list. `host: {anyOf:[{const:'auto'},{type:'string'}]}`, inline or through `$ref`, gives TOOL-015 again, as on origin/main. The optional-enum case stays silent. Origin/main reported it, so this only removes a false positive.
### extractOrigins single-entry cache (low)
- Fixed: the one-entry cache is now a FIFO map of 16 entries keyed by HTML. APPS-007 and APPS-013 share one scan per UI resource on servers with up to 16 UI resources, and memory stays bounded.

## Not fixed
- None of the items is left unfixed. One part of A05-04 is outside this package's files (`src/rules/data.ts`) and is handed over in integratorNotes.

## Integrator notes
1. **A05-04, DATA part (`src/rules/data.ts`, P-owner of data.ts):** in `scanNames` the skip callbacks see only the raw `{ $ref }` node. Change the `isNonText` skips (DATA-001 `WEAK_CONVO` line ~75 and DATA-003 `SECRET_SUFFIX` line ~117) and `notAPlace` (DATA-005, line ~142) to read `resolvedNode(t.inputSchema, v.node).node`. Import it from `./util/schemaWalk.js`. The simplest way is to pass the root through `skip(v, root)`, the way `extra` already receives it. Use the resolved node only to *add* skips, never to drop them. Repro and test case: `history: {$ref:'#/$defs/Hours'}`, `$defs.Hours = {type:'integer'}`. Today this gives DATA-001; it should give nothing.
2. **tools.ts:** `enumValues` and `isFreeString`/`resolvedProperties` can now use the shared `enumValues`/`resolvedNode` from `src/rules/util/schemaWalk.ts`, so all rules agree. This is optional and does not change behaviour.

## Proposed CHANGELOG lines (1.0.1)
### Fixed
- INJ-007 (and RT-011) no longer warns on a hint that names the server's own tool after an article, as in "Always call the \`search_docs\` tool first" (backticks, single or double quotes), or "use a \`x\` tool".
- TOOL-015 reads a parameter through its local `$ref`. An enum, a const list or an integer kept in `$defs` (pydantic and zod output) is no longer called free-form, and an unresolved remote `$ref` is not evidence.
- INJ-002 no longer reports biomedical notation in which lowercase Greek letters follow Latin capitals (TNFα, NFκB, PPARγ, ERα, IκBα). Greek letters inside lowercase words, capital Greek look-alikes and Cyrillic are still reported.
### Security
- Removed three quadratic regex scans on server-controlled text, each of which could stall a run for minutes with no way for `--max-duration` to stop it: name splitting on long runs of capitals (property and tool names up to 1 MB), the POL-003 "N% off!" pattern on long digit runs, and the CSS `url(` scan of UI resource HTML on repeated unterminated `url(`.
### Changed
- The origins of each UI resource are extracted once and shared by APPS-007 and APPS-013. The cache is bounded to 16 resources.

## Proposed spec paragraphs (docs/design/spec.md)
- TOOL-015, the property bullet: "...that has no enum, const list (enum, const, or an anyOf/oneOf in which every branch is a const/enum, apart from an optional `{type:'null'}` branch) or pattern, judged on the property node and on its local `$ref` target. A `$ref` that does not resolve locally is not reported."
- INJ-002 Detect: "...Latin together with Cyrillic, or with a Greek letter that looks Latin. Biomedical notation is exempt: Latin capitals followed by lowercase Greek letters (`/^[A-Z]+[α-ω][A-Zα-ω]*$/u`, linear, e.g. TNFα, NFκB). Units (μ, Ω, Δ, π, σ) are never look-alikes."
- §1.5 helpers: "`resolvedNode(root, node)` / `enumValues(node)` in util/schemaWalk: rules that read a property's type, enum or format use the `$ref`-resolved node." Also: "Name splitting (`snakeCase`, `tokenize`) and the CSS `url()` scan are linear in the input."

## Tests run
- `npm run typecheck`: passes. `npm run build`: passes.
- `npx vitest run test/r3-p5-content-rules.test.ts test/rules test/unit-rules-util.test.ts test/util.test.ts test/remediation-wp5-apps.test.ts test/remediation-wp6-inj-data-pol.test.ts test/remediation-wp8-tools-schema-rt.test.ts test/remediation-w3b-probe-rules.test.ts test/remediation-w4b-tool-names.test.ts test/remediation-w4b-tool-budget.test.ts test/redact.test.ts`: 19 files, 666 tests passed.
- `npx vitest run test/e2e-stdio.test.ts test/compat.test.ts test/engine.test.ts test/output-modes.test.ts test/e2e-redaction.test.ts`: 5 files, 141 tests passed.
- Fails before the fix: with the six source files reset to origin/main, `-t '^A0(?!.*takes)'` failed 8 of 16 tests, which are all the A05-03, A05-04 and A05-09 tests. The A09 timing tests and the guard did not finish within 500 s on the old code, and the run was killed. Expected: snakeCase on 1 MB of 'A' takes about 340 s on the old code, as extrapolated by the reviewer.
- Review fixes: `npm run typecheck` and `npm run build` pass. `npx vitest run test/r3-p5-content-rules.test.ts` passes 55 of 55 tests. `test/rules/apps.test.ts test/remediation-wp5-apps.test.ts test/rules/injection.test.ts test/rules/tools.test.ts test/rules/content.test.ts test/real-servers.test.ts` pass 210 of 210 tests across 6 files.
- Redaction: the new messages are unchanged rule messages. No new output fields.
