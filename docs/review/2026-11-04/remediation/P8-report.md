# P8 Pipeline: remediation report (1.0.1)

Files changed: `action.yml`, `Dockerfile`, `.github/workflows/docker.yml`, `test/p5b-docs.test.ts` (adjusted, see below), new `test/r3-p8-pipeline.test.ts`. `.dockerignore` unchanged (the build context stays the Dockerfile only).

All action SHAs stay pinned; the one new action, `docker/setup-qemu-action`, is pinned to `c7c53464625b32c7a7e944ae62b3e17d2b600130 # v3.7.0` (lightweight tag, `git ls-remote` 2026-11-04). The new service image `registry:2` is pinned by digest `sha256:a3d8aaa63ed8681a604f1dea0aa03f100d5895b6a58ace528858a7b332415373` (the `2` and `2.8.3` tags resolve to it on Docker Hub, 2026-11-04).

## Fixed

### A08-01 multi-line `extra-args` dropped every line after the first
- Reproduced: before the fix, `--timeout 60000\n--ignore TOOL-013\n--fail-on-incomplete` reached the CLI as `--timeout 60000` only.
- Change: `extra=(); IFS=$' \t\r\n' read -r -d '' -a extra <<< "$INPUT_EXTRA_ARGS" || true`. It reads to the end of the value; CR counts as a separator too, so a token cannot keep a trailing `\r`. Splitting still does no globbing and no quote removal, and it works in bash 3.2. The input description now says that newlines split too and that a block scalar may hold one option per line.
- Tests: `A08-01: a multi-line extra-args (YAML block scalar) passes every line to the CLI`, `A08-01: extra-args is still split without globbing or quote removal, and an empty value adds nothing`.
- Stability note: this patch changes no rule and no severity. A workflow that already used a multi-line `extra-args` now gets the options it asked for (for example `--fail-on-incomplete`, `--baseline`, `--ignore`), so its gate can turn stricter or looser to match its own configuration. CHANGELOG must say so (below).

### A08-02 npx ran install scripts with the token in the environment
- Reproduced (with a fake npx/npm on PATH): before the fix, the npm path ran `npx --yes` with lifecycle scripts enabled and `MCP_REVIEW_CHECK_TOKEN` already exported.
- Change: the npm path no longer uses npx. It runs `env -u MCP_REVIEW_CHECK_TOKEN npm_config_ignore_scripts=true npm install --ignore-scripts --no-save --no-package-lock --no-audit --no-fund --prefix "$RUNNER_TEMP/mcp-review-check-$$-pkg" "mcp-review-check@$INPUT_VERSION"`, sending npm's output to stderr. Only after that does it export the bearer input, and then it runs `<prefix>/node_modules/.bin/mcp-review-check`. A token the job set itself is also removed from the install's environment. A failed install now prints `::error title=mcp-review-check::could not install mcp-review-check@<version> from the npm registry`, writes empty `sarif-file`/`report-json` outputs and exits 3 (the "could not run" code). npx's own failure code had looked like a threshold result.
- Tests: `A08-02: installs the npm package with install scripts off and without the token, then runs it with the token`, `A08-02: a token the job already exported does not reach the install either, but reaches the CLI`, `A08-02: a failed install fails the step with exit 3 and a message`.

### A08-06 a bearer with CR/LF was partly printed by `::add-mask::`
- Reproduced: before the fix, the log contained `::add-mask::<first line>` and then the second line as plain text.
- Change: `case "$INPUT_BEARER" in *$'\n'*|*$'\r'*) usage "bearer must not contain CR or LF (the value is not shown)";; esac` runs before anything is echoed. It exits 2, as the CLI does for the same input. A single-line bearer is still masked and passed through the environment only.
- Tests: `A08-06: a bearer with CR or LF is rejected before anything is echoed, and no part of it reaches the log` (LF, CR and CRLF), `A08-06: a single-line bearer is still masked and passed through the environment`.

