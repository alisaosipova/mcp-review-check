// Client capabilities the linter declares. Declaring the MCP Apps extension matters: servers built on the
// ext-apps pattern (getUiCapability) only list UI tools and ui:// resources for clients that declare it.
import { RESOURCE_MIME_TYPE, UI_EXTENSION } from '../rules/util/ui.js';

export { UI_EXTENSION };

/** Declared on every connection (SDK initialize, raw initialize probes, 2026-07-28 _meta). */
export const CLIENT_CAPABILITIES = { extensions: { [UI_EXTENSION]: { mimeTypes: [RESOURCE_MIME_TYPE] } } };

/** A text-only client: used for the second tools/list that checks the UI fallback (APPS-019). */
export const TEXT_ONLY_CAPABILITIES = {};
