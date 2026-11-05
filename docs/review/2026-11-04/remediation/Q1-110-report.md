# Q1 (1.1.0) Content detection: report

Branch `r110-Q1`, based on `origin/main` 85e74ac (Release 1.0.1). Files changed: `src/rules/injection.ts`, `data.ts`,
`policy.ts`, `apps.ts`, `tools.ts`, `schema.ts`, `src/rules/util/{text,schemaWalk,html}.ts`; new tests
`test/r110-q1-{corpus,hidden-chars,refs,apps,tools,memo}.test.ts`; existing tests adjusted: `test/catalog.test.ts`
(frozen list `TOOL` 35 → 36) and `test/rules/tools.test.ts` (a pos/neg case for TOOL-036, required by "has a case for every rule").

## Items

### A05-01 corpus covers schema titles, enum/const, default, examples (fixed)
`corpus()` (util/text.ts) now also yields, for every node of `inputSchema`: `param.title` (all nodes), `param.enum`
(each string `enum` value and a string `const`), `param.default` and `param.examples` (string leaves of `default`,
`examples` and OpenAPI `example`, nested values included, at most 200 leaves per keyword, depth 8), and `param.name`
(property keys). A new `CorpusScope` (`values`, `samples`, `keys`) decides who reads what:
- INJ-001: everything, property names included.
- INJ-003, INJ-005: titles, enum/const and samples.
- INJ-002, INJ-004, INJ-006..010, DATA-001..003, SRV-015 (corpus read in server.ts): titles and enum/const (default scope).
  INJ-004 does not read samples (a base64 example body is data).
- POL-003, POL-004: titles only (an enum of plan names or a coupon example is functionality, not advertising).
Paths are JSON pointers to the string (`/properties/format/enum/1`, `/properties/region/default`), and messages start with
the `where` (`param.title /properties/month/title: "..."`). Redaction: the finished report is scrubbed by `redactDeep`
(cli.ts), which covers the new messages, evidence and paths; a test checks a run secret quoted from a default and a
property name is masked.
Tests: `test/r110-q1-corpus.test.ts` (the review repro gives INJ-005 errors at title/enum/const, an INJ-005 warning at
examples, INJ-001 error at the tag-encoded default; nested values; property names; INJ-002/003/DATA-001/POL-003 scopes;
INJ-004 skips base64 samples; a realistic pydantic-style schema stays clean on every INJ/DATA/POL rule; scope API;
redaction). The real-server regression (`test/real-servers.test.ts`, 7 frozen listings) shows no new warning or error.

### A05-02 INJ-001 invisible characters outside \p{Cf} (fixed)
`invisibleOutsideCf()` (util/text.ts), used by `hiddenChars` and `escapeHidden`:
- a run of 2+ variation selectors (U+FE00–FE0F, U+E0100–E01EF), the emoji-smuggling form → hard (error);
- a single variation selector on a base it is not defined for (a Latin letter) → soft; a single one on an emoji, a
  keycap base, a symbol (Sm/So), a CJK ideograph (IVS) or Mongolian/Phags-pa/Myanmar is fine (❤️, 1️⃣, ☺︎, 葛󠄀, ∩︀);
- Hangul fillers U+3164/U+FFA0, U+115F/U+1160 outside a conjoining-jamo syllable, U+2800 outside Braille text, CGJ
  U+034F and Khmer U+17B4/U+17B5 → soft (warning).
The code-point list in a message is capped at 16 (`… (+N more)`). The hard message reads "tag, bidi control or variation
selector characters" only when a variation selector is among them (otherwise unchanged).
The regex rules now scan `scanForm(text)` = NFKC plus `foldInvisible`: Cf, non-whitespace Cc, CGJ, Khmer inherent vowels
and variation selectors removed, Hangul fillers and the Braille blank replaced by a space, so "Ignoreㅤpreviousㅤinstructions"
and "Ig​nore previous instructions" match INJ-005. This applies to INJ-003..010, DATA-001..003 and POL-002..004.
Tests: `test/r110-q1-hidden-chars.test.ts` (VS-encoded payload after an emoji is an error with a capped list; each filler
is a warning; legitimate variation sequences, Braille text and conjoining jamo are clean; escapeHidden; INJ-005 through
fillers, Braille blank, CGJ and ZWSP; scanForm keeps whitespace).

