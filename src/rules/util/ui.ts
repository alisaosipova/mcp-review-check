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
  /**
   * The resources/read content item whose uri matches; failing that, the only item (or the only text/html item), so
   * its HTML and _meta are still checked (APPS-001 reports the uri mismatch).
   */
  item?: Obj;
  /** item is that fallback: its uri differs from the requested one. */
  itemUriMismatch?: boolean;
  /** _meta from the read item, falling back to the list entry. */
  meta: Obj;
  ui: Obj;
  html?: string;
}

/** Decoded HTML per content item (A09-07): each UI rule reads it, and a blob is up to HTML_CAP of base64. Checked
 *  against the item's text and blob, so an item changed in place is decoded again. */
const DECODED = new WeakMap<Obj, { text: unknown; blob: unknown; html: string | undefined }>();

export function decodeItem(item: Obj | undefined): string | undefined {
  if (!item) return undefined;
  const hit = DECODED.get(item);
  if (hit && hit.text === item.text && hit.blob === item.blob) return hit.html;
  let html: string | undefined;
  if (isStr(item.text)) html = item.text;
  else if (isStr(item.blob)) {
    try { html = Buffer.from(item.blob, 'base64').toString('utf8'); } catch { html = undefined; }
  }
  DECODED.set(item, { text: item.text, blob: item.blob, html });
  return html;
}

/**
 * The view is built once per snapshot and shared by its callers (15 rules and the report counts, A09-07), memoized like
 * the corpus (text.ts): keyed by the raw tools array, checked against the lists and the reads it was built from, and
 * dropped after the current task. The check reads every read entry again through the snapshot, so a rule of a stopped
 * run is still tracked on the reads it depends on.
 */
const UI_MEMO = new WeakMap<object, { tools: unknown; toolCount: number; resources: unknown; resourceCount: number; reads: unknown[]; view: UiResource[] }>();

export function uiResources(snap: Snapshot): UiResource[] {
  const { tools, resources } = snap;
  const reads = snap.resourceReads;
  const memo = UI_MEMO.get(tools);
  if (memo && memo.tools === tools && memo.toolCount === tools.length && memo.resources === resources && memo.resourceCount === resources.length
    && memo.view.every((r, i) => reads[r.uri] === memo.reads[i])) return [...memo.view];
  const view = buildUiResources(tools, resources, reads);
  const built = { tools, toolCount: tools.length, resources, resourceCount: resources.length, reads: view.map((r) => r.read), view };
  UI_MEMO.set(tools, built);
  queueMicrotask(() => { if (UI_MEMO.get(tools) === built) UI_MEMO.delete(tools); });
  return [...view];
}

function buildUiResources(tools: Snapshot['tools'], resources: Snapshot['resources'], reads: Snapshot['resourceReads']): UiResource[] {
  const byUri = new Map<string, UiResource>();
  const get = (uri: string) => {
    let r = byUri.get(uri);
    if (!r) { r = { uri, tools: [], meta: {}, ui: {} }; byUri.set(uri, r); }
    return r;
  };
  for (const t of tools) {
    const uri = uiUriOf(t);
    if (isStr(uri)) get(uri).tools.push(toolName(t));
  }
  for (const r of resources) if (isStr(r.uri) && r.uri.startsWith('ui://')) get(r.uri).listEntry = r;
  // The first list entry per URI, for a linked URI that is not ui:// (a linear lookup, not a find per URI).
  const firstByUri = new Map<string, Obj>();
  for (const x of resources) if (isStr(x.uri) && !firstByUri.has(x.uri)) firstByUri.set(x.uri, x);
  for (const r of byUri.values()) {
    r.listEntry ??= firstByUri.get(r.uri);
    r.read = reads[r.uri];
    const contents = isObj(r.read?.raw) && Array.isArray(r.read.raw.contents) ? r.read.raw.contents : [];
    r.item = contents.find((c): c is Obj => isObj(c) && c.uri === r.uri);
    if (!r.item) {
      const items = contents.filter(isObj);
      const html = items.filter((c) => isStr(c.mimeType) && /^\s*text\/html\b/i.test(c.mimeType));
      const only = items.length === 1 ? items[0] : html.length === 1 ? html[0] : undefined;
      if (only) { r.item = only; r.itemUriMismatch = true; }
    }
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
  /** Keys the hosts do not read (APPS-005), with the known field they most likely mean. */
  unknown: Array<{ field: string; suggestion?: string }>;
  /** Raw entries with their field name and the list they feed (APPS-006). */
  entries: Array<{ field: string; value: string; list: CspList }>;
}

export type CspList = 'resource' | 'connect' | 'frame' | 'base' | 'redirect';

const MCP_FIELDS: Record<string, keyof Pick<CspView, 'resource' | 'connect' | 'frame' | 'base'>> = {
  resourceDomains: 'resource', connectDomains: 'connect', frameDomains: 'frame', baseUriDomains: 'base',
};
const OAI_FIELDS: Record<string, keyof Pick<CspView, 'resource' | 'connect' | 'frame' | 'redirect'>> = {
  resource_domains: 'resource', connect_domains: 'connect', frame_domains: 'frame', redirect_domains: 'redirect',
};

const squash = (k: string) => k.toLowerCase().replace(/[-_]/g, '').replace(/s$/, '');

export function cspOf(r: UiResource): CspView {
  const v: CspView = { declared: false, resource: [], connect: [], frame: [], base: [], redirect: [], malformed: [], unknown: [], entries: [] };
  const read = (obj: unknown, fields: Record<string, CspList>, label: string) => {
    if (obj === undefined) return;
    v.declared = true;
    if (!isObj(obj)) { v.malformed.push(label); return; }
    for (const field of Object.keys(obj)) {
      if (field in fields) continue;
      // connectDomains in openai/widgetCSP, connect_domains or connectDomain in ui.csp: same letters, other spelling.
      const k = squash(field);
      v.unknown.push({ field: `${label}.${field}`, suggestion: Object.keys(fields).find((f) => squash(f) === k) });
    }
    for (const [field, key] of Object.entries(fields)) {
      const val = obj[field];
      if (val === undefined) continue;
      if (!Array.isArray(val) || !val.every(isStr)) { v.malformed.push(`${label}.${field}`); continue; }
      v[key].push(...val);
      for (const value of val) v.entries.push({ field, value, list: key });
    }
  };
  read(r.ui.csp, MCP_FIELDS, 'ui.csp');
  read(r.meta['openai/widgetCSP'], OAI_FIELDS, 'openai/widgetCSP');
  return v;
}
