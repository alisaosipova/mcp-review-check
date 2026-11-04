# P9 Docs facts: remediation report (1.0.1)

Base: `origin/main` at 5c521cb. Files changed: `docs/guide/privacy-and-requests.md`, `docs/guide/options-and-config.md`, `docs/guide/ci.md` (Docker recipe only), new `test/r3-p9-docs.test.ts`. No source code, no existing test changed. No new output, so redaction is unaffected.

## Fixed

### A03-04 Request list leaves out the modern-era probes, including a DELETE

Reproduced first: a `--verbose` run against `test/fixtures/modern-server.ts` (`tasks: 'ok', listen: 'sse'`) traced 26 requests, among them `badVersion (modern)`, `unknownMethod (modern)`, `resourceMissing (modern)`, `headerMismatch (none)`, `headerMismatch (wrong)`, `unknownTool (modern)` and `delete: DELETE ... -> 405`. A dual-era run traced 28.

Change in `privacy-and-requests.md` ("What the tool sends"):
- "about 20 requests" became "20 to 30 requests (`--verbose` lists each one)".
- New paragraph after the 0.7.0 one: a 2026-07-28 server also gets the unsupported-version, unknown-method and missing-resource probes in their 2026-07-28 form and two `tools/list` requests with a missing or mismatched `Mcp-Method` header. A modern-only server also gets the 2026-07-28 `tools/call` for the nonexistent tool and one `DELETE` without a session id, which should be answered with 405 (SPEC-015). None of these change state.

Tests: `A03-04: the request list names every default request to a 2026-07-28 server` (3 cases: modern-only, dual era, the DELETE). Each case runs the CLI with `--verbose`, maps every traced label to the words in the doc that name it, and checks the count is between 20 and 30. A probe added later without a doc update fails the test. All 3 failed against the old doc and pass now.

### A01-01 (docs part) Trust model of a discovered config file

The package note asks for this. The code change belongs to P1. `options-and-config.md` now says:
- in the `--config` table row: a discovered file sets options only, not the server, output paths or credentials;
- a new **Trust** bullet in "Config file": a discovered file's `url`, `stdio`, `args`, `output`, `jsonOutput`, `saveBaseline`, `header`, `bearer` and `activeAuth` are not applied, stderr names the config file that was applied, and `$MCP_REVIEW_CHECK_TOKEN` goes only to a server named on the command line or in an explicit `--config`. A file named with `--config` is trusted and can set all of these keys.
- **Secrets**: `header` and `bearer` are "accepted from a `--config` file".

Test: `A01-01: options-and-config.md documents the trust model of a discovered config file`. It failed against the old doc and passes now.

### P9 improvement: config discovery with `--cwd`

`src/cli.ts:328` calls `findConfig(values.cwd ?? process.cwd())`, so the file is searched in one directory only, with no fallback. Both places in `options-and-config.md` (the `--config` row and the "Config file" paragraph) now say: the `--cwd` directory when `--cwd` is on the command line, otherwise the working directory; with `--cwd` a file in the working directory is not read. I changed the docs and not the code: adding a fallback would let a config file that was ignored before change a run (P9 does not own `src/`).

Tests: `P9 improvement: config discovery with --cwd is worded as the code behaves`:
- a behaviour guard: a working-directory config with an invalid `failOn` exits 2 without `--cwd` and is not read with `--cwd <other>`;
- a doc check, which failed against the old doc.

### A08-04 (docs part) Docker output-directory permissions

The Docker recipe in `ci.md` now runs `mkdir -p out` and then `docker run --rm --user "$(id -u):$(id -g)" -v "$PWD/out:/out" ...`. A new paragraph explains:
- the image user is `reviewer` (uid 10001);
- on Linux a bind mount keeps its host owner (or root, when Docker creates the folder), so a run without `--user` exits 2 with `cannot write --output ...: EACCES`;
- the alternative is `sudo chown 10001 out`;
- Docker Desktop and rootless engines map ownership.

Docker is not installed on this host, so the container run itself was not executed. The fix follows from the Dockerfile (`adduser -D -u 10001`, `USER reviewer`) and the CLI error path (`src/cli.ts:588`).

Test: `A08-04: the Docker recipe writes a report as a user that can write the mounted folder` (2 cases):
- every `docker run ... -v ... --output` line has `--user "$(id -u):$(id -g)"`, and the recipe has `mkdir -p out`;
- the uid named in the doc equals the Dockerfile's `adduser -u`.

## Not fixed

None. Parts outside P9's files are listed under "Integrator notes".

## Integrator notes

1. **SECURITY.md** (not owned by P9) has the same request list and the same "about 20 requests" wording. It still lacks the 2026-07-28 probes and the sessionless DELETE. Apply the same sentence there: in "What the tool sends", add a bullet after "protocol probes" with the wording of the new paragraph in `privacy-and-requests.md`, and change "about 20 requests" to "20 to 30 requests".
2. **A01-01 wording vs. P1's code.** The Trust bullet describes the behaviour planned in REMEDIATION.md (P1). It assumes:
   - the keys refused from a discovered file are `url`, `stdio`, `args`, `output`, `jsonOutput`, `saveBaseline`, `header`, `bearer` and `activeAuth`;
   - they are ignored with a warning, not rejected;
   - stderr names the file that was applied.

   If P1's final key set or behaviour differs (for example `env`, `baseline` or `toolArgs` are also refused, or a refused key is a usage error), edit the **Trust** bullet in `docs/guide/options-and-config.md`. Edit the key list in test `A01-01` in `test/r3-p9-docs.test.ts` to match.
3. **A08-04 vs. P8's Dockerfile.** If P8 changes the image user (uid, `adduser` line), or adds a writable `WORKDIR` and documents `chown` instead, update the paragraph under the Docker recipe in `docs/guide/ci.md`. Test `A08-04` reads the uid from `adduser -D -u (\d+) ` in the Dockerfile and expects `(uid N)` in the doc.

## Proposed CHANGELOG lines (1.0.1)

### Fixed
- docs: "What the tool sends" names every default request to a 2026-07-28 server: the 2026-07-28 unsupported-version, unknown-method and missing-resource probes, the two `Mcp-Method` header-mismatch `tools/list` probes and, on a modern-only server, the nonexistent-tool call and a `DELETE` without a session id; the count reads "20 to 30 requests" (review A03-04).
- docs: config discovery looks in the `--cwd` directory when `--cwd` is given, otherwise in the working directory, and never in both (review round 3).
- docs: the Docker report recipe runs with `--user "$(id -u):$(id -g)"` so the image's uid 10001 can write the mounted folder on Linux (review A08-04).

### Security
- docs: the config guide states the trust model: a discovered config file sets options only, not the server, output paths, credentials or `activeAuth`; an explicit `--config` can (review A01-01, with the P1 code change).

## Proposed spec paragraph

None needed for `docs/design/spec.md` from P9. If the spec has a request list, the integrator should mirror note 1 there.

## Tests run

- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npx vitest run test/r3-p9-docs.test.ts test/p5b-docs.test.ts test/docs.test.ts`: 3 files, 35 tests passed (8 in `r3-p9-docs.test.ts`). Each new doc assertion was also run against the 5c521cb docs, where it failed.
