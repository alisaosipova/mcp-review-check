# Badge: "mcp-review-check: no automated blockers"

Draft for review; nothing here is applied and no product code changes. It uses only what the Action already does
in 0.7.0: the outputs `verdict-claude` and `verdict-chatgpt` (`action.yml`), whose values are `BLOCKED`,
`NEEDS ATTENTION`, `NO AUTOMATED BLOCKERS` or `INCOMPLETE`, or empty when the platform is not checked.

## Wording first

The badge says **"no automated blockers"**, the exact verdict the CLI prints, not "no blockers". The verdict only
covers what the automated rules detect; the README says a clean report "does not guarantee approval", and the manual
checklist (MAN-*) is never part of it. Shorter wording would claim more than the tool checks.

## Options

| Option | Refresh | Honest over time | Needs |
|---|---|---|---|
| Static shields.io badge the user edits by hand | manual | no: it keeps saying "no automated blockers" after a regression | nothing |
| Native workflow status badge (`.../actions/workflows/<file>/badge.svg`) | every run | yes, but it says "passing"/"failing", not the verdict, and depends on `fail-on` | nothing |
| **shields.io endpoint badge from a JSON in a gist, written by the workflow** | every run on the default branch | yes: the text is the verdict of the last run | one gist, one token with gist write access |

**Recommendation: the endpoint badge.** It is the simplest mechanism that cannot go stale silently and that shows the
verdict word itself. The static badge is not recommended: nothing ties it to a run. The native status badge is a
good zero-setup fallback when the workflow gates on the verdict.

## Mechanism

1. Create a public gist with one file, `mcp-review-check.json` (any content).
2. Create a token that can write gists (a classic personal access token with only the `gist` scope; at the time of
   writing fine-grained tokens do not cover gists, check before relying on it). Store it as the repository secret
   `BADGE_GIST_TOKEN`, and the gist id as the repository variable `BADGE_GIST_ID`.
3. Add the step below after the Action. It runs only on pushes and schedules on the default branch, never on pull
   requests (a fork's PR must not be able to change the badge, and has no secrets anyway).

```yaml
      - uses: alisaosipova/mcp-review-check@v0.7.0
        id: review
        with:
          target: https://mcp.example.com/mcp
          platform: claude
          bearer: ${{ secrets.MCP_REVIEW_CHECK_TOKEN }}
      - name: Update the mcp-review-check badge
        if: always() && github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'schedule')
        env:
          GH_TOKEN: ${{ secrets.BADGE_GIST_TOKEN }}
          GIST_ID: ${{ vars.BADGE_GIST_ID }}
          VERDICT: ${{ steps.review.outputs.verdict-claude }}
        run: |
          node -e '
            const v = process.env.VERDICT || "";
            const map = {
              "NO AUTOMATED BLOCKERS": ["no automated blockers", "brightgreen"],
              "NEEDS ATTENTION": ["needs attention", "yellow"],
              "BLOCKED": ["blockers found", "red"],
            };
            const [message, color] = map[v] || ["incomplete", "lightgrey"];
            const badge = { schemaVersion: 1, label: "mcp-review-check (claude)", message, color, cacheSeconds: 3600 };
            const body = { files: { "mcp-review-check.json": { content: JSON.stringify(badge) } } };
            require("fs").writeFileSync("badge-body.json", JSON.stringify(body));
          '
          gh api --method PATCH "/gists/$GIST_ID" --input badge-body.json > /dev/null
```

Notes on the step:

- `always()`: a failing check (exit 1) must update the badge to "blockers found", not leave the last green state.
- `INCOMPLETE` and an empty verdict (could not connect, no token, usage error) map to "incomplete", grey. Never map
  them to green.
- The verdict values come from the Action, which only writes fixed upper-case words; the step builds the JSON in
  node from an env var, so no value is interpolated into shell code.
- For the ChatGPT directory, use `verdict-chatgpt` and the label `mcp-review-check (chatgpt)`; for both, two files in
  the gist and two badges.
- A `schedule:` trigger (for example daily) keeps the badge current for a deployed server whose code did not change.

## README snippet (for the server's own README)

```markdown
[![mcp-review-check](https://img.shields.io/endpoint?url=https%3A%2F%2Fgist.githubusercontent.com%2FUSER%2FGIST_ID%2Fraw%2Fmcp-review-check.json)](https://github.com/OWNER/REPO/actions/workflows/mcp-review-check.yml)
```

Replace `USER`, `GIST_ID`, `OWNER`, `REPO` and the workflow file name. The link goes to the workflow runs, so a
reader can open the report behind the badge (job summary).

## Refresh

- Every push to the default branch and every scheduled run rewrites the gist.
- shields.io and the gist raw URL both cache; the badge can lag a run by minutes. `cacheSeconds: 3600` asks shields.io
  to cache for up to an hour; lower it if that matters.
- If the workflow stops running, the badge keeps the last verdict. A scheduled run is the only guard against that;
  say in the README what the badge covers (target URL, platform).

## What the badge must NOT claim

- Not "approved", "listed", "accepted", "certified" or "compliant": the directories decide, with manual review.
- Not "secure" or "safe": the rules check review criteria and a subset of the MCP spec, not a security audit.
- Not "MCP spec conformant": findings that apply only to the spec do not change the directory verdict (`verdict()` in `src/report/score.ts` counts the platform's own findings; `--fail-on-spec` affects the exit
  code only).
- Not any affiliation with Anthropic or OpenAI; do not use their logos in the badge.
- Not a score: the score is provisional (README) and is not what the verdict says.
- Not "no blockers" or "no issues": warnings can exist under NEEDS ATTENTION, and the manual checklist is open.

## Optional product follow-up (not proposed for now)

The Action could write the badge JSON itself (a `badge-json` output path), saving the node step. It would still
need the user's token to publish it, so the saving is small; revisit if users ask.