### A05-10 INJ-002 fullwidth, mathematical alphanumerics, Armenian (fixed)
`mixedScript()` flags a word with ASCII letters plus fullwidth Latin (U+FF21–FF5A) or Mathematical Alphanumeric Latin
letters (U+1D400–1D6A5), and Latin mixed with Armenian or Cherokee (whole scripts; their letters pass for Latin). A word
wholly in fullwidth ("ＰＤＦ"), math bold, Armenian or Cherokee is not a mix. INJ-002 now splits words on the
`foldInvisible` text, so a zero-width space cannot split a homoglyph word. Tests in `test/r110-q1-hidden-chars.test.ts`.

### A05-05 unresolvable $ref (fixed, new rule TOOL-036)
New rule **TOOL-036 "Every $ref resolves inside the schema"**, spec: warning, in `src/rules/schema.ts`, sources
`https://modelcontextprotocol.io/specification/2026-07-28/basic#ref-resolution` and
`https://json-schema.org/draft/2020-12/json-schema-core#section-8.2.3.1`. `unresolvedRefs(root)` walks the raw schema
(not data keywords `enum/const/default/examples/example`, not `x-` extensions) and reports for `inputSchema` and
`outputSchema`:
- a local pointer (`#/$defs/Missing`) that names no subschema, or a plain-name fragment (`#item`) with no `$anchor`,
  `$dynamicAnchor` or draft-07 `$id: '#item'`;
- a relative reference (`common.json#/$defs/Item`) when the root has no absolute `$id` and no embedded resource carries
  that `$id`; a relative reference against an absolute base that lands on the root document has its fragment checked.
References inside an embedded resource (own `$id`) are not judged; absolute references to other documents stay TOOL-019's.
Severity is warning, not error: detection is deterministic, but I did not find a MUST in the MCP or JSON Schema text that
makes an unresolvable reference a rejection (JSON Schema leaves the behaviour to the implementation). An integrator who
finds one can raise it to error in a later minor. The dead `missingRef` branch of TOOL-017 is kept as a guard; its comment
now points to TOOL-036/TOOL-019.
Tests: `test/r110-q1-refs.test.ts` (repro: both forms; missing anchor and `$dynamicRef`; outputSchema; resolvable pointers,
percent-encoded keys, anchors, draft-07 plain-name ids; absolute base; embedded resource; `$ref`-shaped data; a cycle;
`explain TOOL-036`), plus the pos/neg case in `test/rules/tools.test.ts`.

### A05-06 APPS-006 wildcard with an explicit port (fixed)
`broadWildcard()` judges only the host part of the wildcard rest (port, path, query and fragment cut), so
`https://*.vercel.app:443`, `*.co.uk:443`, `*.amazonaws.com:443` and `*.vercel.app:8443` are "overly broad".
Tests: `test/r110-q1-apps.test.ts` (five broad entries, one narrow `*.acme.test:443`).

### A05-07 APPS-007 sees XHR, sendBeacon, Worker, poster, embed (fixed)
`extractOrigins()` (util/html.ts): XHR `.open()` with GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS (case-insensitive), and
`navigator.sendBeacon(url)` → connect (js); `new Worker(url)` / `new SharedWorker(url)` → resource (js; worker-src falls
back to script-src); `<video poster>`, `<embed src>` and `<object data>` → resource (tag).
Tests: `test/r110-q1-apps.test.ts` (each form, an APPS-007 finding for an undeclared beacon origin and none when declared,
`window.open` is not XHR).

### A05-08 TOOL-034 advice consistent with TOOL-024 (fixed)
TOOL-034 fix: "Merge tools that differ only by a filter or an entity type into one tool with an enum parameter, keeping
reads and writes in separate tools (an `action` enum that mixes them is TOOL-024), shorten long descriptions and schemas,
or hide rarely used tools behind a separate server or a search tool." The finding message is unchanged.
Test: `test/r110-q1-tools.test.ts`.

