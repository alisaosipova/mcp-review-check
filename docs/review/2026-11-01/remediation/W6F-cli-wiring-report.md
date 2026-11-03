# W6F-cli-wiring report (wave 6, 0.4.0)

CLI wiring for the listing loaders (W6B step 2) and the config keys W6A deferred.

## Done

1. `--plugin-dir <dir>` and `--openai-manifest <file>` in `src/cli.ts`. After `buildSnapshot` and before `runRules`, `loadPluginDir` / `loadOpenAiManifest` results are merged and put on `snap.listing` with `attachListing`, as W6B designed, so LST rules run and the manual checklist is filtered. A path that does not exist or is the wrong kind (dir vs file) is a usage error (exit 2) before connecting: `--plugin-dir: no such directory (the path is not shown)`, `--openai-manifest must be a file, not a directory`; an empty value is `needs a ... path`. Paths are relative to the working directory. Listing read errors go to stderr as `warning: --plugin-dir <relative path> <message>` (scrubbed with the redactor; no contents). Rules never quote credential values (W6B), so redaction is unchanged and tested.
2. Config keys `pluginDir`, `openaiManifest` (strings, resolved relative to the config file) and `failOnDrift`, `diffOnly` (switches) in `src/config.ts`. Same validation; flags override the file; errors name the key, not the value.
3. `--help`: two options and two examples. README: option rows, a "Listing and plugin manifests" section with examples (Claude plugin dir, ChatGPT plugin manifest), config keys list and path rule updated, "Command line only (no config key yet)" notes replaced by the key names, and the Limitations sentence saying manifests are not linted yet replaced.
4. Tests: `test/remediation-w6f-listing-cli.test.ts` (12 tests): config keys and their types, flag-over-file precedence, failOnDrift from the file without `--baseline`, usage errors (missing, wrong kind, empty, no target), end-to-end runs over `test/fixtures/listing/*` with LST findings in JSON and MAN-015 dropped, both flags together, relative path, and a SYNTH token in a plugin header absent from json/text/markdown/sarif/junit with `--verbose`.

## Decision: listing-only run

W6B designed the loaders as an addition to a check ("Also lint ..."; wiring after `buildSnapshot`, LST-015/025/026 cross-check the live server), and did not design a run without a target. Both flags therefore require `<url>` or `--stdio`; the existing "give exactly one of <url> or --stdio" error applies, and `--help` and README say so.

## Deferred

- Listing-only run without a target (would need a snapshot built without a connection and a rule-set/report path that tolerates an empty server). Reason: `feature: listing-only mode`.
- `--verbose` dump of the listing: not added, so nothing new to redact.

## Files

Changed: `src/cli.ts`, `src/config.ts`, `README.md`. New: `test/remediation-w6f-listing-cli.test.ts`, this report.
Not done by me: `npm run readme:rules` (RULE_COUNT 147 -> 173 in README and spec) remains for the integrator, as W6B noted.

## Test commands

- `npm run typecheck`: pass. `npm run build`: pass.
- `npx vitest run test/remediation-w6f-*.test.ts test/remediation-w5a-*.test.ts test/remediation-w6a-*.test.ts test/remediation-w6b-*.test.ts test/rules/listing.test.ts test/docs.test.ts test/remediation-w3c-cli-tests.test.ts`: 10 files, 127 tests passed.

## Proposed CHANGELOG lines (Unreleased)

- Added: `--plugin-dir <dir>` and `--openai-manifest <file>` run the LST rules over a Claude plugin folder or a ChatGPT plugin package manifest next to a `<url>` or `--stdio` check. A missing path or the wrong kind is a usage error (exit 2).
- Added: config keys `pluginDir`, `openaiManifest` (paths relative to the file), `failOnDrift` and `diffOnly`.

## Proposed spec paragraph

**§2.x CLI wiring of the listing inputs.** `--plugin-dir` and `--openai-manifest` (config keys `pluginDir`, `openaiManifest`) are checked before connecting (exists, right kind; otherwise exit 2 naming the flag, never the path) and read after the handshake; the result is stored as `snap.listing` before the rules run. Both need a server target. Read problems are warnings on stderr with a relative path and error code.
