# Q3 CLI behaviour and supply chain: remediation report (1.1.0)

Base: `origin/main` 85e74ac (Release 1.0.1). Branch `r110-Q3`. Files changed: `src/cli.ts`, `src/rules/engine.ts`,
`package.json` (scripts and `files` only, version unchanged), `docs/guide/options-and-config.md`, `docs/guide/listings.md`.
New files: `scripts/shrinkwrap.mjs` and `scripts/shrinkwrap.d.mts` (see A08-03), five test files `test/r110-q3-*.test.ts`.
One existing test was adjusted: `test/process-tree.test.ts` (see the lazy-load section). `src/config.ts`, `src/input-file.ts`
and `src/explain.ts` are unchanged: no new config key and no new rule were needed.

Minor-release check (README "Stability policy"): no option, config key, exit code, report field or rule ID was removed or
renamed. Added: ten switches (`--no-fail-on-spec`, `--no-fail-on-incomplete`, `--no-fail-on-drift`, `--no-diff-only`,
`--no-active`, `--no-active-auth`, `--no-verbose`, `--no-quiet`, `--no-checklist`, `--color`), a new value `rules` of the
existing `limits.stopped.phase` string, warnings on stderr, and a TTY-only status line. Exit-code changes: a run whose rules
pass the `--max-duration` deadline is now exit 4 (as documented in `--help`), and three option combinations that were
exit 2 now run (A01-03).

## Before and after

`dist/cli.js` built from `origin/main` (a `git archive` copy in the scratchpad) and from this branch:

| Case | origin/main | r110-Q3 |
|---|---|---|
| A01-03 `--config` with `stdio`, `env`, `cwd`, `noLocal` + `http://127.0.0.1:9/mcp` | exit 2 `--env and --cwd apply only to --stdio (from …: key "env", key "cwd")` | exit 3 (connect refused): the URL was checked; note `not used from …: key "env" (…), key "cwd" (…)` |
| A01-03 same file + `--local` | exit 2 `give either --local or --no-local, not both (… key "noLocal")` | exit 0, `server.localMode: true` |
| A01-03 `--config` with `url` and `header.Authorization` + `--bearer` | exit 2 `give the token either with --bearer or …` | exit 3 (connect refused), note that the file's Authorization entry was not used |
| `--version` / `--help` startup (median of 15, interleaved, load average 8) | 227 / 233 ms | 40 / 44 ms |
| `explain TOOL-011` / `--list-rules` | 238 / 262 ms | 142 / 151 ms |

A09-04: the triggers of review round 3 (a 60 000-character property name, 200 x 16 KB digit descriptions) no longer make the
rules slow on `origin/main`: the 1.0.1 fixes of A09-01..03 removed them, and the rule phase finishes in well under a second
(both builds: `--max-duration 3000` stops during `tools re-list`, exit 4). The contract gap remained: nothing bounded the rule
phase. The new tests drive it with a clock that jumps past the deadline inside `runRules` (see below).

## Per item

