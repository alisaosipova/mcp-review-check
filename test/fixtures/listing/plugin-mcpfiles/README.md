# Acme Notes plugin

Acme Notes connects Claude to your Acme workspace so you can search, read and summarize your notes without leaving
the conversation. The plugin runs the Acme Notes MCP server over HTTPS at mcp.acme.test and a small local helper
pinned to an exact npm version. It sends only the queries you type to the Acme API and stores nothing on disk.

```bash
claude plugin install acme-notes
```

## Privacy

Acme Notes reads notes available to your connected account only. See https://acme.test/privacy.
