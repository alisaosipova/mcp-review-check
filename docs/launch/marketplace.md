# GitHub Marketplace listing: audit and draft

Draft for review; nothing here is applied. Versions as found on 2026-11-03: `package.json` 0.7.0, local tags
v0.1.0 to v0.7.0 (`git tag`, re-checked by the reviewer at 07:11 -0500): `v0.7.0` is an annotated tag created
2026-11-03 06:55 -0500 on HEAD `888e14f` ("Release 0.7.0 ..."), which `docs/guide/ci.md` already cites as
`uses: alisaosipova/mcp-review-check@v0.7.0`. An earlier pass of this draft saw tags only up to v0.6.0; the tag was
created while it was written. Whether `v0.7.0` is pushed to GitHub was not checked (no network). The npm version was not checked here (no network to the registry).

Requirements are quoted from GitHub's "Publishing actions in GitHub Marketplace" and "Metadata syntax" pages, read on
2026-11-03:

- "The action must be in a public repository."
- "Each repository must contain a single action metadata file (`action.yml` or `action.yaml`) at the root."
- "The `name` in the action's metadata file must be unique." It cannot match an existing Marketplace action, a GitHub
  user or organization (unless that owner publishes), an existing Marketplace category, or a reserved GitHub feature
  name.
- "Publishing requires you to use two-factor authentication." and the Marketplace developer agreement must be
  accepted.
- Metadata: `name` and `description` are required, `author` optional; `branding.color` is one of `white`, `black`,
  `yellow`, `blue`, `green`, `orange`, `red`, `purple`, `gray-dark`; `check-circle` is in the icon list.
- Expectation (not a hard gate per the page): "the repository only includes the metadata file, code, and files
  necessary for the action". Actions "are published to GitHub Marketplace immediately and aren't reviewed by GitHub".
- Versioning guidance ("Managing custom actions"): recommend users "specify a major version", and "Move the major
  version tag (for example, `v1`) to point to the Git ref of the current release."

## Audit of action.yml

Measured with `python3 -c "import yaml; ..."` over `action.yml`: description 113 characters, 12 inputs, 12 of them with
a `default`, 10 outputs.

| Check | Result | Evidence |
|---|---|---|
| Single metadata file at the root | PASS | `find . -name "action.y*ml"` (excluding node_modules) finds only `./action.yml` |
| Public repository | NOT CHECKED | `package.json` points to github.com/alisaosipova/mcp-review-check; visibility not checked offline |
| `name` present | PASS | `name: mcp-review-check` |
| `name` unique on Marketplace | NOT CHECKED | no network lookup was made; the publish form validates it. Same string as the npm package and the repo, which helps search |
| `description` present | PASS | 113 characters, same text as the `package.json` description |
| `author` | PASS | `author: alisaosipova` |
| `branding.icon` / `branding.color` | PASS | `check-circle` / `blue`, both in GitHub's allowed lists |
| Every input has a description and a default | PASS | 12 of 12; all `required: false` (target/stdio exclusivity is checked at run time) |
| Every input documented with its default | PASS | the input table in `docs/guide/ci.md` lists all 12 with the same defaults |
| Every output documented | PASS | 10 outputs, table in `docs/guide/ci.md` |
| README usage block | CHANGE | the Marketplace page shows the README; README.md has no `uses:` example (only a link to the guide) |
| Moving major ref (`v0`) | CHANGE (decision) | none exists, on purpose: CONTRIBUTING.md step 4 says a moving tag would need force-updating a tag, and the repo never force-pushes |
| Release tag the docs cite exists | PASS locally | `v0.7.0` exists locally (`git tag`); confirm it is pushed and has a GitHub release before listing |
| Repo holds only what the action needs | RISK (soft) | the repo is the full CLI (src, test, docs, 4 workflows); the composite action runs `npx mcp-review-check@<version>` and needs only `action.yml`. Keep as is; a separate thin repo would split issues and need its own unique name |
| 2FA and developer agreement | USER ACTION | account settings, cannot be checked from the repo |

