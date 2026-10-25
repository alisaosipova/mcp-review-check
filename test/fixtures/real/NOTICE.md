# Third-party data in this directory

The `.json` and `.json.br` files here, except `baseline-findings.json`, are responses captured on 2026-10-22 by `scripts/capture-real.mjs` from these public MCP servers, which need no login:

| File | Server | Source |
|------|--------|--------|
| `aws-knowledge.json` | AWS Knowledge MCP Server | https://knowledge-mcp.global.api.aws |
| `exa.json` | Exa | https://mcp.exa.ai/mcp |
| `huggingface.json` | Hugging Face | https://huggingface.co/mcp |
| `kiwi.json` | Kiwi.com flight search | https://mcp.kiwi.com |
| `mslearn.json` | Microsoft Learn MCP Server | https://learn.microsoft.com/api/mcp |
| `openzeppelin.json.br` | OpenZeppelin Solidity Contracts MCP Server | https://mcp.openzeppelin.com/contracts/solidity/mcp |
| `svelte.json` | Svelte MCP | https://mcp.svelte.dev/mcp |

The tool, resource and prompt text in these files and the UI resources (OpenZeppelin, Svelte) belong to their owners and stay under their owners' terms. They are **not** covered by this repository's MIT license. They are kept only as regression test inputs and are not shipped in the npm package.

`baseline-findings.json` is output of this tool on those files.

If you own one of these servers and want its file removed, please open an issue.
