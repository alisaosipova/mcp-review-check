# Listing and plugin manifests

Pass the files you submit and the same run lints them against the directory checklists (rules `LST-001` to `LST-026`). Both options need a server target (`<url>` or `--stdio`): the manifests are checked next to the live server, for example that the test cases' `tools_triggered` exist in `tools/list`. Without the options nothing changes and the LST rules are skipped ("needs --plugin-dir" / "needs --openai-manifest").

```sh
# A Claude plugin folder (the one holding .claude-plugin/plugin.json)
npx mcp-review-check https://mcp.example.com/mcp --plugin-dir ./my-plugin --target claude

# A ChatGPT plugin package: plugin.json (extensions.com.openai) or .codex-plugin/plugin.json; the package's mcp.json is read too
npx mcp-review-check --stdio "node dist/server.js" --openai-manifest ./package/plugin.json --target chatgpt
```

`--plugin-dir` checks `.claude-plugin/plugin.json` (name, description, author, version, listing URLs, icon), a README of at least 40 words, a LICENSE, `.mcp.json` (schema, `https://`/`wss://` remote URLs, exact `npx pkg@x.y.z` / `uvx pkg==x.y.z` pins, no `.mcpb`/`.dxt` bundles, no credentials in headers), no registry in `.npmrc` next to a launcher, and no system files. `--openai-manifest` checks the listing text limits, the four HTTPS listing URLs, starter prompts, brand color contrast, icons, exactly 5 positive and 3 negative review test cases, and no `clientSecret`, reviewer credentials, server headers, apps or hooks. Nothing is fetched and links are not followed. The manual checklist leaves out the items these rules cover.

A path that does not exist, or is a file where a folder is wanted (or the reverse), is a usage error (exit 2) that names the flag and not the path. A file inside that cannot be read or parsed is a warning on stderr (relative path and error code only). Values that may be credentials (headers, `env`, `clientSecret`) are never quoted in a finding. In the [config file](options-and-config.md#config-file) the keys are `pluginDir` and `openaiManifest`, relative to the file; the flags win over the keys.
