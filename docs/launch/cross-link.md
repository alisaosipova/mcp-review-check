# Cross-link proposal: mcp-review-check and LureKit

Versions as found on 2026-11-03: mcp-review-check `package.json` 0.7.0; LureKit `package.json` 1.1.1 in
`/home/kali/packages/lurekit` (read only, not changed). Repository URLs from each `package.json`:
github.com/alisaosipova/mcp-review-check and github.com/alisaosipova/lurekit.

Division of labour, the same sentence in both projects:

> mcp-review-check checks the server you publish, LureKit checks the agent setup you run.

## 1. This README: "Related" section (applied)

Placed after "Compared with other tools" and before "FAQ":

```markdown
## Related

[LureKit](https://github.com/alisaosipova/lurekit), by the same author, is a security benchmark for deployed
coding-agent setups (agent, model, permission mode, settings, MCP servers, hooks, skills): it replays scenarios
derived from public disclosures with inert fixtures. mcp-review-check checks the server you publish, LureKit checks
the agent setup you run.
```

## 2. docs/guide/walkthrough.md: "after you ship" line (applied)

Appended at the end of step 8:

```markdown
After you ship, keep the baseline job from step 6 running so a changed tool definition fails the build. mcp-review-check checks the server you publish, LureKit checks the agent setup you run: if you also run coding agents with MCP servers, see [LureKit](https://github.com/alisaosipova/lurekit).
```

## 3. LureKit README: mirror line (NOT applied; for the LureKit maintainer)

Suggested place: a new `## Related` section before `## License` (LureKit's README has `## Documentation` then
`## License`).

```markdown
## Related

[mcp-review-check](https://github.com/alisaosipova/mcp-review-check), by the same author, lints an MCP server against
the public review criteria of the Claude and ChatGPT directories and the MCP spec. mcp-review-check checks the server
you publish, LureKit checks the agent setup you run.
```

## Wording rules

- Same sentence on both sides, word for word, so neither tool is read as covering the other's job.
- No claim that running both makes a setup "secure" or a server "approved".
- "By the same author" states the relation plainly; no other endorsement.
