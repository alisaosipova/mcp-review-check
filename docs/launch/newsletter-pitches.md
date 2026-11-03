# Newsletter pitches: mcp-review-check

DRAFT for the maintainer to rewrite. One pitch per newsletter, each different. Facts about each venue's submission
path come from memory and are marked (verify); nothing here has been sent.

Rules for every pitch: one email or form entry, no follow-up chain, no paid placement, no request to share or vote.
Numbers only with their caveat. Do not say "approved", "certified", "compliant" or "secure".
LureKit's drafts (`lurekit/docs/launch/newsletter-pitches.md`) also pitch Console.dev and Changelog News: send
one tool per newsletter at a time, weeks apart, not two pitches from the same author in one week.

Positioning sentence (verbatim):

> Pass directory review the first time: lint your MCP server against the Claude and ChatGPT directory criteria and
> the MCP spec before you submit.

## Console.dev

Venue notes (verify all): Console is a weekly newsletter of developer tools selected by its editors; it accepts
suggestions through a form on console.dev (verify the URL); it reviews tools itself and, as far as I remember, does
not take payment for inclusion (verify). Editors tend to want: a tool developers install and use, a clear "what it
is", whether it is open source, and what it costs. Keep it short; they write their own text.

Subject / form title: mcp-review-check - lint an MCP server against directory review criteria

> mcp-review-check is an MIT-licensed CLI and GitHub Action that checks an MCP server against the public review
> criteria of the Claude and ChatGPT directories and the MCP spec, before the author submits it.
>
> It connects to a deployed (Streamable HTTP or HTTP+SSE) or local stdio server, snapshots tools, resources and
> MCP Apps widgets, and runs 179 rules. Each rule links to its public source. Output is text, JSON, Markdown,
> SARIF or JUnit, with a verdict per directory and copy-paste fixes for tool annotations.
>
> Free, no account, no telemetry, read-only by default (`npx mcp-review-check <url>`, Node 22.12+). It does not
> replace manual review: 31 checklist items stay manual.
>
> Repo: https://github.com/alisaosipova/mcp-review-check

## Changelog News

Venue notes (verify all): Changelog takes news submissions through changelog.com (a submit form for links;
verify the current path, the format has changed over time); they pick and write their own blurb; a link to a repo
or a write-up with substance does better than a bare announcement (verify).

Link to submit: the article draft `article-mrc-2026-11.md`, once published somewhere public (blog or the repo's
docs), not the README alone.

Title: What fails most often in public MCP servers, and the edits that fix it

> I captured 7 public, no-login MCP servers and ran mcp-review-check (an open-source linter for directory review
> criteria) on them. All 41 error findings came from five metadata rules: tool annotation hints, tool titles, and
> MCP Apps widget domain and CSP. 4 of the 7 missed at least one stated directory requirement; 1 of the 4 already
> listed in the Claude directory missed a ChatGPT one. The sample is small and in-sample (the tool's own
> regression fixtures), and the post says so; a larger pre-registered capture is planned. The second half maps each
> rule to the edit that clears it.

## Not pitched (reasons)

- Security newsletters: this is a review-criteria linter, not a security scanner. Pitching it as security would
  overclaim. LureKit is the better fit for those.
- MCP-specific newsletters: I do not know which are active and curated as of 2026-11 (verify before adding any).

## Sources

- 179 rules, Node 22.12, no telemetry, read-only default, output formats: `README.md`.
- 31 manual items: `node dist/cli.js --list-rules MAN`.
- 7 servers, 41 errors, five rules, 4 of 7, 1 of 4: `docs/launch/aggregate-2026-11-03.md`.
- License MIT: `README.md` (License), `LICENSE`.
