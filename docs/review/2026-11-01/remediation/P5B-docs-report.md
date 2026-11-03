# P5B-docs report (release 0.5.0)

## Done

- README split: overview, install note, Quick start (5 steps), common commands (Usage), short Exit codes table, a short Token recipe (kept because `AUTH_NOTICE` says "Token recipe in the README"), Example output, Guide table, Rules, Compared with other tools, FAQ, Stability policy, Limitations, Development, License. 568 to 235 lines. The generated markers (`RULE_COUNT`, `CATALOG_DATE`, example header) stay in the README; `scripts/rules-table.mjs` is unchanged and shows no drift.
- `docs/guide/`: `options-and-config.md` (options, config, formats, drift, JSON Schema, full exit codes, local mode), `ci.md` (all recipes, GitHub Action, Docker Compose, NEW complete GitLab recipe with JUnit and baseline cache, NEW Docker, NEW pre-commit), `auth.md`, `listings.md`, `privacy-and-requests.md` (what the tool sends, privacy, redaction), NEW `troubleshooting.md`, NEW `walkthrough.md`. Moved text is verbatim; heading levels and relative links were rewritten by script.
- Anchors: every `#anchor` link in README and the guide was remapped to its new home; CONTRIBUTING.md now points to `docs/guide/privacy-and-requests.md` and to the guide for the version lines. No `src/` or SECURITY.md links used README anchors (AUTH_NOTICE names the section, which still exists).
- `Dockerfile` (two stages, `node:22-alpine` pinned by digest `sha256:fe4f6d74...` resolved from the registry on 2026-11-03, `npm install --global --ignore-scripts mcp-review-check@$VERSION`, user `reviewer` uid 10001, `ENTRYPOINT ["mcp-review-check"]`), `.dockerignore`.
- `.github/workflows/docker.yml`: on `v*.*.*`; job `build` waits for the npm version, builds and smoke-tests; job `push` (`packages: write`) pushes `:<version>` and, for a final release, `:latest`, amd64 and arm64. docker/* actions pinned by SHA from `git ls-remote` tag lists (setup-buildx v3.9.0, login v3.7.0, build-push v6.9.0); the lists were read in lexical order, so a newer patch such as v6.10 may exist: recheck.
- `.pre-commit-hooks.yaml` (id `mcp-review-check`, `language: node`, `pass_filenames: false`, `always_run: false`, `files` regex), documented in `ci.md` with a `language: system` fallback.
- Tests: new `test/p5b-docs.test.ts` (links and anchors in README and guide, YAML parse via python3 `yaml` when present plus an indentation lint, GitLab recipe contents, Dockerfile shape, hook shape). Adapted `test/docs.test.ts` (reads sections from the guide) and `test/workflows.test.ts` (docker.yml in the file list; `docker.yml: push` is the third writer, `packages: write`).

## Deferred / not verified

- The Docker image and docker.yml were not built or run (no docker here). The pre-commit hook was not run with pre-commit: a `language: node` hook packs the repo and `prepack` runs `tsc`, which may fail where devDependencies are not installed; the guide documents a `language: system` fallback.
- Proxy support (`HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY`, credentials redacted) is documented as supported from 0.5.0 in troubleshooting.md, but `src/` has no implementation in this package; it must come from another package or the page is wrong at release.
- Version strings: guides still say `0.4` / `v0.4.0` (as before); the release step bumps them (`grep -rn "mcp-review-check@" README.md docs/guide`). New text already says 0.5 / 0.5.0.
- `package.json` `files` unchanged: the guide stays on GitHub; README links to it are absolute-relative paths that do not resolve on the npm page (see below).

## Tests run

`npm run build`, `npm run typecheck`, `npm run readme:rules` (no drift). `npx vitest run test/p5b-*.test.ts test/docs.test.ts test/remediation-w3c-cli-tests.test.ts test/remediation-w5d-action.test.ts test/remediation-w4d-action.test.ts test/workflows.test.ts test/lifecycle.test.ts test/cta.test.ts test/remediation-w4a-package.test.ts`: 9 files, all passed on the final run (docs and p5b: 26 tests; the earlier run had 71 of 72 passing, the failure fixed by renaming the options page H1).

## Proposed CHANGELOG lines (0.5.0)

### Added
- Step-by-step guide "From zero to directory submission", a Troubleshooting page and a Quick start in the README; the reference moved to `docs/guide/` (options and config, CI, authentication, listings, privacy and requests).
- Complete GitLab CI recipe (JUnit report, baseline cache), pre-commit hook (`.pre-commit-hooks.yaml`) and Docker image `ghcr.io/alisaosipova/mcp-review-check` (published by `docker.yml` on every release tag).

### Changed
- The README keeps the overview and common commands; README anchors such as `#options`, `#config-file`, `#ci-recipes` moved to `docs/guide/`.

## README / --help text not placed

- README quick start and guide links use relative paths (`docs/guide/...`), which do not work on the npm package page because the guide is not in `files`. Either add absolute `https://github.com/alisaosipova/mcp-review-check/blob/main/docs/guide/...` links for npm, or add `docs` to `files`.
- `--help` could end with "Guide: https://github.com/alisaosipova/mcp-review-check/tree/main/docs/guide" (src/cli.ts, not owned).
- The proxy sentence for `--help`/Options: "HTTPS_PROXY, HTTP_PROXY and NO_PROXY are honoured (0.5.0)".

## Spec paragraphs

- Distribution: the tool is also published as an OCI image (`ghcr.io/alisaosipova/mcp-review-check:<version>`, `:latest`) built from the published npm package, and as a pre-commit hook (`mcp-review-check`).
- Proxy (when implemented): requests to the target and to authorization servers go through `HTTPS_PROXY`/`HTTP_PROXY` unless the host matches `NO_PROXY`; proxy URL credentials are redacted in every output; the raw TLS probe does not use the proxy, so its result is inconclusive behind one.
