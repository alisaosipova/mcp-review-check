// APPS: MCP Apps and widgets (§2.7).
import { createHash } from 'node:crypto';
import { defineRule, type RawFinding } from './types.js';
import { isObj, isStr, metaOf, toolName, uiMeta, uiTools, uiUriOf } from './util/access.js';
import { extractOrigins, originMatches, stripComments, type OriginKind } from './util/html.js';
import { displayUrl, isLoopbackHost, isNonPublicIp, registrableDomain, SHARED_HOST_SUFFIXES } from './util/net.js';
import { cspOf, RESOURCE_MIME_TYPE, UI_EXTENSION, uiResources } from './util/ui.js';

const APPS_SPEC = 'https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx';
const OAI_REF = 'https://developers.openai.com/plugins/reference';
const OAI_UI = 'https://developers.openai.com/plugins/build/chatgpt-ui';
const CLAUDE_APPS_DESIGN = 'https://claude.com/docs/connectors/building/mcp-apps/design-guidelines';
const CLAUDE_APPS_TROUBLE = 'https://claude.com/docs/connectors/building/mcp-apps/troubleshooting';

export const APPS_001 = defineRule(
  {
    id: 'APPS-001', title: 'UI resourceUri uses ui:// and resolves', severity: { spec: 'error' }, needs: ['ui'],
    rationale: 'Hosts fetch the widget with resources/read on a ui:// URI.',
    fix: 'Point _meta.ui.resourceUri at a ui:// resource that resources/read returns.',
    sources: [APPS_SPEC],
  },
  (snap) => {
    const out: RawFinding[] = [];
    for (const t of uiTools(snap)) {
      const uri = uiUriOf(t);
      if (!isStr(uri) || !uri.startsWith('ui://')) { out.push({ tool: toolName(t), message: `UI resource URI ${JSON.stringify(uri)} does not use ui://` }); continue; }
    }
    for (const r of uiResources(snap)) {
      if (!r.uri.startsWith('ui://')) continue;
      if (!r.read) continue;
      if (!r.read.ok) out.push({ resource: r.uri, message: 'resources/read failed for the UI resource' });
      else if (!r.item) out.push({ resource: r.uri, message: 'resources/read returned no content item with a matching uri' });
    }
    return out;
  },
);

export const APPS_002 = defineRule(
  {
    id: 'APPS-002', title: 'Deprecated or duplicated UI link keys', severity: { spec: 'warning', chatgpt: 'info' }, needs: ['tools'],
    rationale: '_meta.ui.resourceUri is the standard key; older keys are deprecated aliases.',
    fix: 'Use _meta.ui.resourceUri (keep openai/outputTemplate only as an equal alias).',
    sources: [APPS_SPEC, OAI_REF],
  },
  (snap) => snap.tools.flatMap((t): RawFinding[] => {
    const m = metaOf(t);
    const std = uiMeta(t).resourceUri;
    const flat = m['ui/resourceUri'];
    const oai = m['openai/outputTemplate'];
    const tool = toolName(t);
    const out: RawFinding[] = [];
    if (flat !== undefined && std === undefined) out.push({ tool, platforms: ['spec'], message: 'uses deprecated flat _meta["ui/resourceUri"] without _meta.ui.resourceUri' });
    if (oai !== undefined && std === undefined) out.push({ tool, platforms: ['chatgpt'], message: 'uses openai/outputTemplate without _meta.ui.resourceUri' });
    const vals = [std, flat, oai].filter((v) => v !== undefined);
    if (new Set(vals.map((v) => JSON.stringify(v))).size > 1) out.push({ tool, severity: 'warning', message: `UI link keys disagree: ${vals.map((v) => JSON.stringify(v)).join(' vs ')}` });
    return out;
  }),
);

export function normalizeMime(m: string): string {
  return m.split(';').map((p) => p.trim()).map((p, i) => (i === 0 ? p.toLowerCase() : p.replace(/^([^=]+)=/, (_, k: string) => k.toLowerCase() + '='))).join(';');
}

