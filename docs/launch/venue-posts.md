# Venue posts: mcp-review-check

DRAFT for the maintainer to rewrite. Different text per venue. Venue rules below are from memory unless stated and
are marked (verify); read each venue's pinned rules the day you post.

Shared rules for all venues: post once per venue, from the maintainer's own account, and stay to answer. No asks
for stars, upvotes or reposts, no coordinated replies, no sock accounts. State the sample caveat whenever a number
from the 7-server aggregate appears. Do not use the Anthropic or OpenAI logos.

Positioning sentence (verbatim, use once per post at most):

> Pass directory review the first time: lint your MCP server against the Claude and ChatGPT directory criteria and
> the MCP spec before you submit.

Pair sentence (verbatim, only where LureKit is relevant):

> One author, two measurement tools for the agent era: mcp-review-check checks the server you publish, LureKit
> checks the agent setup you run. Both inert, cited, reproducible, no telemetry.

## 1. MCP GitHub Discussions (primary)

Where: the Discussions of the `modelcontextprotocol` GitHub organisation (verify which repo hosts them and whether
there is a "Show and tell" or community-tools category; verify).

Rules (verify): discussions there are about the protocol and its ecosystem; a tool announcement belongs in a
show-and-tell style category if one exists, not in spec proposals or Q&A; moderators may close or move posts that
are only promotion. Off-topic or repeated posts get removed.

Angle: spec feedback, not promotion. The useful thing for this audience is where the directory criteria and the spec
diverge.

Title: A linter that checks servers against the spec plus the Claude/ChatGPT directory criteria

> I maintain mcp-review-check, an MIT CLI that lints an MCP server against the MCP spec and the public review
> criteria of the Claude and ChatGPT directories. Each rule cites its source; the catalog is in docs/RULES.md.
>
> Two things from building it that may matter for the spec:
>
> - Tool annotations are hints with defaults in the spec, but the ChatGPT criteria want all three of
>   `readOnlyHint`, `destructiveHint` and `openWorldHint` as explicit booleans, and the Claude criteria want at
>   least one of the first two. Spec defaults do not satisfy either. On 7 public servers I captured (small,
>   hand-picked, in-sample), these annotation rules produced 19 of the 41 error findings.
> - Spec-only findings do not change a directory verdict; `--fail-on-spec` makes them fail CI.
>
> If a rule misreads the spec, I would like to know; issues with the JSON report attached are easiest to act on.
>
> https://github.com/alisaosipova/mcp-review-check

Number note: 19 = TOOL-012 (11) + TOOL-011 (8) error findings, `docs/launch/aggregate-2026-11-03.md`.

## 2. MCP Discord (primary)

Where: the community MCP Discord (verify the official invite link from modelcontextprotocol.io; verify there is a
channel for showing projects, and its name).

Rules (verify): self-promotion only in the designated showcase channel; no cross-posting the same message to several
channels; no DMs to members about the project; links without context get removed.

Message (short, one post in the showcase channel):

> mcp-review-check: lint an MCP server against the Claude and ChatGPT directory review criteria and the MCP spec
> before you submit. `npx mcp-review-check <url>` or `--stdio -- node dist/server.js`. Read-only by default, no
> account, no telemetry, every rule links to its source. On 7 public servers I captured (small, hand-picked,
> in-sample), every error was missing tool annotation hints, missing tool titles, or for MCP Apps a missing widget
> domain or CSP.
> https://github.com/alisaosipova/mcp-review-check
> Happy to look at false positives here or in issues.

## 3. r/ClaudeAI (for connector authors)

Rules (verify against the sidebar): post flair required; self-promotion has to be useful to the community and
disclosed as your own project; low-effort promotion and repeated posts are removed; check whether there is a weekly
or megathread for tools instead of a standalone post (verify).

Flair: whichever flair the sub uses for projects or tools (verify).

Title: I built a linter for Claude connector authors: checks your MCP server against the directory criteria

> Disclosure: my own project, MIT, free.
>
> If you are building a connector for the Claude directory, mcp-review-check runs the checks that can be automated
> from the public review criteria, plus the MCP spec, and prints a verdict: BLOCKED, NEEDS ATTENTION or NO AUTOMATED
> BLOCKERS. On a BLOCKED run it prints the fix, and for tool annotations a JSON snippet to paste.
>
> The only two Claude errors on 7 public servers I captured (small, hand-picked, in-sample; one server each): a
> tool without `title` (TOOL-006) and a tool with neither `readOnlyHint` nor `destructiveHint` (TOOL-011). `npx mcp-review-check explain TOOL-011` prints why and the source page.
>
> What it does not do: approve anything. Review includes manual testing; 31 checklist items (privacy policy, example
> prompts, test account, screenshots) stay manual and are printed with `--checklist`. Not affiliated with Anthropic.
>
> `npx mcp-review-check https://your-server/mcp --target claude`
> https://github.com/alisaosipova/mcp-review-check

Optional last line, only if a commenter asks about agent-side risk: the pair sentence above, with a link to LureKit.

## Not posted here (by design)

- r/mcp and other subreddits: not chosen as primary; if used, write a new text (verify their rules).
- Hacker News: see `show-hn-mrc.md`.
- Newsletters: see `newsletter-pitches.md`.

## Sources

- 41 errors, 19 from annotation rules, top rules: `docs/launch/aggregate-2026-11-03.md`.
- 31 manual items: `node dist/cli.js --list-rules MAN`.
- Verdict words, read-only default, no telemetry, `--fail-on-spec`: `README.md`, `node dist/cli.js --help`.
