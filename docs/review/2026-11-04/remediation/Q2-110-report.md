# Q2 (1.1.0): Protocol and listings

Branch `r110-Q2`, based on `85e74ac` (Release 1.0.1). I applied the WIP from `r110-wip-2` with `cherry-pick -n`, reviewed it, completed it (C-02 was missing, and so were all the tests) and split it into one commit per item. No rule ids, options, config keys, exit codes or report fields were removed or renamed. No new options. The only new output is finding messages, and those carry no user values beyond paths and package specs that existing messages already print. They go through the same report redaction as before.

## Items

### A04-05: SRV-015 reads the 2026-07-28 tasks extension (fixed)
- `src/rules/server.ts`: SRV-015 now checks every capability object the server announced. It uses `capabilitySources` from `spec.ts` (now exported, together with `TASKS_KEY`), so the `server/discover` object of a dual-era server is checked as well. `tasks` is reported when `capabilities.tasks` is present, or when `capabilities.extensions` has `io.modelcontextprotocol/tasks` as an own key (`Object.hasOwn`, so no prototype lookup). The rationale names the extension.
- Tests: `test/r110-q2-protocol.test.ts` covers a modern server with the extension, a dual server that has it only in server/discover, the legacy `capabilities.tasks`, an inherited key that is not reported, and the clean case. The first two failed before the change.

### A04-06 (disputed): SPEC-013 integer ttlMs (fixed, as a warning)
- Decision: the repo has no copy of the caching text, so I read the cited public page (https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching). It says: "The Time-to-live (TTL) Field, `ttlMs`, is an integer value in milliseconds", and separately "Servers MUST provide a `ttlMs` value that is `>= 0`". The integer type is therefore part of the spec. The MUST covers only `>= 0`, though, and the design spec (docs/design/spec.md SPEC-013) only says "finite number >= 0 -> error". So a fractional value is now reported as a **warning**, and the existing error stays unchanged for a missing, non-number or negative value.
- `src/rules/spec.ts`: new message `<method>: ttlMs is not an integer number of milliseconds` with severity warning. Also new: a `severityNote`, an updated rationale, and the fix text "an integer >= 0".
- Tests: `test/r110-q2-protocol.test.ts` checks that 1.5 gives a warning (failed before), that -1 and a missing value are still errors, and that 0 and 300000 pass.

### A06-06 reverse case: text with `<svg` is not an SVG (fixed; 1.0.1 deferral)
- `src/listing/image.ts`: removed the marked 1.0.x compatibility branch in `sniffFormat`. Only a root `<svg` element after the prologue now counts as SVG.
- Tests: `test/r110-q2-svg.test.ts` checks that a text note that mentions `<svg`, a lone commented `<svg`, and HTML that wraps `<svg>` all have no format, and that a real SVG still has its size. An end-to-end check shows that `logo.png` holding such text gets LST-027 "is not a PNG, JPEG, WebP or SVG image". Both failed before. The existing A06-06 tests in `test/r3-p6-listings.test.ts` (long licence comment, comment before the root) still pass.

### A06-11: a font as plugin icon (fixed)
- `src/rules/listing.ts`: LST-014 tests the icon against a new `ICON_IMAGE` (`png|jpe?g|gif|webp|svg`). `MEDIA` is kept only for the 256 KiB size exemption.
- Tests: `test/r110-q2-icon.test.ts` checks that `icon.woff2`, `.ttf`, `.otf` and `.eot` (existing files) each give "is not an image file path", and that plugin-valid stays clean. This failed before.

### C-01: LST-008/LST-009 launcher forms (fixed)
- `src/rules/listing.ts`:
  - New exported `unwrapArgv` looks through up to four wrappers. It handles `env` (with `K=V` words, `-u/-C` values, `--`, `-S`/`--split-string`), `cmd`/`cmd.exe` with `/c` or `/k` (only when it is preceded by `/` options; a single command string is split into words), and `sh/bash/zsh/dash/ash/ksh -c` (also `-lc`; a leading `exec` is dropped).
  - `launcherOf` now also recognises `npm exec` / `npm x` (same as npx), `pnpx` (pnpm dlx), `bun x` (bunx) and `uv tool run` (uvx). `npm run`, `bun run` and `uv tool install` are not launchers.
  - `Launcher` gained a `kind` field, the canonical launcher. `launcher` keeps the form as written, so messages read `runs npm exec "pkg" ...`. The directory block text `(blocks: Unpinned npx launcher)` is chosen by `kind`.
  - `uv run` now counts `--locked`/`--frozen` only among uv's own options before the script or `--`. Value-taking uv options (`--with`, `--directory`, ...) skip their value.
- Severity is unchanged (claude: error). This is the same documented block, now applied to more spellings of it. The LST-008 rationale lists the new forms.
- Tests: `test/r110-q2-launchers.test.ts` has unit cases for every form and wrapper, negatives (`node`, `cmd` without `/c`, `sh start.sh`, `npm run`, `bun run`, `uv tool install`), and the uv run flag position. An end-to-end check runs a plugin-valid copy with `.npmrc` `registry=` for npm exec, npm x, bun x, pnpx, uv tool run, cmd /c npx and env A=1 npx, and expects both LST-008 and LST-009 on each. It also checks the message text, that `cmd /c npx pkg@1.4.2` stays clean, and that `uv run server.py --locked` gives LST-008. All of these failed before.
- Existing test changed: `test/remediation-w6b-listing.test.ts` has two `toEqual` assertions on `launcherOf` results. They now include the new `kind` field (`kind: 'npx'`, `kind: 'uv run'`). Behaviour is otherwise unchanged.