| ID | What changed | Test |
|---|---|---|
| A09-04 | `runRules` takes `deadline` and `now` (`EngineOptions`). Before each rule it checks the clock; once the deadline has passed, that rule and every later one is skipped with `stopped by --max-duration` (a rule outside `--target` keeps its "not applicable" entry), and `EngineResult.stopped` says where (`atRule`, `rulesNotRun`). The CLI passes `deadline = max(t0 + maxDuration, rulesStart + RULES_GRACE_MS)`, `t0` being the clock reading the connect deadline starts from, and `RULES_GRACE_MS = 1000`. When the rules stop, `markRulesStopped` sets `limits.stopped = { maxDurationMs, phase: 'rules', completed: [all phases], unfinished: ['rules'] }` and `coverage = stopped`. The run then reads `INCOMPLETE (stopped at --max-duration during rules)`, gets the junit `<error>` and the GitHub `::error`, writes no `--save-baseline` and exits 4. A snapshot stopped earlier keeps its own stop. The grace exists because a run stopped during connect (or whose deadline fell while connections were closing) must still report what it observed. Limit: the check runs between rules, so one rule that is already running finishes first. A hard bound would need a worker thread, and the snapshot holds `URL` objects that cannot be cloned. `--help` and the options guide say both. | `test/r110-q3-max-duration.test.ts` (7): engine stop and skip reasons; no stop without/before the deadline; `markRulesStopped` + `resultLine`; stdio run exit 4 with `phase: 'rules'`; listing-only text INCOMPLETE; same run without `--max-duration` exit 0; `--max-duration 1` still runs the rules (grace) |
| A01-03 | Merge in `runCli`. (1) `OPPOSITES` pairs: a switch on the command line also skips the file's key for its opposite (`--local` over `noLocal`, `--no-local` over `local`, `--no-quiet` over `quiet`, …). Two opposites from one source (both flags, or both keys) are still exit 2, `give either --a or --b, not both`, generalising the old local check. (2) A `<url>` on the command line drops the file's `env` and `cwd`. A `--stdio` command drops its `header`, `bearer` and `activeAuth`. One stderr note lists what was not used. (3) `--bearer` on the command line removes the `Authorization` entry from the file's headers (other headers stay). An `Authorization` `--header` on the command line drops the file's `bearer`. (4) New switches `--no-fail-on-spec`, `--no-fail-on-incomplete`, `--no-fail-on-drift`, `--no-diff-only`, `--no-active`, `--no-active-auth`, `--no-verbose`, `--no-quiet`, `--no-checklist` and `--color` (for `noColor`). Each turns its option off. `--local`/`--no-local` keep their meaning. No config keys were added. | `test/r110-q3-config-precedence.test.ts`, 12 cases under "A01-03" (url/env/cwd, `--local`/`noLocal`, `--no-local`/`local`, same-source conflicts, `--bearer`/Authorization with no token in any output, Authorization `--header`/`bearer`, `--stdio`/header+bearer+activeAuth, file url + CLI `--env` still exit 2, every boolean key has an opposite, `--no-fail-on-spec`, `--no-quiet --no-checklist`, `--color --no-color`) |
| format warnings | `formatWarnings()` warns about switches the chosen `--format` does not use, when they are given on the command line: `--quiet` and `--checklist` (text only) and `--diff-only` (text and markdown, and not when a GitHub job summary is written, which is markdown). A config key gets no warning, since one file serves runs in several formats. The existing `--sarif-location` warning is unchanged. | same file, 3 cases (`--checklist`+json, `--quiet`+sarif; no warning for file keys; `formatWarnings` unit incl. job summary) |
| A08-03 | `scripts/shrinkwrap.mjs` writes `npm-shrinkwrap.json` from `package-lock.json`: the root entry without `devDependencies` (name and version from package.json), plus every non-dev package (96 today). It refuses a lockfile whose dependencies differ from package.json. `prepack` is `npm run build && node scripts/shrinkwrap.mjs`, `postpack` removes the file, and `files` lists it. Checked: `npm pack --dry-run --json` lists `npm-shrinkwrap.json` (41 KB, 68 entries) and no `package-lock.json`, and the file is gone afterwards. A real `npm pack`, then `npm install --offline <tgz>` in a scratch project, installed exactly 97 packages (undici 7.30.1, zod 4.6.7 as locked, no typescript). Why it is not committed: in the checkout `npm-shrinkwrap.json` takes precedence over `package-lock.json`, so a production-only file would make `npm ci` fail on the missing dev dependencies, and a full one would replace `package-lock.json` (which `audit.yml`, `ci.yml` and Dependabot read). It is a pack-time artifact instead. | `test/r110-q3-shrinkwrap.test.ts` (5): exact production set, no dev package, integrity of each direct dependency; root entry; stale lockfile refused; package.json wiring and no file left in the checkout; `npm pack --dry-run` of a clean copy |
| lazy load (Q4 improvement) | `cli.ts` imports only light modules statically (`stdioArgs`, `config`, `catalog`, `version`, `report/index`, `report/json`, `report/github`, `report/drift`, `listing`, `snapshot`, `input-file`, `rules/util/*`), checked by a static import-closure scan with no third-party package. `--help`/`--version` load nothing more. `--list-rules`/`explain` load `rules/index.js` and `explain.js` only. A check loads the rest once (`loadCheckModules`: proxy, connect, diagnose, redact, renderers, rules, probes, baseline). The proxy is no longer installed at module start: the entry point sets `proxyOnCheck`, and the first check installs it before anything connects. A bad proxy variable is still exit 2 with the same message for a check, and still ignored by `--help`/`--version`/`--list-rules`/`explain`. The old `offline` argv scan, which also matched a `-v` or `--help` meant for the server after `--`, is gone. `test/process-tree.test.ts` adjusted: it emulates win32 around the first `runCli`, which now evaluates the SDK modules lazily under the emulated platform. The test now imports `src/connect.js` first, as the static import used to. | `test/r110-q3-lazy-load.test.ts` (3, Node resolve hook records every loaded URL): `--version`/`--help` load no connect, proxy, rules, renderer, explain or `node_modules`; `explain`/`--list-rules` load no connect.js or MCP SDK; bad `HTTPS_PROXY`: `--help` and `explain` exit 0, a check exit 2 with `error: HTTPS_PROXY: unsupported proxy scheme …` |
| phase line (1.0.1 deferral) | `phaseLine()` draws `mcp-review-check: <phase>… N s` on stderr with `\r` + erase-line, every second (`unref`'d timer). It is cleared before `onStall` messages and stopped (line erased) in a `finally` after `buildSnapshot`, before any report output. It is also erased on a signal. It is shown only when stderr is a TTY (the entry point passes `process.stderr.isTTY` as the new optional fifth `runCli` parameter, default false, so in-process callers never get it), `CI` and `GITHUB_ACTIONS` are unset, `--quiet` is not given and the run is not listing-only. It names a phase, never the server, URL or a value. The phase comes from an `onPhase` callback that `connect.ts` does not call yet (see integrator notes), so until then the line reads `connecting… N s` for the whole connect and probe time. | `test/r110-q3-phase-line.test.ts` (5): drawing, redraw, stop; disabled; wanted only on TTY outside CI; runCli with TTY stderr draws and erases it, no secret or server in it, the returned stderr has none; no line without TTY, in CI, with `--quiet` |
| A01-01 docs | `docs/guide/listings.md`, where the listing guide mentions the config file: a plugin folder or package under review can bring its own config file. A discovered file sets options only (server, outputs, cwd/env, header/bearer, active, activeAuth are ignored with a warning; stderr names the file). Its other keys (`ignore`, `failOn`) still change the result, so `--no-config` or your own `--config` is the way to check someone else's folder on your terms. | `test/docs.test.ts`, `test/r3-p9-docs.test.ts` still pass |

## Not fixed

- Hard interruption of a single slow rule (A09-04 "for a hard bound, run runRules in a worker_thread"): the snapshot holds
  `URL` objects and closures (rule `check` functions), which a worker cannot receive, so this would mean serialising the
  snapshot. The deadline is checked between rules. Removing the quadratic rule paths themselves was A09-01..03 (1.0.1).
- `explain`/`--list-rules` still load undici (`rules/auth.ts` and `rules/server.ts` import `diagnose.ts`, which imports
  `proxy.ts`) and ajv (`rules/schema.ts`), about 100 ms. Those files are not in this package; see integrator notes.

## Review fixes

| Finding | Fix | Tests |
|---|---|---|
| medium: a rules-phase stop lists phases that never ran in `limits.stopped.completed` | `buildSnapshot` returns `BuildResult.completed`, the phases the run really went through (`progress.completed`, plus the phase it returned in unless that is `closing`), set only when no deadline or budget stopped it. `markRulesStopped(snap, ms, ran)` writes that list (a listing-only run: `[]`) instead of the whole `PHASES` list. A stdio run without `--active` now reports `connect, listing, UI resource reads, wire probes, tools re-list, text-only tools/list` (no `auth probe`, no `active tool calls`). Touches `src/connect.ts` (additive field), outside this package's files. | `test/r110-q3-max-duration.test.ts` (8): unit test passes the ran list and checks it exactly; the stdio CLI run (repro from the finding) has `connect` and `listing` but not `auth probe` or `active tool calls`; new: a listing-only stop has `completed: []` |
| low: the docs say the phase line shows the phase, but it always reads `connecting` | `BuildOptions.onPhase` in `src/connect.ts`, kept on `Progress` and called from `advance()` on each phase change (a throwing callback is ignored); `cli.ts` sets `opts.onPhase` without the cast. Phase names are constants, never server data. The docs line in `docs/guide/options-and-config.md` is now true; unchanged. | `test/r110-q3-phase-line.test.ts`: the TTY run draws `listing… N s` and `wire probes… N s` |
| low: `npm-shrinkwrap.json` is not in `.gitignore` | `.gitignore` has `/npm-shrinkwrap.json`. `npm pack --dry-run` still lists it (the `files` entry and npm's own rule for the shrinkwrap win over `.gitignore`), checked by hand and by the clean-copy pack test, which copies `.gitignore`. | `test/r110-q3-shrinkwrap.test.ts` (6): `.gitignore` lists it; the pack test still finds it in the tarball |

## Proposed CHANGELOG lines (1.1.0)

### Added
- `--no-fail-on-spec`, `--no-fail-on-incomplete`, `--no-fail-on-drift`, `--no-diff-only`, `--no-active`, `--no-active-auth`, `--no-verbose`, `--no-quiet` and `--no-checklist`, and `--color` (for `noColor`): turn off on the command line a switch the config file turns on (review A01-03).
- A status line on a terminal's stderr while the check connects and probes (phase and elapsed seconds), cleared before the report; never in CI, without a TTY or with `--quiet`.
- A warning when a switch given on the command line is not used by the chosen `--format`: `--quiet` and `--checklist` (text only), `--diff-only` (text and markdown).

### Changed
- `--max-duration` also bounds the rule evaluation: rules not started by the deadline are skipped (`stopped by --max-duration`), the run reads `INCOMPLETE (stopped at --max-duration during rules)` and exits 4, as `--help` documented. The rules get at least 1 s, so a run whose connect phases used up the time still reports what they observed (review A09-04).
- A command-line option now overrides the config file's opposite or transport-specific key instead of failing with exit 2: `--local` wins over `noLocal` (and the reverse), a `<url>` ignores the file's `env` and `cwd`, a `--stdio` command its `header`, `bearer` and `activeAuth`, and `--bearer` replaces the file's `Authorization` header. A note on stderr names what was not used (review A01-03).
- `--version` and `--help` start about 5x faster (no transport, rules or renderers loaded); `explain` and `--list-rules` load the rules but not the transport.

### Fixed
(Both are fixes to the 1.1.0 lines above, not to a released version: fold them in if those lines ship together.)
- A `--max-duration` stop during the rules lists in `limits.stopped.completed` only the phases the run went through, not every phase a run can have (review Q3-110).
- The terminal status line shows the phase the check is in (`listing`, `wire probes`, …), not `connecting` for the whole run (review Q3-110).

### Security
- The npm package ships `npm-shrinkwrap.json` with the production dependency tree of `package-lock.json`, so `npx mcp-review-check`, a global install, the GitHub Action and the Docker image install the tree CI tested and audited, not whatever the version ranges resolve to that day (review A08-03).

### Docs
- `docs/guide/listings.md`: the trust model of a discovered config file in a plugin folder under review (review A01-01).

Rules added / Severity raised: none.

## Proposed spec paragraphs (docs/design/spec.md)

- `--max-duration` (next to "Overall deadline for the whole check"): "The deadline also bounds the rule evaluation. The
  engine checks it between rules (`EngineOptions.deadline`); the rules not started by then are skipped with `stopped by
  --max-duration`, and the CLI records `limits.stopped` with `phase: "rules"`, `unfinished: ["rules"]`, so the run is
  INCOMPLETE and exits 4. The rules get at least `RULES_GRACE_MS` (1000 ms) after they start: a deadline that passed
  during the connect phases or while connections closed does not skip them all. A running rule is not interrupted."
- Config precedence: "A switch on the command line replaces the config key of that switch and of its opposite (OPPOSITES
  in cli.ts). Every boolean key has a command-line opposite (`--no-<switch>`, `--color` for `noColor`, `--local` and
  `--no-local` for each other). When the command line names the server, the file's keys of the other transport are not
  used (a `<url>`: `env`, `cwd`; `--stdio`: `header`, `bearer`, `activeAuth`), and `--bearer` replaces the file's
  `Authorization` header, each with one note on stderr. Two conflicting values from one source are a usage error."
- Packaging: "The tarball carries `npm-shrinkwrap.json`, generated by `prepack` from `package-lock.json` (production
  packages only) and removed by `postpack`; it is never committed."
