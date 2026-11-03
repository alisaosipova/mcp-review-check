# CI and automation

Recipes for GitHub Actions, the GitHub Action, GitLab CI, Docker, Docker Compose and pre-commit. Exit codes: [README](../../README.md#exit-codes).

## CI recipes

Pin the minor version (see [Stability policy](../../README.md#stability-policy)). On GitHub Actions the findings also appear as annotations and the markdown report in the job summary (see [GitHub Actions](#github-actions)); the exit code fails the job (see [Exit codes](options-and-config.md#exit-codes)).

**A stdio server, on every push** — build it and let mcp-review-check start it:

```yaml
name: mcp-review-check
on: [push, pull_request]
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      - run: npm ci && npm run build
      - run: npx -y mcp-review-check@0.5 --target claude --stdio -- node dist/server.js
```

**A preview deployment URL** — check each successful deployment (for example, a preview per pull request) through the [`deployment_status`](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#deployment_status) event:

```yaml
name: mcp-review-check preview
on: deployment_status
jobs:
  review:
    if: github.event.deployment_status.state == 'success'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      - run: npx -y mcp-review-check@0.5 "$PREVIEW_URL/mcp" --target claude
        env:
          PREVIEW_URL: ${{ github.event.deployment_status.environment_url }}
          MCP_REVIEW_CHECK_TOKEN: ${{ secrets.MCP_REVIEW_CHECK_TOKEN }}
```

`environment_url` is the URL your deployment tool reports for the environment ([deployment statuses](https://docs.github.com/en/rest/deployments/statuses)). A preview on a shared platform domain (`*.vercel.app`, `*.netlify.app`, ...) gets an SRV-005 info note, since the production server's domain should match your service. If previews sit behind a login wall, pass the bypass header your host documents with `--header` (header values are redacted). Drop `MCP_REVIEW_CHECK_TOKEN` if the server needs no auth. For other CI systems the same command works: the exit code is the result, and `--format json` or `--output` give a file to keep.

**Fail only on new findings** — keep a JSON report of the accepted state in the repository and pass it with `--baseline`: known findings stay in the report but no longer fail the job, a new finding does. Write the file once with `--save-baseline` (`--fail-on never` so the first run passes), commit it, and refresh it the same way when you accept new findings:

```bash
npx mcp-review-check@0.5 --target claude --fail-on never --save-baseline .mcp-review-check/baseline.json --stdio -- node dist/server.js
```

```yaml
      - run: npx -y mcp-review-check@0.5 --target claude --baseline .mcp-review-check/baseline.json --stdio -- node dist/server.js
```

`--save-baseline` writes the same document as `--format json --output <file>`, besides the report you chose, so one run can print the text report and refresh the baseline.

**Catch tool-definition changes** — the same baseline also holds a fingerprint of every tool, so the job reports which tools were added, removed or changed since it was saved ([Tool-definition drift](options-and-config.md#tool-definition-drift)). Add `--fail-on-drift` to fail the job on any change until the baseline is refreshed, and `--diff-only` to keep the text or markdown report to what is new:

```yaml
      - run: npx -y mcp-review-check@0.5 --target claude --baseline .mcp-review-check/baseline.json --fail-on-drift --diff-only --stdio -- node dist/server.js
```

**JUnit test reports** — GitLab shows the `junit` report in the merge request and the pipeline's Tests tab; each rule is a test, a finding at `--fail-on` a failed test:

```yaml
mcp-review-check:
  image: node:22
  script:
    - npm ci && npm run build
    - npx -y mcp-review-check@0.5 --target claude --format junit --output mcp-review-check.xml --stdio -- node dist/server.js
  artifacts:
    when: always
    reports:
      junit: mcp-review-check.xml
```

On GitHub Actions, [dorny/test-reporter](https://github.com/dorny/test-reporter) reads the same file (`reporter: java-junit`, `path: mcp-review-check.xml`, in a step with `if: always()`).

**Fail when the token stops working** — without a valid token the tool checks are skipped and the run can still pass (the job gets a `::warning`). With a token in CI, add `--fail-on-incomplete` so that a missing, expired or rejected token fails the job (exit 3):

```yaml
      - run: npx -y mcp-review-check@0.5 "$MCP_URL" --target claude --fail-on-incomplete
        env:
          MCP_URL: https://mcp.example.com/mcp
          MCP_REVIEW_CHECK_TOKEN: ${{ secrets.MCP_REVIEW_CHECK_TOKEN }}
```

A run cut off by `--max-duration` exits 4, so a step can tell a slow server from an unreachable one (exit 3): for example, `npx -y mcp-review-check@0.5 "$MCP_URL" --max-duration 120000 || [ $? -eq 4 ]` lets a slow run pass the step and still fails on every other non-zero code.

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
      - uses: alisaosipova/mcp-review-check@v0.5.0
        with:
          stdio: node dist/server.js
          platform: claude
```

For a deployed server, give `target` instead of `stdio` and pass the token as a secret:

```yaml
      - uses: alisaosipova/mcp-review-check@v0.5.0
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
| `version` | `0.5` | npm version or range of mcp-review-check to run; 0.3 or newer (the outputs read the report written with `--json-output`). |
| `sarif-file` | `mcp-review-check.sarif` | Where the SARIF report is written. |
| `upload-sarif` | `true` | Upload it with `github/codeql-action/upload-sarif` (needs `security-events: write`), also when the check fails. Set `false` on pull requests from forks, which cannot write code scanning results. |
| `extra-args` | | More options, split on whitespace (no quoting), for example `--timeout 60000 --ignore TOOL-013`. |
| `cli-path` | | Run `node <path>` (a built `dist/cli.js`) instead of the npm package. |

| Output | Value |
|---|---|
| `exit-code` | The CLI's exit code (see [Exit codes](options-and-config.md#exit-codes)); the step fails with the same code. |
| `sarif-file` | Path of the SARIF report, empty when none was written. |
| `report-json` | Path of the JSON report (the `--format json` document) in the runner's temp directory, empty when none was written. |
| `score` | Score 0–100, empty for a partial check. |
| `verdict` | `PASS`, `FAIL` (threshold reached, or the server could not be checked) or `INCOMPLETE` (stopped by `--max-duration`), as the Result line. |
| `verdict-claude`, `verdict-chatgpt` | Directory verdict: `BLOCKED`, `NEEDS ATTENTION`, `NO AUTOMATED BLOCKERS` or `INCOMPLETE`; empty when the platform is not checked. |
| `errors`, `warnings` | Number of error and warning findings (with `--baseline` in `extra-args`, of the new ones only). |
| `new-findings` | Findings of any severity that are not in the baseline (all findings without one). |

Every output except `exit-code` and `sarif-file` is empty when no report was written (a usage error, exit 2). The outputs are set also when the check fails, so a later step with `if: always()` can use them:

```yaml
      - uses: alisaosipova/mcp-review-check@v0.5.0
        id: review
        with:
          stdio: node dist/server.js
      - if: always()
        run: echo "score ${{ steps.review.outputs.score }}, ${{ steps.review.outputs.verdict }}, ${{ steps.review.outputs.new-findings }} new"
```

The action needs Node 22.12 or newer on the runner (GitHub-hosted runners have it; add `actions/setup-node` otherwise). Pin a full tag such as `@v0.5.0` or a commit SHA.

## GitHub Actions


When `GITHUB_ACTIONS=true` (GitHub sets it on every runner), each finding that is a warning or an error for the `--target` directories (and for the MCP spec with `--fail-on-spec`) is also printed on stderr as an `::error` or `::warning` workflow annotation, at the severity it has for those platforms, as for the exit code. Exit 3 and 4 add one `::error` titled `mcp-review-check` with the cause (could not connect, stopped by `--max-duration`, or an unexpected failure, secrets redacted). A partial check (no token, a rejected token, `tools/list` failed) adds one `::warning` titled `mcp-review-check` that names the reason and says that tool checks were skipped, whatever the exit code. The markdown report is appended to the job summary when `$GITHUB_STEP_SUMMARY` is set. stdout keeps the chosen format, so `--format json` and `sarif` stay a single document. To run the check as a workflow step with a SARIF upload, use [the GitHub Action](#ci-recipes) (`uses: alisaosipova/mcp-review-check@v0.5.0`). There is no separate switch: without `GITHUB_ACTIONS` (or without `GITHUB_STEP_SUMMARY`, for the summary) nothing is annotated or written. `FORCE_COLOR=1` colours the text report without a TTY (the Actions log shows ANSI colours); `FORCE_COLOR=0` and `--no-color` turn colours off.

The markdown report (and so the job summary) has an Evidence column with the text a rule matched, and a `rerun: npx mcp-review-check …` line with the options of the run, secrets redacted, to reproduce it locally (`--quiet` and `--checklist` are left out: they change only the text report). On Windows the line quotes arguments with double quotes, for cmd.exe (an argument that holds both `"` and one of `& | < > ^`, such as `--stdio "node s.js --filter \"a|b\""`, can split in cmd.exe, which ignores the backslash before `"`: check such a line before you run it; in PowerShell, quote again an argument that contains `"`, `$` or a backtick: PowerShell reads `\"` and `$` inside double quotes its own way; not yet tried on a real Windows machine); elsewhere with single quotes, for `sh`.

## Docker Compose

To check a server in a Compose stack before it has a public URL, run mcp-review-check as one more service. The service name has no dot, so the run is in [local mode](options-and-config.md#local-mode): deploy-time checks (HTTPS, public DNS) are info.

```yaml
services:
  mcp:
    build: .
    expose: ["8080"]
  review:
    image: node:22-slim
    command: npx -y mcp-review-check@0.5 http://mcp:8080/mcp --target claude
    depends_on: [mcp]
    profiles: [review]
```

```bash
docker compose run --rm review
```

A service with a [profile](https://docs.docker.com/compose/how-tos/profiles/) does not start with `docker compose up`; `docker compose run` starts it and the `mcp` service it depends on. If the server takes a while to start, give `mcp` a healthcheck and use `depends_on: {mcp: {condition: service_healthy}}` ([startup order](https://docs.docker.com/compose/how-tos/startup-order/)), or the first run may exit 3 (connection refused).

## GitLab CI

A complete `.gitlab-ci.yml` for a stdio server: the JUnit report shows in the merge request and the pipeline's Tests tab, and the baseline is cached so merge requests fail only on **new** findings. The default branch refreshes the baseline after every successful run.

```yaml
stages: [review]

variables:
  MCP_REVIEW_CHECK_VERSION: "0.5"        # pin the minor, see the Stability policy in the README
  npm_config_cache: "$CI_PROJECT_DIR/.npm"

mcp-review-check:
  stage: review
  image: node:22
  # The baseline lives in the cache; only the default branch refreshes it (see after_script).
  cache:
    - key: npm-$CI_COMMIT_REF_SLUG
      paths: [.npm/]
    - key: mcp-review-check-baseline
      paths: [.mcp-review-check/]
      policy: pull-push
  script:
    - npm ci && npm run build
    - |
      set -u
      args="--target claude --stdio -- node dist/server.js"
      common="--format junit --output mcp-review-check.xml --json-output mcp-review-check.json"
      if [ -f .mcp-review-check/baseline.json ]; then
        # Known findings do not fail the job; a new finding or a changed tool definition does.
        npx -y "mcp-review-check@$MCP_REVIEW_CHECK_VERSION" $common --baseline .mcp-review-check/baseline.json --fail-on-drift $args
      else
        # First run: record the accepted state and do not fail.
        mkdir -p .mcp-review-check
        npx -y "mcp-review-check@$MCP_REVIEW_CHECK_VERSION" $common --fail-on never --save-baseline .mcp-review-check/baseline.json $args
      fi
  after_script:
    # Refresh the baseline from the default branch only (merge requests never replace the accepted state).
    - if [ "$CI_COMMIT_BRANCH" = "$CI_DEFAULT_BRANCH" ] && [ -f mcp-review-check.json ]; then mkdir -p .mcp-review-check && cp mcp-review-check.json .mcp-review-check/baseline.json; fi
  artifacts:
    when: always
    expire_in: 2 weeks
    paths: [mcp-review-check.xml, mcp-review-check.json]
    reports:
      junit: mcp-review-check.xml
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
```

Notes:

- For a deployed server give the URL instead of `--stdio -- ...` and keep the token in a masked, protected CI/CD variable named `MCP_REVIEW_CHECK_TOKEN` (the tool reads it; it is redacted in the report). Add `--fail-on-incomplete` so an expired token fails the job.
- The default-branch job overwrites the cached baseline with its own report, which accepts whatever it found. To review baseline changes like code, commit `.mcp-review-check/baseline.json` instead of caching it and refresh it by hand with `--save-baseline` ([baselines](options-and-config.md#options)).
- GitLab caches are best effort: when the cache is missing, the job takes the first-run branch and passes. If that is not acceptable, commit the baseline.
- A shell runner without Docker works the same way; replace `image:` with a runner that has Node 22.12 or newer.

## Docker

The image `ghcr.io/alisaosipova/mcp-review-check` is published for every release (tags `<version>`, for example `0.5.0`, and `latest`) by `.github/workflows/docker.yml` after the npm release. It runs as a non-root user and its entrypoint is `mcp-review-check`, so everything after the image name is the usual command line:

```bash
docker run --rm ghcr.io/alisaosipova/mcp-review-check:0.5.0 https://mcp.example.com/mcp --target claude

# A token from the environment (the value is not on the command line):
docker run --rm -e MCP_REVIEW_CHECK_TOKEN ghcr.io/alisaosipova/mcp-review-check:0.5.0 https://mcp.example.com/mcp

# A report file: mount a writable folder
docker run --rm -v "$PWD/out:/out" ghcr.io/alisaosipova/mcp-review-check:0.5.0 https://mcp.example.com/mcp --format json --output /out/report.json
```

Limits: the container cannot start a `--stdio` server that lives on your host (use `npx` for that, or build your own image from this one), and `localhost` inside the container is the container; for a server on the host use `--network host` (Linux) or `http://host.docker.internal:PORT/mcp`. A host without a dot runs in [local mode](options-and-config.md#local-mode). Behind a corporate proxy pass `-e HTTPS_PROXY -e NO_PROXY` ([Troubleshooting](troubleshooting.md#corporate-proxy)). The `Dockerfile` in the repository builds the image from the published npm package: `docker build --build-arg VERSION=0.5.0 -t mcp-review-check .`.

## pre-commit

The repository ships a [pre-commit](https://pre-commit.com) hook (`.pre-commit-hooks.yaml`, hook id `mcp-review-check`). It runs the CLI with the options you give in `args`, once per commit (it does not pass file names), and only when a changed file matches `mcp-review-check.config.json`, `.mcp-review-check.json` or a plugin manifest (`plugin.json`, `.mcp.json`, `mcp.json`):

```yaml
repos:
  - repo: https://github.com/alisaosipova/mcp-review-check
    rev: v0.5.0
    hooks:
      - id: mcp-review-check
        args: [--target, claude, --stdio, --, node, dist/server.js]
```

The hook needs Node 22.12 or newer (pre-commit builds a Node environment for `language: node`) and a built server for `--stdio`. A config file next to the hook keeps the arguments short: with `mcp-review-check.config.json` holding the server and options, `args` can be empty. Run it on demand with `pre-commit run mcp-review-check --all-files`; it can also be set to `stages: [pre-push]` when a check on every commit is too slow. Do not give it a token on the command line: export `MCP_REVIEW_CHECK_TOKEN` in your shell.

pre-commit installs a `language: node` hook by packing the cloned repository, and the package builds itself in `prepack` (`tsc`), so the first run needs network access and a working `npm` toolchain. If that is a problem in your environment (an offline runner, a locked-down npm), use a local hook that runs the published package instead:

```yaml
repos:
  - repo: local
    hooks:
      - id: mcp-review-check
        name: mcp-review-check
        entry: npx -y mcp-review-check@0.5 --target claude --stdio -- node dist/server.js
        language: system
        pass_filenames: false
        files: '(^|/)(mcp-review-check\.config\.json|plugin\.json|\.mcp\.json)$'
```
