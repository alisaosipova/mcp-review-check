# W4D-ci report — wave 4

Package W4D-ci of [wave4-plan.md](wave4-plan.md): F145-rest, F159-rest, F156, F168-action. Branch `worktree-agent-ab4c99ea6296ff890`, written 2026-11-01.

## Items

| Item | Status | What |
|---|---|---|
| F145-rest | done | `release.yml`, publish job: new step "Published version carries npm provenance" after both publish steps. It runs `npm view mcp-review-check@${GITHUB_REF_NAME#v} --json` up to 7 times, 10 s apart (about a minute, because the registry can lag), and passes once `dist.attestations` is present; otherwise `::error::` and exit 1, so `gh-release` does not run. The `NPM_TOKEN` first-release step is unchanged, and the check covers it too (that path also publishes with provenance through `publishConfig.provenance` and `id-token: write`). No new action, so nothing new to pin. Logic checked against the registry: 0.1.0 has `dist.attestations` (`predicateType https://slsa.dev/provenance/v1`), and a missing version makes `npm view` exit non-zero, so the step retries. |
| F159-rest | done | `ci.yml`: the audit step runs only when `github.event_name != 'pull_request'` (pushes to `main`, `workflow_dispatch`), replacing `continue-on-error` on PRs. New `.github/workflows/audit.yml`: weekly cron (`17 6 * * 1`), `workflow_dispatch`, `permissions: contents: read`, checkout without credentials, `npm audit --omit=dev --audit-level=high` with no install (npm audit reads only `package-lock.json`: checked in an empty directory with just `package.json` and the lockfile, `found 0 vulnerabilities`). No linter (plan decision). |
| F156 | done | `vitest.config.ts`: `coverage.thresholds` = statements 88, branches 82, functions 89, lines 92 (measured minus 5, rounded down), plus `coverage.reportOnFailure: true` (see below). Thresholds are checked only with `--coverage`: `npx vitest run test/remediation-w4d-action.test.ts` passes, and the same with `--coverage` prints `ERROR: Coverage for lines (0%) does not meet global threshold (92%)` and so on for all four. |
| F168-action | done | New composite `action.yml` at the repository root, the `action` job in `ci.yml`, and `test/remediation-w4d-action.test.ts`. Details below. |
| CONTRIBUTING | done | CI paragraph (action job, audit schedule), coverage paragraph, release steps: bump the `version` default on a minor release, the provenance check, a new step 4 on the action and the optional `v0` moving tag. |
| F168: MARKET.md outputs `score`, `verdict-claude`, `verdict-chatgpt` | deferred | `feature: outputs parsed from the report`. The action outputs only what the task asked for (`exit-code`, `sarif-file`). Score and verdicts would need a second run with `--format json`, or parsing the SARIF run properties. Schedule this after `--baseline` (W4A) lands, so the outputs can count new findings too. |

### Coverage measurement (F156)

`npm ci --ignore-scripts`, then `npm run test:coverage` (the whole suite, Node from the host, Kali):

- **Run 1** (config as on `main`): 1 failed / 1155 passed / 4 skipped, 164 s. The one failure was `test/remediation-wp2-connect.test.ts > large stdio messages … > a message over the stdio buffer names the overflow on the failed read`: `MCP error -32001: Request timed out` instead of the buffer-overflow message. That test pushes 70 MB through a pipe and is timing-dependent under V8 instrumentation, so it is flaky and unrelated to coverage. Vitest writes **no coverage report when a test fails** (`coverage.reportOnFailure` defaults to `false`), so this run gave no numbers.
- **Run 2**, with `reportOnFailure: true` added to the config (kept: a flaky test should not hide the numbers): 4 failed / 1152 passed / 4 skipped, 179 s. The failures were the same wp2 test; `test/limits.test.ts > input caps > pathological descriptions … under 2 s`, a wall-clock bound that coverage instrumentation slows down (flaky under coverage, unrelated); and 2 in `test/workflows.test.ts`, caused by my workflow edits made while the run was going (`audit.yml` and `uses: ./` were new; fixed since, see "Outside ownership").

Measured in run 2 (the failed tests still ran their code):

| Metric | Measured | Threshold |
|---|---|---|
| Statements | 93.51 % (5585/5972) | 88 |
| Branches | 87.37 % (4547/5204) | 82 |
| Functions | 94.48 % (1027/1087) | 89 |
| Lines | 97.47 % (4240/4350) | 92 |

These numbers predate the W4A/W4B/W4C code. Re-measure after integration if their new code comes without unit tests. `test:coverage` is not run in CI (it never was), so the thresholds bind only when someone runs `npm run test:coverage`. A CI coverage job would be a follow-up, and it would first need the two timing tests above to tolerate instrumentation.

### GitHub Action (F168)