- CLI startup: "cli.ts loads the transport, rules and renderers on the first check (`loadCheckModules`); the proxy is
  installed then, before the first connect."

## Integrator notes (outside this package)

1. Phase line: done in the review fixes below (`src/connect.ts` `BuildOptions.onPhase`, called from `advance()`).
   `src/connect.ts` is outside this package's files: the integrator should check it against other packages' edits there.
2. `.gitignore`: done in the review fixes below.
3. Faster `explain`/`--list-rules`: in `src/proxy.ts`, import undici lazily inside `installProxy` (for example
   `createRequire(import.meta.url)('undici')`, or make `installProxy` async and `await import('undici')`; the CLI calls it
   once in `runCli` before the connect). That cuts about 70 ms from every command that loads the rules.
4. README / `docs/guide/ci.md` next to the "pin a tag or SHA" advice (A08-03 verifier note): "the npm package ships
   `npm-shrinkwrap.json`, so its dependency tree is fixed per release; the Action's `version` input still floats over
   1.x.y patch releases unless you pin it to an exact version."
5. CI (`ci.yml`, pack smoke step): after `npm pack`, check `tar -tzf mcp-review-check-*.tgz | grep -q package/npm-shrinkwrap.json`
   and `test ! -e npm-shrinkwrap.json`.