### A08-04 the Docker `--output` recipe fails with EACCES for uid 10001
- Change: the Dockerfile header documents `mkdir -p out && docker run --rm --user "$(id -u):$(id -g)" -v "$PWD/out:/out" mcp-review-check ... --format json --output /out/report.json`. The CLI writes nothing to its home directory (no `homedir`/`HOME` use in `src/`), so running as an arbitrary uid works. The image still defaults to the non-root `reviewer`. The docker.yml smoke test now runs exactly this recipe on every platform: it writes `/out/report.json` into a `$RUNNER_TEMP/out` host mount as the runner's uid and checks the file is non-empty.
- Tests: `A08-04: the Dockerfile documents running as the host user so a mounted output folder is writable`, `A08-04: the smoke test writes a report into a host mount as the runner user`.
- Integrator: the user-facing recipe in `docs/guide/ci.md` (around lines 260-261) belongs to P9 and needs the same `--user "$(id -u):$(id -g)"` and `mkdir -p out`.

### A08-05 the pushed image was a second build, and arm64 never ran
- Change (docker.yml):
  - `build` job (contents: read only): `docker/setup-qemu-action`, then buildx with `driver-opts: network=host`, then a single `build-push-action` for `linux/amd64,linux/arm64` with `outputs: type=registry,name=localhost:5000/mcp-review-check:test,oci-mediatypes=true`. The target is a `registry:2` service container on the runner only, so the build job never writes to ghcr.io. The step's digest is validated and becomes a job output.
  - The smoke test runs once per platform against `localhost:5000/mcp-review-check@$DIGEST`, using `docker run --rm --pull always --platform "$platform"`. It checks the version, checks that `uname -m` matches the platform (x86_64 / aarch64), does the listing-only run, does the report write into a host mount (A08-04), and checks the uid is not 0.
  - That digest is exported with `skopeo copy --all --preserve-digests` to an OCI archive. The archive's index digest is checked against `$DIGEST`, and the archive is uploaded as an artifact (retention 1 day).
  - `push` job (packages: write): no checkout, no build, no npm. It downloads the archive, re-checks that its digest equals `needs.build.outputs.digest`, and logs in with `skopeo login --password-stdin` (the token is not on argv; logout runs in an EXIT trap). For each tag (`<version>`, plus `latest` for a final release) it runs `skopeo copy --all --preserve-digests`, then checks that the digest ghcr.io serves equals the tested digest. `docker/login-action` and the second `build-push-action` are gone.
  - The header comment now says what is checked ("the same image, by digest").