export const APPS_003 = defineRule(
  {
    id: 'APPS-003', title: 'UI resource MIME type and payload', severity: { spec: 'error', claude: 'error', chatgpt: 'error' }, needs: ['ui'],
    rationale: `Hosts only render resources with mimeType ${RESOURCE_MIME_TYPE}.`,
    fix: `Serve the widget with mimeType "${RESOURCE_MIME_TYPE}" and a text (or base64 blob) payload.`,
    sources: [APPS_SPEC, 'https://claude.com/docs/connectors/building/mcp-apps/quickstart'],
  },
  (snap) => {
    const out: RawFinding[] = [];
    for (const r of uiResources(snap)) {
      if (!r.item) continue;
      const mt = r.item.mimeType;
      if (!isStr(mt) || normalizeMime(mt) !== RESOURCE_MIME_TYPE) out.push({ resource: r.uri, message: `mimeType is ${JSON.stringify(mt)}, expected ${RESOURCE_MIME_TYPE}` });
      if (!isStr(r.item.text) && !isStr(r.item.blob)) out.push({ resource: r.uri, message: 'content item has neither text nor blob' });
      const lm = r.listEntry?.mimeType;
      if (isStr(lm) && isStr(mt) && normalizeMime(lm) !== normalizeMime(mt)) out.push({ resource: r.uri, severity: 'warning', message: `resources/list mimeType ${lm} differs from resources/read ${mt}` });
    }
    return out;
  },
);

export const APPS_004 = defineRule(
  {
    id: 'APPS-004', title: 'UI content looks like an HTML document', severity: { spec: 'warning' }, needs: ['ui'],
    rationale: 'The widget payload must be an HTML document.',
    fix: 'Return a full HTML document (<!doctype html>...).',
    sources: [APPS_SPEC],
  },
  (snap) => uiResources(snap).flatMap((r): RawFinding[] =>
    r.html !== undefined && !/<!doctype html|<html|<script/i.test(r.html) ? [{ resource: r.uri, message: 'content has no <!doctype html>, <html> or <script>' }] : []),
);

export const APPS_005 = defineRule(
  {
    id: 'APPS-005', title: 'UI resource declares a CSP', severity: { chatgpt: 'error', claude: 'info' }, needs: ['ui'],
    rationale: 'ChatGPT requires a declared CSP; Claude blocks all external origins by default.',
    fix: 'Declare _meta.ui.csp { connectDomains, resourceDomains, ... } on the UI resource.',
    sources: ['https://developers.openai.com/plugins/deploy/app-review', APPS_SPEC],
  },
  (snap) => uiResources(snap).flatMap((r): RawFinding[] => {
    if (!r.item && !r.listEntry) return [];
    const csp = cspOf(r);
    const out: RawFinding[] = [];
    if (!csp.declared) {
      out.push({ resource: r.uri, platforms: ['chatgpt'], message: 'no CSP declared (_meta.ui.csp or openai/widgetCSP)' });
      out.push({ resource: r.uri, platforms: ['claude'], message: 'no CSP declared; host default blocks all external origins' });
    }
    if (csp.malformed.length) out.push({ resource: r.uri, severity: 'error', message: `CSP fields are not string[]: ${csp.malformed.join(', ')}` });
    return out;
  }),
);

const BROAD = new Set(['*', 'https:', 'http:', 'https://*', 'http://*', 'wss://*']);
const CDNS = ['unpkg.com', 'cdn.jsdelivr.net'];