### C-02: pyproject.toml uv index in LST-009 (fixed)
- `src/listing/load.ts`: `pyproject.toml` (at any depth) is added to `PACKAGE_CONFIG_FILES`. It is kept in `packageConfigs` only when its text mentions `uv`, so other pyproject files do not show up in the `--verbose` dump. `src/listing/types.ts`: doc comment.
- `src/rules/listing.ts`: new exported `pyprojectSetsUvSource`. It reports an `[[tool.uv.index]]` table, and `index` / `index-url` / `extra-index-url` / `default-index` / `find-links` keys in `[tool.uv]` or `[tool.uv.pip]`, also as dotted keys (`tool.uv.find-links = ...`, or `[tool]` with `uv.index-url = ...`). Other tools' tables (`[tool.pdm]`, `[[tool.poetry.source]]`) and `[tool.uv.sources]` are not read. LST-009 uses this function for pyproject.toml and `PACKAGE_SOURCE` for every other file. The LST-009 rationale mentions pyproject.toml. Severity is unchanged.
- Tests: `test/r110-q2-pyproject.test.ts` checks that `[[tool.uv.index]]` next to `uv run` is reported. It also checks five other forms next to `uvx`, in a nested `server/pyproject.toml`. Three negative cases stay clean: uv dev-dependencies, pdm/poetry index keys, and `[tool.uv.sources]` path. The positive cases failed before.
- Not covered: an inline-table form `tool.uv = { index-url = "..." }` at top level (rare).

## notFixed
None. Every item is fixed. A04-06 is fixed as a warning rather than an error, for the reason given above.

## Proposed CHANGELOG lines (1.1.0)
- **Added**
  - LST-008/LST-009 recognise more launcher forms: `npm exec`, `npm x`, `pnpx`, `bun x` and `uv tool run`, also behind `env K=V`, `cmd /c` and `sh -c` (review C-01).
  - LST-009 reads the uv package-index settings in `pyproject.toml` (`[[tool.uv.index]]`, and the `index-url`/`extra-index-url`/`find-links` keys of `[tool.uv]` and `[tool.uv.pip]`) (review C-02).
  - SPEC-013 warns when `ttlMs` is not an integer (the caching page defines it as an integer value in milliseconds) (review A04-06).
- **Changed**
  - SRV-015 notes the 2026-07-28 `io.modelcontextprotocol/tasks` extension, and checks the server/discover capabilities of a dual-era server (review A04-05).
- **Fixed**
  - LST-008: `uv run server.py --locked` is no longer taken as pinned; `--locked`/`--frozen` count only before the script (review C-01).
  - LST-014 no longer accepts a font file (`.woff2`, `.ttf`, `.otf`, `.eot`) as the plugin icon (review A06-11).
  - A text file whose first 4 KiB mention `<svg` without an SVG root element is no longer taken as an SVG image. The 1.0.x compatibility branch is removed (review A06-06).
- **Rules added**: none (no new rule ids).
- **Severity raised**: none on existing findings. New finding kinds: SPEC-013 warning (fractional ttlMs); LST-008/LST-009 errors on newly recognised launcher forms and on pyproject.toml.

## Proposed docs/design/spec.md paragraphs
- SPEC-013 Detect, after the first bullet: "`ttlMs` is a number ≥ 0 but not an integer → warning (the caching page defines ttlMs as an integer value in milliseconds; the MUST covers only ≥ 0)."
- SRV-015: "tasks is noted for `capabilities.tasks` (2025-11-25) and for an own key `io.modelcontextprotocol/tasks` in `capabilities.extensions` (2026-07-28). Every capability object the server announced is read (initialize and server/discover on a dual-era server)."
- LST-008 (around line 1170): "Launchers: npx (also `npm exec`, `npm x`), bunx (`bun x`), pnpm dlx (`pnpx`), yarn dlx, uvx (`uv tool run`), pipx run, uv run. Leading `env [K=V ...]`, `cmd /c` and `sh -c` wrappers are looked through. uv run needs --locked/--frozen among its options before the script or `--`."
- LST-009: "Package configuration files include a `pyproject.toml` with uv settings; only its `[[tool.uv.index]]` tables and the index keys of `[tool.uv]` / `[tool.uv.pip]` count."
- Listing image formats: "An SVG is recognised only by its root element after the prologue. An `<svg` tag elsewhere (in a comment or in a text file) is not an SVG (A06-06; the 1.0.x compatibility branch is removed in 1.1.0)."

## Verification
- `npm run typecheck`: clean. `npm run build`: clean. `node scripts/rules-table.mjs --check`: the rules table is unchanged, because no titles changed.
- New tests: `test/r110-q2-protocol.test.ts` 5, `test/r110-q2-launchers.test.ts` 5, `test/r110-q2-pyproject.test.ts` 3, `test/r110-q2-icon.test.ts` 1, `test/r110-q2-svg.test.ts` 2. Total 16, all passing. I checked that each item's tests failed against the 85e74ac sources.
- Existing files of the changed modules:
  - `test/rules/server.test.ts` + `test/rules/spec.test.ts` + `test/e2e-http.test.ts` + `test/p5b-docs.test.ts` + `test/r3-p9-docs.test.ts` + protocol: 6 files, 152 tests, all passing.
  - Listings: `test/remediation-w6b-listing.test.ts`, `test/rules/listing.test.ts`, `test/r3-p6-listings.test.ts`, `test/p6-listing-offline.test.ts`, `test/remediation-w6f-listing-cli.test.ts`, `test/remediation-w6h-review-fixes.test.ts`, `test/r101-integration.test.ts`, `test/r3-p7-schema.test.ts`, `test/r3-p1-cli-config.test.ts`, plus the four new listing files: 13 files, 174 tests, all passing.