### Deferral from 1.0.1: tools.ts uses the shared enumValues / resolvedNode (done)
The local `enumValues` in tools.ts is gone. `util/schemaWalk.ts` `enumValues(node, { open: true })` keeps the listed
values beside a free branch (the old tools.ts behaviour, needed by TOOL-023/024: GET and POST next to `{type:'string'}`
still mix safe and unsafe methods); the closed default is unchanged for TOOL-015 and the DATA skips. TOOL-023's method
property and `resolvedProperties` (TOOL-025/026/027...) use `resolvedNode`, so a two-step `$defs` chain resolves and
sibling keywords apply; a resolved node drops its `$ref` so the target's shape is judged (an unresolved one keeps it).
`resolvePointer` is now exported for TOOL-036. Tests: `test/r110-q1-tools.test.ts` (open list, two-step chain), existing
`test/remediation-wp8-tools-schema-rt.test.ts` F063 cases still pass.

### Improvement: per-snapshot memo (done, measured)
`corpus()` builds its entries once per snapshot (WeakMap keyed by the snapshot, checked against the identity and length of
`tools`, `prompts`, `resources`, `resourceTemplates` and `instructions`), and `scanEntry(e)` caches the scan form per
entry. A stopped run's rules each get their own read-tracking proxy from the engine, which is a different key, so the
incomplete-phase tracking still sees every rule's reads (`test/incomplete.test.ts`, `test/engine.test.ts` pass).
`scanCorpus` matches a repeated text once per rule when it has no filter; INJ-001/002 skip plain-ASCII text; INJ-003 skips
text without `<`, INJ-004 text shorter than 24 characters.

Measurement (`runRules` over all rules, median of 7, in-process, built `dist/`; host load average 6–20 at the time):

| Snapshot | origin/main (1.0.1) | Q1 without memo | Q1 with memo |
|---|---|---|---|
| many-tools-server shape (400 tools, one `q` property) | 28–43 ms | 32–51 ms | 25–26 ms |
| huge-server shape (one 16 KB description) | 7 ms | 7–10 ms | 7 ms |
| rich (400 tools × 20 properties, each with title, 10-value enum, examples) | 289–336 ms | 939–965 ms | 337–362 ms |

The rich snapshot has 12× more corpus entries with A05-01 (113 200 against 9 200); the memo and the fast paths bring it
back to within ~15% of 1.0.1 while scanning all of them. Test: `test/r110-q1-memo.test.ts`.

## Review fixes (branch r110-Q1-fix)
All six findings of the Q1 review are fixed with tests; none refuted.
- R110-Q1-01 (medium) TOOL-036 skipped `enum`/`const`/`default`/`examples`/`example`/`x-` keys everywhere, also as
  property or `$defs` names: anchors and embedded `$id`s under such a name were not collected (false "names no $anchor",
  false "is relative") and `$ref`s under it were not checked. `unresolvedRefs` now walks every entry of a name map
  (`properties`, `patternProperties`, `$defs`, `definitions`, `dependentSchemas`) and skips data keywords and `x-` only at
  keyword positions. The three review repros are tests in `test/r110-q1-refs.test.ts`.
- R110-Q1-02 (medium) `foldInvisible` kept U+FEFF because JavaScript `\s` includes it, so "Ig\uFEFFnore previous
  instructions" missed INJ-005. The fold now keeps only `[\t\n\v\f\r ]`; U+FEFF is the only `\p{Cf}`/`\p{Cc}` code
  point in `\s`, so nothing else changes. Test in `test/r110-q1-hidden-chars.test.ts`.
- R110-Q1-03 (medium) `npm run readme:rules` regenerated `docs/RULES.md` (TOOL-036 row) and the README `RULE_COUNT`
  (180); `test/docs.test.ts` passes. `docs/design/spec.md` was regenerated by the script too but reverted, as it is not
  mine to edit: its `RULE_COUNT` marker still says 179 and needs `npm run readme:rules` at integration. CHANGELOG and spec
  texts are proposed below (now including the review fixes).
