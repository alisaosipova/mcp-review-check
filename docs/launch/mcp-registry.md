# Official MCP Registry: does it apply?

Draft for review. No registry was contacted (no network calls to directory or registry servers); statements about
the registry below are from general knowledge of its published process and are marked **verify** where the details
matter.

## Is mcp-review-check an MCP server?

No. Checked in the code on 2026-11-03:

- `package.json` has one `bin`, `mcp-review-check` -> `dist/cli.js`, and `exports` exposes only `./package.json`.
- `grep -rln "McpServer\|server/stdio\|StdioServerTransport" src` returns nothing: the code uses the MCP SDK as a
  **client** (it connects to a server, lists and optionally calls tools), and never serves MCP itself.
- README: "mcp-review-check is a command-line tool only".

## Conclusion

**The official MCP Registry does not apply.** The registry lists MCP servers (a `server.json` describes how a client
installs or connects to a server: packages with a transport, or remote URLs). Publishing a linter there would be a
false entry: an MCP client that adds it would get nothing to connect to. No `server.json` is drafted for that reason.

## What it would take to become one (not recommended now)

Only if the project ever ships an MCP server mode, for example a `review_server` tool that runs the check and
returns the JSON report, so an agent can lint a server it is building. That is a product decision with its own
risks (the tool makes outbound requests to a URL the model chooses: an SSRF-shaped capability that would need an
allowlist). If it is built, the publication steps would be, **verify each against the registry's current docs**:

1. Add `"mcpName": "io.github.alisaosipova/mcp-review-check"` to `package.json` and publish that version to npm (the
   registry checks that the npm package claims the name).
2. Write `server.json` with the name, description, version and a `packages` entry (`registryType: npm`,
   `identifier: mcp-review-check`, `transport: { type: stdio }`), validated against the registry's JSON Schema.
3. Install the registry's publisher CLI (`mcp-publisher`), `mcp-publisher login github`, `mcp-publisher publish`.

What needs the user's identity or keys:

- `io.github.alisaosipova/*` names: a GitHub login as `alisaosipova` (interactive, or OIDC from GitHub Actions).
- A domain name such as `com.example/*`: proof of control of the domain, by a DNS TXT record or a file served over
  HTTPS, signed with a key pair the user generates and keeps private. Not needed for the `io.github` namespace.
- npm: the existing trusted-publishing setup (`release.yml`) covers the `mcpName` release; no new npm token.

## What can be listed instead

| Where | What | Status |
|---|---|---|
| GitHub Marketplace | the GitHub Action (`action.yml`) | see [marketplace.md](marketplace.md) |
| npm | the CLI, already published by `release.yml` | the version on npm was not checked here |
| GitHub repository topics | discovery via `mcp`, `model-context-protocol`, `linter`, `github-actions` (already `package.json` keywords) | set in the repo settings; not checked offline |
| Community "awesome" lists of MCP tooling | a one-line entry under a developer-tools or testing section, not under servers | candidates to check by hand; each list's own contribution rules decide |
| The MCP ecosystem pages of the spec's documentation | only if they have a section for developer tools | verify |

Suggested one-line entry for a list (aggregate wording, no claims about acceptance):

> [mcp-review-check](https://github.com/alisaosipova/mcp-review-check) - CLI and GitHub Action that lint an MCP
> server against the public review criteria of the Claude and ChatGPT directories and the MCP spec, with a source
> link per rule. Read-only by default.

Rule for every listing: put it under tools/developer tooling, never under servers, and do not describe a clean result
as approval by a directory.