## Tests run

- `npm run typecheck`, `npm run build`: clean.
- New: `test/r110-q3-max-duration.test.ts` 7, `test/r110-q3-config-precedence.test.ts` 15, `test/r110-q3-lazy-load.test.ts` 3,
  `test/r110-q3-phase-line.test.ts` 5, `test/r110-q3-shrinkwrap.test.ts` 5: 35 passed.
- Existing files of the changed modules (each batch passed): `max-duration`, `engine`, `incomplete` (26); `local-mode`,
  `remediation-wp1-cli`, `remediation-w5a-config`, `r3-p1-cli-config`, `output-modes` + new config test (102); `docs`,
  `compat`, `r3-p9-docs`, `p5b-docs` (45); `p5a-proxy`, `r3-p1-fatal`, `compat`, `stderr-flush`, `r101-integration` (40);
  `cli-rules`, `e2e-stdio`, `e2e-redaction`, `ci-output`, `remediation-w4a-exit-codes`, `remediation-w3c-cli-tests`,
  `r3-p1-review-fixes`, `process-tree`, `windows`, `lifecycle` (168; `process-tree` 2 failed before the adjustment above,
  11/11 after); `output-modes`, `remediation-wp9-report-redact`, `redaction-tiers`, `incomplete`, `remediation-w4c-connect`,
  `r3-p7-review-fixes`, `workflows`, `remediation-w4a-package`, `repo-config` (91); `p6-listing-offline`, `r3-p6-listings`,
  `r3-p1-baseline-cap`, `r3-p7-schema`, `remediation-w6h-review-fixes`, `root-causes`, `remediation-w5a-junit`,
  `remediation-wp2-connect`, `cta`, `e2e-http`, `p7-protocol`, `r3-p2-transport`, `remediation-w4a-baseline`, `redact`,
  `remediation-w6f-listing-cli`, `remediation-w6a-drift`, `catalog-stale`, `remediation-w5a-json-output`, `sarif` (258);
  `pack`, `remediation-w6a-schema` + shrinkwrap (12). Every test file that calls the CLI was run except `live.test.ts`
  (network). The whole suite was not run, as instructed.
