# Show HN draft: mcp-review-check

DRAFT for the maintainer to rewrite.

Venue rules (from memory, verify against https://news.ycombinator.com/showhn.html before posting): Show HN is for
something people can try; a link to the repo is fine; no vote requests and no asking friends to upvote or comment
(HN detects and penalises it); the poster should be around to answer comments; do not edit the title into a
marketing line, moderators rewrite those. (verify)

## Title

Show HN: mcp-review-check - lint your MCP server before directory review

(72 characters. Alternative, 79: "Show HN: Lint your MCP server against the Claude and ChatGPT directory criteria".)

## Body

mcp-review-check connects to an MCP server (Streamable HTTP, HTTP+SSE or stdio), snapshots its tools, resources and
MCP Apps widgets, and checks them against 179 rules taken from the public review criteria of the Claude and ChatGPT
directories and the MCP spec, each rule linked to its source. It is read-only by default, needs no account, and
prints a per-directory verdict plus copy-paste fixes. https://github.com/alisaosipova/mcp-review-check

## First comment

Maintainer here. Some answers up front.

Why not just read the directory docs. You should; every rule links to the page it comes from (`explain <RULE-ID>`
prints it). The docs are spread over several pages per directory, and the two directories ask for different things.
On 7 public servers I captured on 2026-10-22, 1 of the 4 already listed in the Claude directory lacked the explicit
annotation booleans ChatGPT asks for. The tool checks every tool on every run, which reading does not, and it can
fail a CI job when a new tool ships without a title or hints. Caveat on that number: n = 7, chosen by me (4 listed,
3 that gave false positives earlier), and they are the tool's own regression fixtures, so it is in-sample. Method:
docs/launch/aggregate-2026-11-03.md. A larger pre-registered capture is planned.

False positives and severity. One principle: a rule is an error only when the source states a MUST or a rejection
criterion and the check is deterministic (a missing field, a malformed value). Heuristics, such as word lists for
prompt injection or data collection, are capped at warning. `--ignore <RULE-ID>` drops a rule from the exit code
and the score; it stays in the JSON. If a finding is wrong, an issue with the JSON report attached is the most
useful thing you can send.

No telemetry. It talks only to the server you check, the authorization servers that server's OAuth metadata names
if it answers 401, and your DNS resolver. Tokens go through `MCP_REVIEW_CHECK_TOKEN` and are redacted in every
output format. It calls no tool unless you pass `--active`, and then only tools annotated `readOnlyHint: true`.

What it does not check. A clean run says "NO AUTOMATED BLOCKERS", not "approved". Reviews include manual testing and
policy judgment. 31 items are a manual checklist (privacy policy, listing fields, screenshots, test accounts, test
cases, whether descriptions match real behaviour); `--checklist` prints them. Transport and OAuth checks need a live
server; runtime checks need `--active`. It is not a security audit, and it is not affiliated with Anthropic or
OpenAI.

LureKit. Same author, other side of the same problem: mcp-review-check checks the server you publish, LureKit checks
the agent setup you run. LureKit measured that default Claude Code 2.1.317 took 4 of 21 inert lures, all through
config files in the project directory (settings/hooks and .mcp.json), and that `--setting-sources user` took it to
0 of 21 (headless runs). Both are inert, cited, reproducible, no telemetry.

## Number sources

- 179 rules: `README.md` (RULE_COUNT marker), `node dist/cli.js --help` header (`rules 2026-11-02`).
- 7 servers, 2026-10-22, 4 listed / 3 false-positive picks, 1 of 4 listed with a ChatGPT error:
  `docs/launch/aggregate-2026-11-03.md`.
- 31 manual items: `node dist/cli.js --list-rules MAN`.
- No telemetry and what it contacts: `docs/guide/privacy-and-requests.md`, `SECURITY.md`.
- LureKit 4 of 21 and 0 of 21: `/home/kali/packages/lurekit/docs/launch/article-lurekit-2026-11.md` (bundles
  `aab-20261103071018-88a78d8f` and `aab-20261103062614-49ac1ce7`).