- **One CLI run.** `src/cli.ts` (lines 369–372) prints the annotations to stderr and appends the markdown report to `$GITHUB_STEP_SUMMARY` whenever `GITHUB_ACTIONS=true`, whatever `--format` is (README "GitHub Actions" says the same). So the action runs the CLI **once** with `--format sarif --output <sarif-file>` and gets the annotations, the job summary and the SARIF file from that one run. No second pass.
- **Inputs:**
  - `target`: the URL.
  - `stdio`: the command, passed as `--stdio "<command>"` and split by the CLI without a shell. Exactly one of `target` and `stdio` is required, otherwise `::error` and exit 2.
  - `platform`: maps to the CLI's `--target`, `claude|chatgpt|all`, default `all`; `both` is accepted as `all`. It is not called `target-platform`, because `target` is the URL.
  - `fail-on`: default `error`, the CLI default.
  - `fail-on-spec`: default `false`.
  - `active`: default `false`.
  - `bearer`: exported as `MCP_REVIEW_CHECK_TOKEN` only when non-empty, so an empty input keeps a job-level `MCP_REVIEW_CHECK_TOKEN`. It is masked with `::add-mask::` and never passed as `--bearer`.
  - `version`: default `'0.2'`. It is validated against `^[A-Za-z0-9.^~*+<>= -]+$`, so `npm:`, `github:`, a path or a URL cannot install another package under the name.
  - `sarif-file`: default `mcp-review-check.sarif`.
  - `upload-sarif`: default `true`.
  - `extra-args`: split on whitespace with `read -a`, no globbing or quote removal.
  - **Added: `cli-path`**, which runs `node <path>` instead of `npx`. It is for testing a checkout: CI uses it, and the README's "run from a checkout" case can too.
- **Outputs:** `exit-code`, plus `sarif-file`, which is empty when no SARIF was written (for example on a usage error).
- **Exit-code contract:** the step exits with the CLI's code (0/1/2/3, 4 for `--max-duration` stops from 0.2.0, and 128+N for signals; written in the step comments and the `exit-code` description). So the job fails exactly as a plain `run: npx …` step would.
- **Upload:** `github/codeql-action/upload-sarif@9b3254085494b55a0f7c4c2b3d2d52cc712ce370 # v4.39.1` (SHA from `git ls-remote --tags https://github.com/github/codeql-action`; `v4` points to the same commit). It runs with `if: always() && inputs.upload-sarif == 'true' && steps.run.outputs.sarif-file != ''`, so a failing check (exit 1 or 3) still uploads. There is no `continue-on-error`, and no `category` (the SARIF already carries `automationDetails.id`).
- **Script safety:** every input reaches bash through `env:`. There is no `${{ }}` inside the `run:` script (asserted by the test). The script is portable to bash 3.2 (macOS runners): the `${extra[@]+…}` guard under `set -u`, and the regex held in a variable.
- **Node:** the action needs `node` on PATH (GitHub-hosted runners have it). Without it the action prints `::error` with a hint to add `actions/setup-node` and exits 2. The action does not install Node itself.
- **Pitfall found while testing:** `npx mcp-review-check@<v>` run **inside this repository** (whose `package.json` name is `mcp-review-check`) fails with `sh: 1: mcp-review-check: not found`, because npm resolves the name to the local project. This affects only this repository, which is why its CI job uses `cli-path: dist/cli.js`. Run from any other directory, the npx path works: checked with `version: 0.1` against the published 0.1.0, exit 0, SARIF written, token not in the SARIF.
- **CI job `action`** (ci.yml), on ubuntu, macOS and Windows: build, then `uses: ./` against `test/fixtures/good-server.mjs` (expects exit 0 and `sarif-file`), then against `bad-server.mjs` with `platform: claude` and `continue-on-error: true` (expects exit-code 1, outcome `failure`, SARIF still written). Then it checks both SARIF files are 2.1.0. It runs with `upload-sarif: 'false'`, because a fork PR cannot write code scanning. **Not run on a real runner** (no GitHub repo access from here). The Linux behaviour of the script is covered by the unit test and by a local simulation; macOS (bash 3.2) and Windows (Git Bash) are verified only by this job once pushed.

### Outside ownership

- `test/workflows.test.ts` (not in the W4D list) asserted `FILES == ['ci.yml', 'release.yml']` and rejected every `uses:` without a SHA. The required `audit.yml` and the `uses: ./` self-test made it fail. Leaving it unchanged would have left the suite red, so I made the minimal edit: the list now includes `audit.yml`, and exactly `ci.yml: ./` is exempt. It is committed with the F159 change. The merge step should review this edit.
- **The `v0` moving tag conflicts with the "no force push" rule.** Moving `v0` needs `git push origin refs/tags/v0 --force` (a forced tag update, never a branch). CONTRIBUTING describes it as an optional maintainer step and still recommends pinning a full tag or SHA. Whether to introduce `v0` at all is the maintainer's call, given the no-force-push rule. No tag was created.

## Files changed

- `.github/workflows/release.yml`: provenance verification step.
- `.github/workflows/ci.yml`: audit gated off PRs; new `action` job.
- `.github/workflows/audit.yml`: new, weekly audit.
- `action.yml`: new, composite action.
- `vitest.config.ts`: `thresholds`, `reportOnFailure`.
- `CONTRIBUTING.md`: CI, coverage and release sections.
- `test/remediation-w4d-action.test.ts`: new, 12 tests.
- `test/workflows.test.ts`: minimal edit, see above.
- `docs/review/2026-11-01/remediation/W4D-report.md`: this file.

