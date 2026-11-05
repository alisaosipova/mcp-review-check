# Listing and plugin manifests

Pass the files you submit and the run lints them against the directory checklists (rules `LST-001` to `LST-028`). With a server target (`<url>` or `--stdio`) the manifests are also cross-checked against the live server, for example that the test cases' `tools_triggered` exist in `tools/list`. **Without a target** (since 0.6.0) the run is listing-only: nothing connects, rules that need a server are skipped ("no server target (listing-only run)"), and the report says listing-only, with a null score. Use it before deploy, then add the server target to cross-check. Without the options nothing changes and the LST rules are skipped ("needs --plugin-dir" / "needs --openai-manifest").

```sh
# A Claude plugin folder (the one holding .claude-plugin/plugin.json)
npx mcp-review-check https://mcp.example.com/mcp --plugin-dir ./my-plugin --target claude

# A ChatGPT plugin package: plugin.json (extensions.com.openai) or .codex-plugin/plugin.json; the package's mcp.json is read too
npx mcp-review-check --stdio "node dist/server.js" --openai-manifest ./package/plugin.json --target chatgpt

# Before deploy: the manifests only, no server
npx mcp-review-check --plugin-dir ./my-plugin --openai-manifest ./package/plugin.json
```

`--plugin-dir` checks `.claude-plugin/plugin.json` (name, description, author, version, listing URLs, icon), a README of at least 40 words, a LICENSE, `.mcp.json` (schema, `https://`/`wss://` remote URLs, exact `npx pkg@x.y.z` / `uvx pkg==x.y.z` pins, no `.mcpb`/`.dxt` bundles, no credentials in headers), no registry in `.npmrc` next to a launcher, and no system files. `--openai-manifest` checks the listing text limits, the four HTTPS listing URLs, starter prompts, brand color contrast, icons, exactly 5 positive and 3 negative review test cases, and no `clientSecret`, reviewer credentials, server headers, apps or hooks. Icons and screenshots named in the ChatGPT manifest are measured from their PNG, JPEG, WebP or SVG headers (LST-027: square icons of 48 to 4096 px, at most 5 MiB; LST-028: PNG or JPEG screenshots 706 px wide and 400 to 860 px tall). Nothing is fetched and links are not followed. The manual checklist leaves out the items these rules cover. `--verbose` prints the parsed listing on stderr with header, env and credential values removed.

A path that does not exist, or is a file where a folder is wanted (or the reverse), is a usage error (exit 2) that names the flag and not the path. A file inside that cannot be read or parsed is a warning on stderr (relative path and error code only). Values that may be credentials (headers, `env`, `clientSecret`) are never quoted in a finding. In the [config file](options-and-config.md#config-file) the keys are `pluginDir` and `openaiManifest`, relative to the file; the flags win over the keys.

A plugin folder or package under review can bring its own config file. When you run the check in that folder, or with `--cwd` pointing at it, its `mcp-review-check.config.json` or `.mcp-review-check.json` is discovered and read, but it is not trusted: a discovered file sets options only. Its server (`url`, `stdio`, `args`), output paths (`output`, `jsonOutput`, `saveBaseline`), the stdio process's `cwd` and `env`, credentials (`header`, `bearer`), `active` and `activeAuth` are ignored with a warning, and stderr names the file that was applied, so `$MCP_REVIEW_CHECK_TOKEN` never goes to a server a checkout names. Its other keys (such as `ignore` or `failOn`) still change the result: to check someone else's folder on your own terms, pass `--no-config`, or your own file with `--config`. See [Config file](options-and-config.md#config-file).