- R110-Q1-04 (low) regex findings quote the folded text, so the hidden characters vanished from the evidence. INJ
  (`finding()`), DATA (`scanText`) and POL-001/003/004 messages now end with "(matched with hidden characters folded:
  \u{FEFF} ...)" listing the folded code points of the raw text (at most 8, then a count) when the scan form removed or
  replaced any; NFKC-only differences add nothing. The note holds only code points, nothing to redact.
- R110-Q1-05 (low) APPS-007 XHR extraction listed seven methods; it now accepts any method token
  (`.open('PROPFIND', url)`). Test in `test/r110-q1-apps.test.ts`.
- R110-Q1-06 (low) the corpus memo went stale when a tool object was changed in place between runs. The memo now expires
  in a microtask after the synchronous run that built it (`runRules` is synchronous, so one run still shares it); the
  identity/length signature still covers a list replaced within the same task. Test in `test/r110-q1-memo.test.ts`.

## Not fixed
None of the listed items. `docs/design/spec.md`'s `RULE_COUNT` marker stays at 179 (see R110-Q1-03).

## Proposed CHANGELOG lines (1.1.0)

### Rules added
- TOOL-036 Every $ref resolves inside the schema (spec: warning): a `$ref`/`$dynamicRef` to a missing `$defs` entry or
  anchor, or a relative reference with no absolute base `$id`, which hosts that compile the schema reject (review A05-05).

### Added
- INJ, DATA and POL rules also read schema-carried text: property titles, `enum`/`const` values, `default` and `examples`
  values (INJ-001/003/005), and property names (INJ-001). Finding paths point at the string, e.g.
  `/properties/format/enum/1` (review A05-01).
- INJ-001 reports variation-selector runs (emoji smuggling) as errors, and stray variation selectors, Hangul fillers,
  the Braille blank, CGJ and Khmer inherent vowels as warnings; snippets escape them (review A05-02).
- INJ-002 flags words mixing ASCII with fullwidth or mathematical letters, and Latin with Armenian or Cherokee (review A05-10).
- APPS-007 sees XHR requests of any method, `navigator.sendBeacon`, `new Worker`/`SharedWorker`, `<video poster>`,
  `<embed src>` and `<object data>` origins (review A05-07).

### Changed
- The regex rules (INJ-003..010, DATA, POL) match on text with invisible characters folded, so zero-width characters,
  Hangul fillers or the Braille blank can no longer split a keyword (review A05-02).
- TOOL-034's fix no longer suggests a single tool with an `action` parameter, which TOOL-024 flags (review A05-08).
- Rule evaluation builds the text corpus once per run instead of once per rule (faster on large servers).
- INJ, DATA and POL messages whose match needed folded hidden characters end with "(matched with hidden characters
  folded: \u{...})" (review R110-Q1-04).

### Fixed
- APPS-006 now reports a broad wildcard written with an explicit port (`https://*.vercel.app:443`) (review A05-06).
- TOOL-023/025/026 follow a chain of local `$ref`s to the enum or type they judge.
- TOOL-036 checks `$ref`s and collects anchors under property and `$defs` names such as `default`, `enum` or `x-ext`
  (review R110-Q1-01).
- The invisible-character fold also removes U+FEFF, so a BOM can no longer split an INJ-005 keyword (review R110-Q1-02).
- The corpus is rebuilt when a tool object is changed in place between two runs (review R110-Q1-06).

### Security
- A05-01, A05-02 and A05-06 closed detection bypasses (payloads in schema values, invisible characters outside
  `\p{Cf}`, a port on a broad CSP wildcard).

## Proposed spec paragraphs (docs/design/spec.md)
- §1.5 `corpus(snap)`: "`where` is one of `tool.name`, `tool.title`, `tool.annotations.title`, `tool.description`,
  `param.description`, `param.title` (every schema node), `param.enum` (string `enum` values and a string `const`),
  `param.default` and `param.examples` (string leaves of `default`, `examples`, `example`, at most 200 per keyword),
  `param.name` (property keys), `instructions`, ... A scope selects them: `values` (enum/const, default on), `samples`
  (default/examples) and `keys` (property names). INJ-001 reads all; INJ-003 and INJ-005 add samples; POL-003/004 read no
  enum or samples. Hidden-character scans run on the raw text. Regex scans run on `scanForm`: NFKC, then format characters,
  controls other than tab/LF/VT/FF/CR/space (so U+FEFF too), CGJ, U+17B4/17B5 and variation selectors removed and Hangul fillers and U+2800 replaced by a
  space. The corpus is built once per snapshot."