export const APPS_006 = defineRule(
  {
    id: 'APPS-006', title: 'CSP entries narrow and well-formed', severity: { chatgpt: 'warning', spec: 'warning' }, needs: ['ui'],
    rationale: 'CSP entries are origins; broad wildcards defeat the sandbox.',
    fix: 'List exact https origins (scheme://host[:port]) without paths.',
    sources: [OAI_UI, CLAUDE_APPS_DESIGN],
  },
  (snap) => {
    const out: RawFinding[] = [];
    for (const r of uiResources(snap)) {
      for (const { field, value } of cspOf(r).entries) {
        const resource = r.uri;
        const v = value.trim();
        if (/'unsafe-/i.test(v)) { out.push({ resource, message: `${field}: "${v}" contains an unsafe-* keyword` }); continue; }
        const wild = /^([a-z]+:\/\/)?\*\.(.+)$/i.exec(v);
        if (BROAD.has(v) || (wild && (!wild[2].includes('.') || SHARED_HOST_SUFFIXES.includes(wild[2].toLowerCase())))) {
          out.push({ resource, message: `${field}: "${v}" is overly broad` });
          continue;
        }
        if (v.includes('*') && !/^resource(Domains|_domains)$/.test(field)) out.push({ resource, platforms: ['spec'], severity: 'info', message: `${field}: wildcard "${v}" outside resourceDomains` });
        let u: URL | undefined;
        try { u = new URL(v.replace('*.', 'wildcard.')); } catch { out.push({ resource, message: `${field}: "${v}" is not an origin` }); continue; }
        if (u.protocol === 'http:' && !isLoopbackHost(u.hostname)) out.push({ resource, message: `${field}: "${v}" uses http://` });
        if (u.pathname !== '/' || u.search || u.hash || /\/$/.test(v)) out.push({ resource, message: `${field}: "${v}" has a path, query, fragment or trailing slash` });
        if (isLoopbackHost(u.hostname) || isNonPublicIp(u.hostname.replace(/^\[|\]$/g, ''))) out.push({ resource, message: `${field}: "${v}" names localhost or a private IP` });
        if (/^resource/.test(field) && CDNS.includes(u.hostname)) out.push({ resource, platforms: ['claude'], severity: 'info', message: `${field}: public CDN ${u.hostname}; serve from your own origin in production` });
      }
    }
    return out;
  },
);

const KIND_FIELD: Record<Exclude<OriginKind, 'navigate'>, 'resource' | 'connect' | 'frame' | 'base'> = {
  resource: 'resource', connect: 'connect', frame: 'frame', base: 'base',
};

export const APPS_007 = defineRule(
  {
    id: 'APPS-007', title: 'External origins used by the widget are declared in the CSP', severity: { chatgpt: 'error', claude: 'warning', spec: 'warning' }, needs: ['ui'],
    rationale: 'Undeclared origins are blocked by the host sandbox and fail review.',
    fix: 'Add every external origin to the matching CSP list (resourceDomains, connectDomains, frameDomains, baseUriDomains).',
    sources: [OAI_UI, CLAUDE_APPS_DESIGN],
  },
  (snap) => {
    const out: RawFinding[] = [];
    for (const r of uiResources(snap)) {
      if (!r.html) continue;
      const csp = cspOf(r);
      for (const o of extractOrigins(r.html)) {
        if (o.kind === 'navigate') continue;
        const list = csp[KIND_FIELD[o.kind]];
        if (list.some((e) => originMatches(o.origin, e))) continue;
        out.push({ resource: r.uri, severity: o.confidence === 'js' ? 'warning' : undefined, evidence: o.evidence, message: `${o.kind} origin ${o.origin} is not declared in the CSP` });
      }
    }
    return out;
  },
);

export const APPS_008 = defineRule(
  {
    id: 'APPS-008', title: 'Nested frames declared', severity: { claude: 'warning', chatgpt: 'warning' }, needs: ['ui'],
    rationale: 'Nested iframes get extra security review on both hosts.',
    fix: 'Avoid nested frames, or prepare a justification for each frame origin.',
    sources: [CLAUDE_APPS_DESIGN, 'https://developers.openai.com/plugins/plugin-guidelines'],
  },
  (snap) => {
    const out: RawFinding[] = [];
    const serverDomain = snap.target.kind === 'http' ? registrableDomain(snap.target.url.hostname) : undefined;
    for (const r of uiResources(snap)) {
      const frames = cspOf(r).frame;
      if (!frames.length) continue;
      out.push({ resource: r.uri, platforms: ['claude'], message: `frameDomains declared (${frames.join(', ')}); restricted pending security review` });
      const third = frames.filter((f) => { try { return registrableDomain(new URL(f.replace('*.', '')).hostname) !== serverDomain; } catch { return true; } });
      out.push({ resource: r.uri, platforms: ['chatgpt'], message: `frame domains need a justification (frame_domain_explanation_required)${third.length ? `; third-party embeds get extra scrutiny: ${third.join(', ')}` : ''}` });
    }
    return out;
  },
);

export const APPS_009 = defineRule(
  {
    id: 'APPS-009', title: 'csp or permissions placed on the tool instead of the resource', severity: { spec: 'warning' }, needs: ['tools'],
    rationale: 'Hosts read csp and permissions from the UI resource, not the tool.',
    fix: 'Move _meta.ui.csp / _meta.ui.permissions to the UI resource.',
    sources: ['https://github.com/modelcontextprotocol/ext-apps/blob/main/src/spec.types.ts'],
  },
  (snap) => snap.tools.flatMap((t): RawFinding[] => {
    const ui = uiMeta(t);
    const keys = ['csp', 'permissions'].filter((k) => ui[k] !== undefined);
    return keys.length ? [{ tool: toolName(t), message: `_meta.ui.${keys.join(' and ')} on the tool is ignored by hosts` }] : [];
  }),
);

export const APPS_010 = defineRule(
  {
    id: 'APPS-010', title: 'Tool visibility', severity: { spec: 'error', chatgpt: 'warning' }, needs: ['tools'],
    rationale: 'visibility controls whether the model or only the app can call a tool.',
    fix: 'Use _meta.ui.visibility: ["model", "app"] (or a subset).',
    sources: [APPS_SPEC, 'https://developers.openai.com/plugins/changelog'],
  },
  (snap) => snap.tools.flatMap((t): RawFinding[] => {
    const tool = toolName(t);
    const out: RawFinding[] = [];
    const vis = uiMeta(t).visibility;
    if (vis !== undefined) {
      if (!Array.isArray(vis) || vis.length === 0 || !vis.every((v) => v === 'model' || v === 'app')) out.push({ tool, platforms: ['spec'], message: `_meta.ui.visibility ${JSON.stringify(vis)} is not a non-empty array of "model"/"app"` });
      else if (vis.length === 1 && vis[0] === 'app') out.push({ tool, platforms: ['spec'], severity: 'info', message: 'visibility ["app"]: hidden from the model' });
    }
    const m = metaOf(t);
    const ov = m['openai/visibility'];
    if (ov !== undefined) {
      if (ov !== 'public' && ov !== 'private') out.push({ tool, platforms: ['chatgpt'], severity: 'error', message: `openai/visibility ${JSON.stringify(ov)} is not public or private` });
      else out.push({ tool, platforms: ['chatgpt'], message: 'openai/visibility is deprecated (2026-07-21); use _meta.ui.visibility' });
    }
    if (m['openai/widgetAccessible'] !== undefined) out.push({ tool, platforms: ['chatgpt'], severity: 'info', message: 'openai/widgetAccessible is a legacy key; use _meta.ui.visibility' });
    return out;
  }),
);

export function claudeUiDomain(urlAsEntered: string): string {
  return createHash('sha256').update(urlAsEntered).digest('hex').slice(0, 32) + '.claudemcpcontent.com';
}

export const APPS_011 = defineRule(
  {
    id: 'APPS-011', title: 'Claude ui.domain equals the URL hash', severity: { claude: 'error' }, needs: ['ui'],
    rationale: 'Claude serves widgets from a sandbox domain derived from the server URL.',
    fix: 'Set _meta.ui.domain to sha256(server URL as registered).hex[0:32] + ".claudemcpcontent.com".',
    sources: [CLAUDE_APPS_TROUBLE],
  },
  (snap) => {
    const out: RawFinding[] = [];
    for (const r of uiResources(snap)) {
      const d = r.ui.domain;
      if (!isStr(d) || !/\.claudemcpcontent\.com$/i.test(d)) continue; // meant for another host (APPS-012)
      if (snap.target.kind !== 'http') { out.push({ resource: r.uri, severity: 'info', message: 'cannot verify ui.domain for a stdio target' }); continue; }
      if (!/^[0-9a-f]{32}\.claudemcpcontent\.com$/.test(d)) { out.push({ resource: r.uri, message: `ui.domain "${d}" has an invalid format` }); continue; }
      const expected = claudeUiDomain(snap.target.urlAsEntered);
      if (d !== expected) out.push({ resource: r.uri, message: `ui.domain mismatch: expected ${expected} for ${displayUrl(snap.target.urlAsEntered)} (check trailing slash and path)` });
    }
    return out;
  },
);

export const APPS_012 = defineRule(
  {
    id: 'APPS-012', title: 'ChatGPT dedicated widget domain', severity: { chatgpt: 'error' }, needs: ['ui'],
    rationale: 'ChatGPT serves each plugin widget from its own origin.',
    fix: 'Set _meta["openai/widgetDomain"] to a unique https origin you own.',
    sources: [OAI_REF],
  },
  (snap) => {
    const out: RawFinding[] = [];
    for (const r of uiResources(snap)) {
      if (!r.item && !r.listEntry) continue;
      const uiDomain = r.ui.domain;
      const claudeFormat = isStr(uiDomain) && /\.claudemcpcontent\.com$/i.test(uiDomain);
      const d = r.meta['openai/widgetDomain'] ?? (claudeFormat ? undefined : uiDomain);
      if (d === undefined) {
        const hint = claudeFormat && snap.options.target === 'all' ? 'Set `openai/widgetDomain` for ChatGPT, keep `ui.domain` for Claude.' : undefined;
        out.push({ resource: r.uri, message: 'no widget domain (required when submitting a plugin with UI)', fix: hint });
        continue;
      }
      let ok = false;
      try { const u = new URL(String(d)); ok = isStr(d) && u.protocol === 'https:' && (u.pathname === '/' && !/\/$/.test(d)) && !u.search && !u.hash; } catch { ok = false; }
      if (!ok) out.push({ resource: r.uri, message: `widget domain ${JSON.stringify(d)} is not an absolute https origin without a path` });
      else if (String(d).replace(/\/$/, '') === 'https://web-sandbox.oaiusercontent.com') out.push({ resource: r.uri, severity: 'warning', message: 'widget domain is the shared default sandbox (not unique)' });
    }
    return out;
  },
);

export const APPS_013 = defineRule(
  {
    id: 'APPS-013', title: 'openExternal targets need redirect_domains', severity: { chatgpt: 'warning' }, needs: ['ui'],
    rationale: 'ChatGPT asks for confirmation on links outside redirect_domains.',
    fix: 'List link targets in _meta["openai/widgetCSP"].redirect_domains.',
    sources: [OAI_REF],
  },
  (snap) => {
    const out: RawFinding[] = [];
    for (const r of uiResources(snap)) {
      if (!r.html) continue;
      const redirect = cspOf(r).redirect;
      for (const o of extractOrigins(r.html)) {
        if (o.kind === 'navigate' && !redirect.some((e) => originMatches(o.origin, e))) out.push({ resource: r.uri, message: `link target ${o.origin} is not in redirect_domains` });
      }
    }
    return out;
  },
);

export const APPS_014 = defineRule(
  {
    id: 'APPS-014', title: 'App connects to the host', severity: { claude: 'warning' }, needs: ['ui'],
    rationale: 'A widget that never connects renders blank in Claude.',
    fix: 'Call app.connect() (or useApp()) and report a non-zero size.',
    sources: [CLAUDE_APPS_TROUBLE],
  },
  (snap) => uiResources(snap).flatMap((r): RawFinding[] => {
    if (!r.html) return [];
    const out: RawFinding[] = [];
    // A mention in a comment is not a use (Svelte's MCP-UI adapter documents ext-apps in a JSDoc comment), and a
    // widget that sends ui/initialize itself performs the handshake without the App class. Stripping comments only
    // narrows the "uses" test; the "connects" test reads the raw HTML so a mis-stripped string cannot hide a call.
    const usesApp = /@modelcontextprotocol\/ext-apps|new App\(/.test(stripComments(r.html));
    const connects = /\.connect\s*\(|useApp\s*\(|["'`]ui\/initialize["'`]/.test(r.html);
    if (usesApp && !connects) out.push({ resource: r.uri, message: 'uses the ext-apps App but never calls connect()' });
    if (/sendSizeChanged\s*\([^)]{0,500}height\s*:\s*0\b/.test(r.html)) out.push({ resource: r.uri, message: 'sendSizeChanged reports height 0' });
    return out;
  }),
);

export const APPS_015 = defineRule(
  {
    id: 'APPS-015', title: 'Widget uses browser APIs the sandbox blocks', severity: { chatgpt: 'warning' }, needs: ['ui'],
    rationale: 'alert/confirm/prompt and clipboard access are blocked in the widget sandbox.',
    fix: 'Use in-widget UI instead of browser dialogs; request clipboardWrite permission if needed.',
    sources: ['https://developers.openai.com/plugins/guides/security-privacy'],
  },
  (snap) => uiResources(snap).flatMap((r): RawFinding[] => {
    if (!r.html) return [];
    const m = /(^|[^.\w])(window\.)?(alert|confirm|prompt)\s*\(/m.exec(r.html) ?? /navigator\.clipboard/.exec(r.html);
    return m ? [{ resource: r.uri, message: `uses blocked browser API: ${m[0].trim()}` }] : [];
  }),
);

const TRACKERS = ['doubleclick.net', 'googlesyndication.com', 'adservice.google.com', 'facebook.net'];

export const APPS_016 = defineRule(
  {
    id: 'APPS-016', title: 'Widget style and accessibility hints', severity: { chatgpt: 'info' }, needs: ['ui'],
    rationale: 'OpenAI UI guidelines discourage storage for core state, custom fonts, missing alt text and trackers.',
    fix: 'Keep state in the host, use system fonts, add alt text, remove trackers.',
    sources: [OAI_UI, 'https://developers.openai.com/plugins/concepts/ui-guidelines'],
  },
  (snap) => uiResources(snap).flatMap((r): RawFinding[] => {
    const h = r.html;
    if (!h) return [];
    const out: RawFinding[] = [];
    if (/\b(localStorage|sessionStorage)\b/.test(h)) out.push({ resource: r.uri, message: 'uses localStorage/sessionStorage (avoid for core state)' });
    if (/@font-face|fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net/.test(h)) out.push({ resource: r.uri, message: 'loads custom fonts' });
    if ([...h.matchAll(/<img\b[^<>]*>/gi)].some((m) => !/\balt\s*=/i.test(m[0]))) out.push({ resource: r.uri, message: '<img> without alt' });
    const tr = TRACKERS.filter((t) => h.includes(t));
    if (tr.length) out.push({ resource: r.uri, severity: 'warning', message: `ad or tracker origins: ${tr.join(', ')}` });
    return out;
  }),
);

const PERMISSIONS = new Set(['camera', 'microphone', 'geolocation', 'clipboardWrite']);

export const APPS_017 = defineRule(
  {
    id: 'APPS-017', title: 'UI resource meta field types', severity: { spec: 'error' }, needs: ['ui'],
    rationale: 'Hosts ignore malformed UI resource metadata.',
    fix: 'Use a boolean prefersBorder, known permission keys with object values, and a string domain.',
    sources: [APPS_SPEC],
  },
  (snap) => uiResources(snap).flatMap((r): RawFinding[] => {
    if (!r.item && !r.listEntry) return [];
    const ui = r.ui;
    const out: RawFinding[] = [];
    if (ui.prefersBorder === undefined) out.push({ resource: r.uri, severity: 'info', message: 'prefersBorder is not set (explicit value recommended)' });
    else if (typeof ui.prefersBorder !== 'boolean') out.push({ resource: r.uri, message: 'prefersBorder is not a boolean' });
    if (ui.permissions !== undefined) {
      if (!isObj(ui.permissions)) out.push({ resource: r.uri, message: 'permissions is not an object' });
      else for (const [k, v] of Object.entries(ui.permissions)) {
        if (!PERMISSIONS.has(k)) out.push({ resource: r.uri, message: `unknown permission "${k}"` });
        else if (!isObj(v)) out.push({ resource: r.uri, message: `permission "${k}" value is not an object` });
      }
    }
    if (ui.domain !== undefined && !isStr(ui.domain)) out.push({ resource: r.uri, message: 'ui.domain is not a string' });
    return out;
  }),
);

export const APPS_018 = defineRule(
  {
    id: 'APPS-018', title: 'UI tools declare outputSchema', severity: { chatgpt: 'warning' }, needs: ['tools'],
    rationale: 'ChatGPT passes structuredContent to the widget; an outputSchema documents it.',
    fix: 'Add an outputSchema to every UI-linked tool.',
    sources: [OAI_REF],
  },
  (snap) => uiTools(snap).flatMap((t): RawFinding[] => (t.outputSchema === undefined ? [{ tool: toolName(t), message: 'UI tool has no outputSchema' }] : [])),
);

// APPS-019 is the text-only fallback; the Claude font-CSP rule proposed in the same review gets its own new ID.
export const APPS_019 = defineRule(
  {
    id: 'APPS-019', title: 'UI tools stay callable without MCP Apps (text-only fallback)', severity: { spec: 'warning', chatgpt: 'warning' }, needs: ['ui'],
    rationale: `MCP Apps asks servers to provide text-only fallback behavior for every UI-enabled tool; a tool listed only for clients that declare ${UI_EXTENSION} disappears in text-only hosts (ChatGPT asks to keep tools useful without UI for clients that do not render components).`,
    fix: `When the client does not declare ${UI_EXTENSION}, register the same tool without _meta.ui (the else-branch of getUiCapability) instead of omitting it.`,
    sources: [APPS_SPEC, OAI_UI],
  },
  (snap) => {
    const without = snap.toolsWithoutUi;
    if (!without) return []; // the text-only re-list did not run or failed
    const names = new Set(without.map(toolName));
    return snap.tools.filter((t) => isStr(uiUriOf(t)) && !names.has(toolName(t))).map((t) => ({
      tool: toolName(t), message: `listed only for clients that declare ${UI_EXTENSION}; a text-only client's tools/list omits it`,
    }));
  },
);

export const appsRules = [
  APPS_001, APPS_002, APPS_003, APPS_004, APPS_005, APPS_006, APPS_007, APPS_008, APPS_009,
  APPS_010, APPS_011, APPS_012, APPS_013, APPS_014, APPS_015, APPS_016, APPS_017, APPS_018, APPS_019,
];
