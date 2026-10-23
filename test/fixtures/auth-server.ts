// node:http server that mimics an OAuth-protected MCP endpoint: 401 + PRM + AS metadata.
// The good variant follows the Linear shape; options switch on specific defects.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createBridgeHandler, listen, type Started } from './http-bridge.js';

export interface AuthServerOptions {
  noWwwAuth?: boolean;
  resourceTrailingSlash?: boolean;
  twoAs?: boolean;
  issuerMismatch?: boolean;
  /** Metadata issuer has a trailing '/' that the PRM entry lacks (origin-only issuer). */
  issuerTrailingSlash?: boolean;
  /** No PRM anywhere and no resource_metadata: only legacy <origin>/.well-known/oauth-authorization-server. */
  legacyOnly?: boolean;
  noS256?: boolean;
  noRegistration?: boolean;
  clientCredentialsOnly?: boolean;
  invalidToken200?: boolean;
  delayMs?: number;
  /** Token accepted at /mcp; requests carrying it are bridged to `mcp`. */
  validToken?: string;
  mcp?: () => { connect(t: never): Promise<void> };
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

export async function startAuthServer(opts: AuthServerOptions = {}): Promise<Started> {
  let base = '';
  const bridge = opts.mcp ? createBridgeHandler(opts.mcp as never) : undefined;
  const delay = () => new Promise((r) => setTimeout(r, opts.delayMs ?? 0));

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', base);
    const issuer = base;
    if (url.pathname === '/mcp' || url.pathname === '/mcp/') {
      const auth = req.headers.authorization;
      if (bridge && opts.validToken && auth === `Bearer ${opts.validToken}`) return bridge(req, res);
      if (auth && opts.invalidToken200) return json(res, 200, { jsonrpc: '2.0', id: 0, result: {} });
      const headers: Record<string, string> = opts.noWwwAuth ? {} : opts.legacyOnly ? { 'www-authenticate': 'Bearer realm="mcp"' } : { 'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` };
      return json(res, 401, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } }, headers);
    }
    if (url.pathname === '/.well-known/oauth-protected-resource/mcp' && !opts.legacyOnly) {
      await delay();
      return json(res, 200, {
        resource: `${base}/mcp${opts.resourceTrailingSlash ? '/' : ''}`,
        authorization_servers: opts.twoAs ? [issuer, `${issuer}/second`] : [issuer],
        scopes_supported: ['notes.read', 'notes.write'],
        bearer_methods_supported: ['header'],
      });
    }
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      await delay();
      const meta: Record<string, unknown> = {
        issuer: opts.issuerMismatch ? `${issuer}/tenant` : opts.issuerTrailingSlash ? `${issuer}/` : issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        response_types_supported: ['code'],
        grant_types_supported: opts.clientCredentialsOnly ? ['client_credentials'] : ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: opts.noS256 ? ['plain'] : ['S256'],
        token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
        authorization_response_iss_parameter_supported: true,
        scopes_supported: ['notes.read', 'notes.write'],
      };
      if (!opts.noRegistration) {
        meta.client_id_metadata_document_supported = true;
        meta.registration_endpoint = `${issuer}/register`;
      }
      return json(res, 200, meta);
    }
    if (url.pathname === '/register' && req.method === 'POST') return json(res, 201, { client_id: 'client-123', token_endpoint_auth_method: 'none' });
    if (url.pathname === '/token' && req.method === 'POST') return json(res, 400, { error: 'invalid_grant', error_description: 'bad code' });
    if (url.pathname === '/authorize') { res.writeHead(302, { location: 'https://claude.ai/api/mcp/auth_callback?code=x' }); return res.end(); }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  };
  const started = await listen(handler);
  base = started.base;
  return started;
}