## Proposed changes (diffs, not applied)

### 1. README: a usage block the Marketplace page can show

Insert after the "Usage" section, before "Exit codes":

```diff
+## GitHub Action
+
+```yaml
+      - uses: actions/setup-node@v5
+        with:
+          node-version: 22
+      - uses: alisaosipova/mcp-review-check@v0.7.0
+        with:
+          target: https://staging.example.com/mcp     # or stdio: node dist/server.js
+          platform: claude
+          bearer: ${{ secrets.MCP_REVIEW_CHECK_TOKEN }}
+```
+
+Annotations, the job summary and a SARIF upload to code scanning (needs `security-events: write`). Every input and
+output, with defaults: [CI and automation](docs/guide/ci.md#ci-recipes).
```

### 2. A moving `v0` ref without force-pushing

A tag cannot move without a forced tag update. A **branch** named `v0` can move by fast-forward only, because releases
are tagged on a linear `main`, and `uses: owner/repo@v0` resolves branches as well as tags.

Release step to add to CONTRIBUTING.md step 4 (after the tag is pushed and the release job is green):

```diff
-There is no moving major tag (`v0`): keeping one would mean force-updating a tag on every release, and this
-repository never force-pushes. Users pin a full tag or a commit SHA, as the README recommends for any third-party
-action.
+A `v0` branch follows the latest 0.x release: after the release job is green, fast-forward it with
+`git push origin vX.Y.Z^{commit}:refs/heads/v0` (a plain push; it fails rather than rewrites if `v0` is not an
+ancestor). Never move it backwards. `@v0` is for convenience; for supply-chain pinning use a full tag or a commit SHA.
```

Protect the branch with a ruleset: block force pushes and deletion, restrict who can push. Caveats to state in the
listing: while 0.x a minor release may add rules (Stability policy), so `@v0` can turn a passing job red on a new
minor, unlike pinning `@v0.7.0`. If that is not acceptable, keep the current policy (full tags only) and say so in
the README; the Marketplace does not require a major ref.

### 3. action.yml: drop the maintainer note from a user-facing description

```diff
   version:
-    description: npm version or range of mcp-review-check to run, 0.3 or newer (the outputs need --json-output; bump with each release, see CONTRIBUTING.md).
+    description: npm version or range of mcp-review-check to run, 0.3 or newer (the outputs need --json-output).
```

Nothing else in `action.yml` needs to change for listing.

## Publishing steps (user)

1. Confirm the repository is public, 2FA is on, and the Marketplace developer agreement is accepted.
2. Push and release 0.7.0 as usual if not done yet (tag `v0.7.0` exists locally; `release.yml` creates the GitHub
   release with `gh release create`). Diffs 1 to 3 are not in `v0.7.0`; apply them on `main` (and in the next release
   if the action file changes).
3. Open the v0.7.0 release on GitHub, Edit, tick "Publish this Action to the GitHub Marketplace", pick categories,
   save. The form checks the name and metadata. Later releases created by `release.yml` do not tick the box
   themselves; check in the UI whether a release needs it for the listing to show the new version.

## Listing text draft

Categories (choose in the form): primary "Code quality", secondary "Security" (names as shown in the Marketplace
form; confirm there).

> **mcp-review-check**
>
> Lint an MCP server against the public review criteria of the Claude connector directory, the ChatGPT plugin
> directory and the MCP specification, before you submit it.
>
> - Checks a deployed server (Streamable HTTP or HTTP+SSE) or starts a local stdio server.
> - Findings as workflow annotations, the markdown report in the job summary, and SARIF uploaded to code scanning.
> - Outputs for later steps: score, verdict per directory, error and warning counts, new findings against a baseline.
> - Read-only by default: it calls no tool unless `active: true`, and then only tools annotated `readOnlyHint: true`.
> - Tokens reach the CLI only through the environment and are redacted in every output.
>
> A clean result means no automated blockers were found; it does not mean a directory will accept the server. Not
> affiliated with Anthropic or OpenAI.
