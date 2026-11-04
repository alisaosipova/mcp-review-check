# P9 Docs facts: remediation report (1.0.1)

Base: `origin/main` at 5c521cb. Files changed: `docs/guide/privacy-and-requests.md`, `docs/guide/options-and-config.md`, `docs/guide/ci.md` (Docker recipe only), new `test/r3-p9-docs.test.ts`. No source code, no existing test changed. No new output, so redaction is unaffected.

## Fixed

### A03-04 Request list leaves out the modern-era probes, including a DELETE

Reproduced first: a `--verbose` run against `test/fixtures/modern-server.ts` (`tasks: 'ok', listen: 'sse'`) traced 26 requests, among them `badVersion (modern)`, `unknownMethod (modern)`, `resourceMissing (modern)`, `headerMismatch (none)`, `headerMismatch (wrong)`, `unknownTool (modern)` and `delete: DELETE ... -> 405`. A dual-era run traced 28.

Change in `privacy-and-requests.md` ("What the tool sends"):
- "about 20 requests" became "20 to 30 requests (`--verbose` lists each one)"; superseded by Review fixes, A03-04 ("20 to 40").
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

1. **SECURITY.md** (not owned by P9) has the same request list and the same "about 20 requests" wording. It still lacks the 2026-07-28 probes and the sessionless DELETE. Apply the same sentence there: in "What the tool sends", add a bullet after "protocol probes" with the wording of the new paragraph in `privacy-and-requests.md`, and change "about 20 requests" to "20 to 40 requests, about 35 to a stateful 2025-11-25 server and about 25 to a stateless 2026-07-28 one" (not "20 to 30": see Review fixes, A03-04).
2. **A01-01 wording vs. P1's code.** The Trust bullet describes the behaviour planned in REMEDIATION.md (P1). It assumes:
   - the keys refused from a discovered file are `url`, `stdio`, `args`, `output`, `jsonOutput`, `saveBaseline`, `header`, `bearer` and `activeAuth`;
   - they are ignored with a warning, not rejected;
   - stderr names the file that was applied.

   Superseded by Review fixes, A01-01: the bullet now follows P1's `DISCOVERED_FORBIDDEN`, and the test checks every exported key once P1 is merged.
3. **A08-04 vs. P8's Dockerfile.** If P8 changes the image user (uid, `adduser` line), or adds a writable `WORKDIR` and documents `chown` instead, update the paragraph under the Docker recipe in `docs/guide/ci.md`. Test `A08-04` reads the uid from `adduser -D -u (\d+) ` in the Dockerfile and expects `(uid N)` in the doc.

## Proposed CHANGELOG lines (1.0.1)

### Fixed
- docs: "What the tool sends" names every default request to a 2026-07-28 server: the 2026-07-28 unsupported-version, unknown-method and missing-resource probes, the two `Mcp-Method` header-mismatch `tools/list` probes and, on a modern-only server, the nonexistent-tool call and a `DELETE` without a session id; the count reads "20 to 40 requests", about 35 to a stateful 2025-11-25 server and about 25 to a stateless 2026-07-28 one; the `Origin`-less `initialize` and the session-closing `DELETE`s are named (review A03-04).
- docs: config discovery looks in the `--cwd` directory when `--cwd` is given, otherwise in the working directory, and never in both (review round 3).
- docs: the Docker report recipe runs with `--user "$(id -u):$(id -g)"` so the image's uid 10001 can write the mounted folder on Linux; rootless Docker uses `--user 0:0`, rootless Podman adds `--userns=keep-id` (review A08-04).

### Security
- docs: the config guide states the trust model: a discovered config file sets options only, not the server, output paths, the stdio `cwd` and `env`, credentials, `active` or `activeAuth`; an explicit `--config` can (review A01-01, with the P1 code change).

## Proposed spec paragraph

None needed for `docs/design/spec.md` from P9. If the spec has a request list, the integrator should mirror note 1 there.

## Tests run

- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npx vitest run test/r3-p9-docs.test.ts test/p5b-docs.test.ts test/docs.test.ts`: 3 files, 35 tests passed (8 in `r3-p9-docs.test.ts`). Each new doc assertion was also run against the 5c521cb docs, where it failed.

## Review fixes

### A03-04: "20 to 30 requests" is wrong for a stateful 2025-11-25 server

Confirmed. A `--verbose` run traced 35 requests against `createGoodServer` and `createBadServer` (and 35 for `createUiCapServer`) through `startBridge`, against 24 (modern default), 26 (modern, tasks and listen) and 28 (dual). The legacy trace also showed two facts the list did not state: the `Origin` probe sends four `initialize` requests (one without `Origin`), and each of those, like the preflight, is followed by a `(close session)` `DELETE`; the two fresh connections each end with `sdk DELETE`.

Changes in `privacy-and-requests.md`:
- "By default 20 to 40 requests, about 35 to a stateful 2025-11-25 server and about 25 to a stateless 2026-07-28 one (`--verbose` lists each one)";
- "`initialize` without an `Origin` and with three `Origin` values";
- the DELETE sentence: "each one a stateful server mints for a raw `initialize` probe (the unauthenticated one and the `Origin` ones), is ended with one `DELETE`".

Test `A03-04` now has 5 cases: modern default, modern with tasks and listen, dual, legacy good and legacy bad. It maps `sdk DELETE` and `... (close session)` to the doc's words, checks that the count is within 20 to 40, and checks that the per-era "about" figure is within 3 of the trace. All 5 failed against the previous doc.

### A01-01: Trust list leaves out `cwd`, `env` and `active`

Confirmed against `worktree-wf_c6280a1a-759-1:src/config.ts` (`DISCOVERED_FORBIDDEN`). The Trust bullet now lists the stdio process's `cwd` and `env` and `active`, and says the keys are "ignored with a warning" (P1's help wording). The `--config` row now reads "not the server, output paths, credentials, the stdio process's `cwd` and `env`, or `active`".

Test `A01-01` checks every key of a hard-coded copy of P1's list. It also imports `src/config.ts` and checks every key of `DISCOVERED_FORBIDDEN` when the module exports it. It checks that the `--config` row names `cwd`, `env` and `active`. I ran it with P1's `src/config.ts` copied in temporarily: it passed, and the export was read. The docs still describe behaviour that only P1's code has, so **this branch must merge together with P1** (or after it).

### A08-04 (low): rootless engines do not map ownership

Confirmed by reasoning, not by a run (neither Docker nor Podman is installed on this host). In a rootless engine, container uid 0 is the host user and other container uids map to subordinate uids. So uid 10001 and a `--user "$(id -u):$(id -g)"` uid both land on a subordinate uid that cannot write a folder you own. The note now says:
- Docker Desktop on macOS and Windows works with the recipe;
- rootless Docker: `--user 0:0`, the container's root, which is your host user;
- rootless Podman: add `--userns=keep-id` to the recipe's `--user`, which maps your uid to the same uid in the container.

Test `A08-04` has a third case: the old claim is gone and both rootless recipes are present. The integrator should run the rootless recipes once on a host with those engines before release.

### Tests run for the review fixes

- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npx vitest run test/r3-p9-docs.test.ts test/p5b-docs.test.ts test/docs.test.ts`: 3 files, 39 tests passed (12 in `r3-p9-docs.test.ts`).
