# Awesome-list entries: mcp-review-check

DRAFT for the maintainer to rewrite. Nothing has been submitted. List names, sections and contribution rules are from
memory and marked (verify); read each list's CONTRIBUTING file before opening a PR.

General rules: one PR per list, follow the list's entry format and alphabetical order exactly, no badges or emoji
in the entry, a description that says what it does (not "best" or "powerful"). Lists remove entries that read as
ads and often reject PRs from the tool's own author without disclosure; say it is your project in the PR body.

## 1. awesome-mcp (fits: tooling)

Target: an MCP list that has a section for developer tooling (testing, linting, debugging), not a list of MCP
servers. mcp-review-check is not an MCP server (`package.json` has one `bin`, no server entry point;
`docs/launch/mcp-registry.md`), so a servers-only list is the wrong place. Candidates (verify which exist, are
maintained, and accept tooling): an "awesome-mcp-devtools" style list with a testing or validation section
(verify), or an "awesome-mcp" list with a "Tools" or "Developer tools" section (verify).

Entry (adjust to the list's format):

```markdown
- [mcp-review-check](https://github.com/alisaosipova/mcp-review-check) - Lints an MCP server against the Claude and ChatGPT directory review criteria and the MCP spec; CLI and GitHub Action, read-only by default, every rule cites its source.
```

PR title:

```
Add mcp-review-check (MCP server linter for directory review criteria)
```

PR body:

```markdown
Adds mcp-review-check to <section>.

What it is: an MIT-licensed CLI and GitHub Action that checks an MCP server (Streamable HTTP, HTTP+SSE or stdio)
against the public review criteria of the Claude and ChatGPT directories and the MCP spec. 179 rules, each linked to
its source (docs/RULES.md). Read-only by default, no account, no telemetry. Output: text, JSON, Markdown, SARIF,
JUnit.

Why this section: it is a development and testing tool for server authors, not an MCP server itself.

Disclosure: I am the author.

Checklist: entry follows the list format and ordering; link points to the repository; description has no marketing
terms.
```

## 2. awesome-security (weak fit; submit only if a section matches)

Target: sbilly/awesome-security (verify the repo and that it still accepts PRs). Its sections are mostly network,
endpoint, web and threat-intel tooling (verify). mcp-review-check is a review-criteria linter. Its security-related
parts are limited: prompt-injection markers in tool metadata (INJ), sensitive-data parameters (DATA), OAuth
metadata checks (AUTH), and secret redaction. It is not a vulnerability scanner or an audit. If no section is a
natural fit, do not submit; LureKit is the better candidate for security lists.

Entry, if a "Web" or "DevSecOps"-style section exists (verify):

```markdown
- [mcp-review-check](https://github.com/alisaosipova/mcp-review-check) - Linter for MCP servers: checks tool metadata, OAuth metadata and MCP Apps widget CSP against the MCP spec and directory review criteria, including prompt-injection markers in tool descriptions.
```

PR title:

```
Add mcp-review-check to <section>
```

PR body:

```markdown
Adds mcp-review-check, an MIT-licensed linter for MCP (Model Context Protocol) servers.

Security-relevant checks: deterministic prompt-injection markers in tool metadata (hidden Unicode, explicit
"ignore previous instructions"), parameters that collect secrets or conversation history, OAuth protected-resource
and authorization-server metadata, and widget CSP. Heuristic checks are capped at warning. It is read-only by
default and redacts tokens in all outputs.

It is not a vulnerability scanner and makes no security guarantee; it checks published review criteria and part of
the MCP spec.

Disclosure: I am the author.
```

## Sources

- Not an MCP server: `package.json` (`bin`, `exports`); `docs/launch/mcp-registry.md`.
- 179 rules, output formats, read-only default, no telemetry, rule categories (INJ, DATA, AUTH, APPS): `README.md`.
- Heuristics capped at warning, deterministic injection markers are errors: `README.md` (Limitations).
- License: `LICENSE`.