## Verification

| Command | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run build` | pass |
| `MCP_REVIEW_CHECK_SKIP_BUILD=1 npx vitest run test/remediation-w4d-action.test.ts test/workflows.test.ts` | 2 files, 18 tests passed |
| `npx vitest run --coverage test/remediation-w4d-action.test.ts` | tests pass, the 4 threshold errors are printed: thresholds are enforced only with `--coverage` |
| YAML syntax: `python3 -I validate_yaml.py <worktree>` (PyYAML 6.0.3, `yaml.safe_load` of `.github/workflows/*.yml` and `action.yml`) | all 4 parse. No `yaml`/`js-yaml` in `node_modules`, so the test file checks structure as text. `actionlint` and `shellcheck` are not installed |
| Local simulation of the action's `run:` script (extracted with PyYAML, run in bash with `GITHUB_ACTIONS=true`): good-server, bad-server, both inputs, bad `version`, whitespace-only `extra-args`, npx path with `version: 0.1` outside the repo | exit 0 / 1 / 2 / 2 / 0 / 0 as expected, outputs written, SARIF written on 0 and 1, token absent from SARIF |
| `npm run test:coverage` (twice, see above) | coverage numbers as in the table. Unrelated failures: the wp2 70 MB stdio timeout and the limits wall-clock bound (both flaky under coverage) |

## Proposed CHANGELOG lines (`## [Unreleased]`)

### Added
- GitHub Action: `uses: alisaosipova/mcp-review-check@v0.2.0` runs the check on a URL (`target`) or a stdio command (`stdio`). It prints the findings as annotations and the report in the job summary, and writes a SARIF report that it uploads to code scanning, even when the check fails. Inputs: `platform`, `fail-on`, `fail-on-spec`, `active`, `bearer` (passed only as `MCP_REVIEW_CHECK_TOKEN`), `version`, `sarif-file`, `upload-sarif`, `extra-args`, `cli-path`. Outputs: `exit-code`, `sarif-file`.

### Changed
- The release workflow fails when the published version has no npm provenance attestation (`dist.attestations`) on the registry.
- `npm audit` no longer runs on pull requests: it runs on pushes to `main` and weekly (`.github/workflows/audit.yml`).
- `npm run test:coverage` fails below coverage thresholds (statements 88 %, branches 82 %, functions 89 %, lines 92 %), and reports coverage even when a test fails. `npm test` is unchanged.

## Proposed README subsection (under "CI recipes", for the docs step to paste)

````markdown
**The GitHub Action** — the same check as a step, with annotations, the job summary and a SARIF upload to code scanning:

```yaml
name: mcp-review-check
on: [push, pull_request]
permissions:
  contents: read
  security-events: write # upload-sarif; drop it with upload-sarif: false
  actions: read          # upload-sarif in a private repository
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      - run: npm ci && npm run build
      - uses: alisaosipova/mcp-review-check@v0.2.0
        with:
          stdio: node dist/server.js
          platform: claude
```

For a deployed server, give `target` instead of `stdio` and pass the token as a secret:

```yaml
      - uses: alisaosipova/mcp-review-check@v0.2.0
        with:
          target: https://staging.example.com/mcp
          bearer: ${{ secrets.MCP_REVIEW_CHECK_TOKEN }}
          fail-on: warning
```

| Input | Default | Notes |
|---|---|---|
| `target` | | Server URL. Give `target` or `stdio`, not both. |
| `stdio` | | Command that starts a local server, as `--stdio "<command>"` (split without a shell). |
| `platform` | `all` | `--target`: `claude`, `chatgpt` or `all` (`both` = `all`). |
| `fail-on` | `error` | `error`, `warning` or `never`. |
| `fail-on-spec` | `false` | Also fail on MCP spec findings. |
| `active` | `false` | `--active`: calls the tools annotated `readOnlyHint: true`. |
| `bearer` | | Token, passed only as `MCP_REVIEW_CHECK_TOKEN`, never on the command line. Empty keeps one set in the job's `env`. |
| `version` | `0.2` | npm version or range of mcp-review-check to run. |
| `sarif-file` | `mcp-review-check.sarif` | Where the SARIF report is written. |
| `upload-sarif` | `true` | Upload it with `github/codeql-action/upload-sarif` (needs `security-events: write`), also when the check fails. Set `false` on pull requests from forks, which cannot write code scanning results. |
| `extra-args` | | More options, split on whitespace (no quoting), for example `--timeout 60000 --ignore TOOL-013`. |
| `cli-path` | | Run `node <path>` (a built `dist/cli.js`) instead of the npm package. |

Outputs: `exit-code` (see [Exit codes](#exit-codes); the step fails with the same code) and `sarif-file` (empty when no report was written). The action needs Node 20.19 or newer on the runner (GitHub-hosted runners have it; add `actions/setup-node` otherwise). Pin a full tag such as `@v0.2.0` or a commit SHA.
````
