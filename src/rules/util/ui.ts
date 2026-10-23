// UI resource view shared by APPS and POL rules (§2.7).
import type { Snapshot } from '../../snapshot.js';
import { isObj, isStr, metaOf, toolName, uiUriOf, type Obj } from './access.js';

export const RESOURCE_MIME_TYPE = 'text/html;profile=mcp-app';
/** The MCP Apps client capability (capabilities.extensions key). */
export const UI_EXTENSION = 'io.modelcontextprotocol/ui';

export interface UiResource {
  uri: string;
  tools: string[];
  listEntry?: Obj;
  read?: Snapshot['resourceReads'][string];
  /** The resources/read content item whose uri matches. */
  item?: Obj;
  /** _meta from the read item, falling back to the list entry. */
  meta: Obj;
  ui: Obj;
  html?: string;
}

export function decodeItem(item: Obj | undefined): string | undefined {
  if (!item) return undefined;
  if (isStr(item.text)) return item.text;
  if (isStr(item.blob)) {
    try { return Buffer.from(item.blob, 'base64').toString('utf8'); } catch { return undefined; }
  }
  return undefined;
}

export function uiResources(snap: Snapshot): UiResource[] {
  const byUri = new Map<string, UiResource>();
  const get = (uri: string) => {
    let r = byUri.get(uri);
    if (!r) { r = { uri, tools: [], meta: {}, ui: {} }; byUri.set(uri, r); }
    return r;
  };
  for (const t of snap.tools) {
    const uri = uiUriOf(t);
    if (isStr(uri)) get(uri).tools.push(toolName(t));
  }
  for (const r of snap.resources) if (isStr(r.uri) && r.uri.startsWith('ui://')) get(r.uri).listEntry = r;
  for (const r of byUri.values()) {
    r.listEntry ??= snap.resources.find((x) => x.uri === r.uri);
    r.read = snap.resourceReads[r.uri];
    const contents = isObj(r.read?.raw) && Array.isArray(r.read.raw.contents) ? r.read.raw.contents : [];
    r.item = contents.find((c): c is Obj => isObj(c) && c.uri === r.uri);
    const itemMeta = metaOf(r.item);
    r.meta = Object.keys(itemMeta).length ? itemMeta : metaOf(r.listEntry);
    r.ui = isObj(r.meta.ui) ? r.meta.ui : {};
    r.html = decodeItem(r.item);
  }
  return [...byUri.values()];
}

export interface CspView {
  declared: boolean;
  resource: string[];
  connect: string[];
  frame: string[];
  base: string[];
  redirect: string[];
  /** Fields present but not string[] (APPS-005). */
  malformed: string[];
  /** Raw entries with their field name (APPS-006). */
  entries: Array<{ field: string; value: string }>;
}

const MCP_FIELDS: Record<string, keyof Pick<CspView, 'resource' | 'connect' | 'frame' | 'base'>> = {
  resourceDomains: 'resource', connectDomains: 'connect', frameDomains: 'frame', baseUriDomains: 'base',
};
const OAI_FIELDS: Record<string, keyof Pick<CspView, 'resource' | 'connect' | 'frame' | 'redirect'>> = {
  resource_domains: 'resource', connect_domains: 'connect', frame_domains: 'frame', redirect_domains: 'redirect',
};

export function cspOf(r: UiResource): CspView {
  const v: CspView = { declared: false, resource: [], connect: [], frame: [], base: [], redirect: [], malformed: [], entries: [] };
  const read = (obj: unknown, fields: Record<string, keyof CspView>, label: string) => {
    if (obj === undefined) return;
    v.declared = true;
    if (!isObj(obj)) { v.malformed.push(label); return; }
    for (const [field, key] of Object.entries(fields)) {
      const val = obj[field];
      if (val === undefined) continue;
      if (!Array.isArray(val) || !val.every(isStr)) { v.malformed.push(`${label}.${field}`); continue; }
      (v[key] as string[]).push(...val);
      for (const value of val) v.entries.push({ field, value });
    }
  };
  read(r.ui.csp, MCP_FIELDS, 'ui.csp');
  read(r.meta['openai/widgetCSP'], OAI_FIELDS, 'openai/widgetCSP');
  return v;
}
