# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [semantic versioning](https://semver.org/) as described in the README's [Stability policy](README.md#stability-policy): while the version is 0.x, new rules and higher severities ship only in minor releases, and patch releases never make a passing run fail.

Each release notes the rule catalog date and groups rule changes under **Rules added**, **Severity raised**, **Severity lowered / false positives fixed** and **Rules retired** (retired IDs are never reused).

## [Unreleased]

First public release, planned as 0.1.0.

### Added

- Rule catalog dated 2026-10-22: automated rules (SRV, SPEC, TOOL, INJ, DATA, POL, APPS, AUTH, RT) and manual checklist items (MAN), each linked to its public source.
- Checks remote Streamable HTTP, legacy HTTP+SSE and stdio servers, including OAuth discovery probes and opt-in runtime checks (`--active`, `--active-auth`).
- Text, JSON, Markdown and SARIF reports with per-platform verdicts for the Claude connector directory and ChatGPT plugins.
- `npm pack` and `npm publish` build `dist/` themselves (`prepack`), so a package made from a clean clone ships a working `mcp-review-check` binary.
- CI on Node 20.19, 22 and 24 on Linux, macOS and Windows (build, typecheck of sources and tests, tests, a packed-tarball smoke run), a release workflow that publishes a version tag to npm with provenance through trusted publishing (OIDC), and Dependabot updates for npm and GitHub Actions.
- A stability policy in the README.
- `--stdio -- <command> [args...]` passes the server command verbatim, without quoting rules.
- Secret redaction for stdio as well as HTTP: one redactor per run scrubs every report format and the `--verbose` output of `--bearer`, `--header` and `--env` values, URL credentials, and stdio arguments after secret-looking flags, kebab-case or camelCase (`--api-key X`, `--accessToken X`, `--token=X`, `API_KEY=X`, `Authorization: Bearer X`), including where the server echoes them on stdout, on stderr or in its tool metadata. Usage errors no longer repeat option values.

#### Rules added

#### Severity raised

#### Severity lowered / false positives fixed

#### Other rule changes

### Changed

- Requires Node 20.19 or newer. The development dependencies moved to vitest 4 and `@types/node` 20, and `npm audit` reports no known vulnerabilities.
- The version in `--version`, the report header, JSON `tool.version` and the `clientInfo` sent to the server is read from `package.json` (one place).
- In `--stdio "<command>"`, a backslash outside quotes is literal, so Windows paths such as `C:\Users\me\server.js` work. Use quotes (or the `--` form) for arguments with spaces.