- §1.5 `extractOrigins`: add `<video poster>`, `<embed src>`, `<object data>` (resource, tag); `.open('<any method>', ...)`
  and `navigator.sendBeacon(` (connect, js); `new Worker(`/`new SharedWorker(` (resource, js).
- §1.5 `enumValues(node, {open})`: "with `open`, the const/enum values of an anyOf/oneOf are returned even beside a free
  branch (TOOL-023/024)".
- §2.4 INJ-001: add "- A run of two or more variation selectors (U+FE00–FE0F, U+E0100–E01EF) → error. A single variation
  selector on a base it is not defined for, U+3164, U+FFA0, U+115F/U+1160 outside a conjoining-jamo syllable, U+2800
  outside Braille text, U+034F, U+17B4, U+17B5 → **warning**. Property names, schema titles, enum/const, default and
  examples are scanned too."
- §2.4 INJ-002: "... Latin together with Cyrillic, Armenian, Cherokee or a Greek lookalike, or ASCII letters together with
  fullwidth Latin (U+FF21–FF5A) or Mathematical Alphanumeric Latin letters (U+1D400–1D6A5). Invisible characters are
  removed before words are split."
- §2.3 new: "**TOOL-036 Every $ref resolves inside the schema.** Severity: spec=warning. Detect, for `inputSchema` and
  `outputSchema`: a `$ref`, `$dynamicRef` or `$recursiveRef` whose `#/...` pointer names nothing, whose `#name` fragment
  names no `$anchor`/`$dynamicAnchor` (or draft-07 `$id: '#name'`), or that is relative while the root has no absolute
  `$id` and no embedded resource has that `$id`. References inside an embedded resource and data keywords are skipped;
  absolute references to other documents are TOOL-019. Inside `properties`, `patternProperties`, `$defs`,
  `definitions` and `dependentSchemas` every key is a name and is walked. Source: https://modelcontextprotocol.io/specification/2026-07-28/basic#ref-resolution,
  https://json-schema.org/draft/2020-12/json-schema-core#section-8.2.3.1"
- §2.7 APPS-006: "A wildcard's host part decides breadth: a port or path does not narrow it."

## Tests run
- `npm run typecheck`: clean. `npm run build`: clean.
- `npx vitest run` on the new tests and the existing tests of the changed modules (28 files): 636 passed:
  `test/r110-q1-*.test.ts` (6 files, 54 tests), `test/rules/{content,injection,tools,apps,server}.test.ts`,
  `test/r3-p5-content-rules`, `remediation-w3b-probe-rules`, `remediation-w4b-{schema-lint,tool-budget,tool-names}`,
  `remediation-wp5-apps`, `remediation-wp6-inj-data-pol`, `remediation-wp8-tools-schema-rt`, `remediation-w6a-schema`,
  `r3-p7-schema`, `util`, `real-servers`, `r101-integration`, `catalog`, `engine`, `incomplete`, `cli-rules`.
- `test/e2e-stdio.test.ts`: 25 passed (one test timed out at load average 43 and passed on a rerun at 22).
- `test/docs.test.ts`: 1 expected failure until `readme:rules` is run (fixed on r110-Q1-fix, see R110-Q1-03).
- r110-Q1-fix: see the fixer run below.

### Fixer run (r110-Q1-fix)
- `npm run typecheck`, `npm run build`: clean.
- The 25 files listed above plus `test/rules/` (34 files): 794 passed, `test/docs.test.ts` included.
- `test/e2e-{redaction,stdio}`, `redact`, `redaction-tiers`, `remediation-wp9-report-redact`, `report`,
  `r3-p7-large-report` (7 files): 215 passed.