- Tests: `A08-05: one build for both platforms, smoke-tested per platform, handed to the push job by digest`, `A08-05: the workflow header no longer claims more than it checks`.
- Not run: Docker and a GitHub runner are not available on this host, so the workflow was verified only statically (PyYAML parse, the repo's YAML lint, structural tests). It relies on `skopeo` being on `ubuntu-latest` (it is in the Ubuntu 22.04/24.04 runner images; both steps fail with a clear `::error::` if it is missing). The first real tag push is the end-to-end check.

## Review fixes

### A08-02 fix: `--prefix` made npm skip the repository's `.npmrc` (medium)
- Confirmed (npm 11.20.0): in a project with `registry=https://mirror.example.invalid/` in `.npmrc`, `npm config get registry` gives the mirror, and `npm config get registry --prefix <other dir>` gives `https://registry.npmjs.org/`. Once `<other dir>/.npmrc` is a copy of the project file, the mirror is back. The same happens from a subfolder of the project.
- Change (action.yml): before the install, the script creates the prefix directory and runs `npm prefix` (token unset) to find the project root the way npm does. It falls back to `$PWD` if that fails. If `<root>/.npmrc` exists, it is copied to `<prefix>/.npmrc` under `umask 077`, so the copy is mode 600: it may hold auth. It lives only in `$RUNNER_TEMP` for the job. The working directory does not change, so relative paths in the file (`cafile=./ca.pem`, `cache=./c`) resolve as they did before. Checked with `cache=./c`: npm writes its log to the same folder with and without the copy. User config (`~/.npmrc`, setup-node's `NPM_CONFIG_USERCONFIG`) and `${VAR}` expansion are unchanged. The install still runs with scripts off and without the token.
- I did not take the `npm exec` alternative. It would install and run in one npm process with the token already in the environment, which brings back the exposure that A08-02 removed.
- Tests: `A08-02: the project .npmrc (a registry mirror) still reaches the install, found from a subfolder as npm does` uses the real npm for `npm prefix` and `npm config get registry --prefix <install prefix>`. It checks that the mirror is resolved, that the copy is mode 600, and that the root lookup runs without the token. Against the previous action.yml it fails. `A08-02: without a project .npmrc nothing is copied and the install still runs`.

### A08-04: the CI guide's Docker recipe had no `--user` (low)
- Change (docs/guide/ci.md, Docker section): the report-file recipe is now `mkdir -p out` followed by `docker run --rm --user "$(id -u):$(id -g)" -v "$PWD/out:/out" ...`, the same as the Dockerfile header. The comment says why. This file belongs to P9, so the integrator should check for a conflict there.
- Test: `A08-04: every Docker recipe in the CI guide that mounts an output folder runs as the host user`. It was committed with the A08-02 test changes in the same test file.

### Proposed CHANGELOG addition (1.0.1, Fixed)
- GitHub Action: the npm install still uses the registry, scoped registries, auth and proxy settings from your repository's `.npmrc`. (A08-02)

### Proposed spec addition (after "...installs `mcp-review-check@<version>` into `$RUNNER_TEMP`...")
The action copies the project's `.npmrc` (from the root that `npm prefix` reports) into that install prefix with mode 600, so the project's registry and auth settings still apply.

## Adjusted existing test
- `test/p5b-docs.test.ts` › `docker.yml smoke test` › `runs the built image (version, listing-only run, non-root) in a job the push job needs`: it asserted `load: true`, `push: false` and a `push: true` rebuild in the push job, which is exactly the behaviour A08-05 removes. It now asserts the local-registry output, the per-platform `docker run`, and the push job's `skopeo copy --all --preserve-digests "oci-archive:`.

## notFixed
None.

## Proposed CHANGELOG lines (1.0.1)

### Fixed
- GitHub Action: a multi-line `extra-args` (a YAML block scalar) passes every line to the CLI. Before, everything after the first line was dropped without a message. If your workflow used one, the options on the later lines (for example `--fail-on-incomplete`, `--baseline`, `--ignore`) now take effect. (A08-01)
- GitHub Action: when the npm package cannot be installed, the step fails with exit code 3 and a message, instead of npx's exit code. (A08-02)
- Docker: the documented way to write a report into a mounted folder runs the container as your own user (`--user "$(id -u):$(id -g)"`). The image's non-root user cannot write a host folder owned by you. (A08-04)

### Security
- GitHub Action: the npm package is installed with install scripts disabled and without `MCP_REVIEW_CHECK_TOKEN` in its environment. The token is exported only to run the CLI. (A08-02)
- GitHub Action: a `bearer` that contains CR or LF is rejected (exit 2) before anything is printed. Before, `::add-mask::` masked only its first line and printed the rest to the log. (A08-06)
- Docker image: the published image is the one that was smoke-tested. It is built once for linux/amd64 and linux/arm64, each platform is run, and the same digest is copied to ghcr.io and checked after the push. Before, a second, untested build was pushed and arm64 never ran. (A08-05)

## Proposed spec paragraph (docs/design/spec.md, Distribution / GitHub Action and Docker image)
The action splits `extra-args` on spaces, tabs, CR and LF, so one option per line is allowed. It does no quoting and no globbing. It rejects a `bearer` containing CR or LF with exit 2 before printing anything. Without `cli-path` it installs `mcp-review-check@<version>` into `$RUNNER_TEMP` with `npm install --ignore-scripts`, without `MCP_REVIEW_CHECK_TOKEN` in the environment, and exports the token only for the CLI run. A failed install exits 3. The Docker workflow builds the image once for linux/amd64 and linux/arm64 into a registry local to the build runner, smoke-tests each platform by digest (version, CPU architecture, a listing-only run, a report written to a host mount as the runner user, non-root default user), and hands the image to the push job as an OCI archive. The push job, the only one with `packages: write`, copies that archive to ghcr.io with digests preserved and fails unless the pushed digest equals the tested one.

## Tests run
- `npm run typecheck`: pass.
- `npm run build`: pass.
- Before the fixes: `npx vitest run test/r3-p8-pipeline.test.ts` showed 10 failed, 1 passed (the passing one was a control case).
- After: `npx vitest run test/r3-p8-pipeline.test.ts test/p5b-docs.test.ts test/workflows.test.ts test/remediation-w4d-action.test.ts test/remediation-w5d-action.test.ts test/docs.test.ts test/redact.test.ts` showed 7 files, 94 tests, all passed. The new file alone has 11 tests, all passing.
- `python3 -c 'yaml.safe_load(...)'` on `action.yml` and `.github/workflows/docker.yml`: both parse.
