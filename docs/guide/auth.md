# Authentication

How to check a server that requires OAuth.

## Token recipe

On a server that answers `401`, the auth checks run without a token, and the report says that the tool, resource and UI checks need one. mcp-review-check does not run the browser sign-in itself; give it an access token:

1. Use a test account: the one you give the directory reviewers anyway (MAN-003, MAN-026), not a personal or admin account.
2. Get an access token for that account from your authorization server, issued for this MCP server: ask for the server URL as the `resource` ([RFC 8707](https://www.rfc-editor.org/rfc/rfc8707.html)), because the server must check the token's audience ([MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)). If your authorization server allows the client credentials grant ([RFC 6749, section 4.4](https://www.rfc-editor.org/rfc/rfc6749.html#section-4.4)) for a test client:

   ```bash
   export MCP_REVIEW_CHECK_TOKEN="$(curl -s https://auth.example.com/oauth/token \
     -d grant_type=client_credentials -d client_id="$CLIENT_ID" -d client_secret="$CLIENT_SECRET" \
     -d resource=https://mcp.example.com/mcp | jq -r .access_token)"
   ```

   Otherwise, mint a token for the test account with your identity provider's own tools, or sign in once with an MCP client and copy the access token it received.
3. Run the check with the token in `MCP_REVIEW_CHECK_TOKEN` (it stays out of shell history; `--bearer` works too). The token is redacted in every report format. In CI, keep it in a secret (see [CI recipes](ci.md#ci-recipes)).

If the report says "Server rejected the token (401)", check the token's audience (`resource`), expiry and scopes.

## OAuth-protected servers

- Without a token the auth checks (`AUTH-*`: 401 challenge, Protected Resource Metadata, authorization server metadata, PKCE S256, CIMD/DCR, scopes) still run, and the report says which checks need a token. The score reads `n/a` until the tool checks have run.
- The tool does not run a browser sign-in. It sends the token as `Authorization: Bearer` (`--bearer` or `MCP_REVIEW_CHECK_TOKEN`) and redacts it in every output.
- `--active-auth` also probes dynamic client registration, `/authorize` and `/token`. It **creates a DCR client** on your authorization server; use it on a test environment.
- In CI keep the token in a secret, and add `--fail-on-incomplete` so an expired or rejected token fails the job instead of leaving it green ([CI and automation](ci.md)).
