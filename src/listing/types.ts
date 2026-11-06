// Listing inputs (wave 6, spec Q3): a Claude plugin folder and a ChatGPT plugin package manifest, read from disk
// before the rules run. Paths are relative to the plugin folder or package root, never absolute (they reach reports).
import type { Limits } from '../snapshot.js';

export interface ListingEntry {
  /** POSIX path relative to the plugin folder (or package root). */
  path: string;
  /** Bytes; 0 for directories and links. */
  size: number;
  kind: 'file' | 'dir' | 'symlink' | 'other';
}

/** A JSON file: `json` when it parsed, otherwise `error` (no JSON value). */
export interface ListingJson {
  path: string;
  json?: unknown;
  error?: string;
  /** 'warning' when `error` is a limit or guard of this tool (read cap, a folder link out of the root) or a problem
   *  the rules report at warning level, rather than a file the directory rejects. */
  level?: 'warning';
}

export interface ListingText {
  path: string;
  text: string;
  /** Only the first LISTING_TEXT_CAP bytes were read. */
  truncated?: boolean;
}

/** A Claude plugin folder (`--plugin-dir`): the folder that contains `.claude-plugin/plugin.json`. */
export interface PluginListing {
  /** `.claude-plugin/plugin.json`; undefined when the file does not exist. */
  manifest?: ListingJson;
  /** `.mcp.json` at the plugin root; undefined when the file does not exist. */
  mcp?: ListingJson;
  /** The README at the plugin root (README.md preferred). */
  readme?: ListingText;
  /** The LICENSE (or LICENCE, COPYING) file at the plugin root. */
  license?: string;
  /** Package-manager configuration files anywhere in the folder (.npmrc, bunfig.toml, uv.toml, a pyproject.toml with uv settings, ...), with their text. */
  packageConfigs: ListingText[];
  /** Every entry of the folder (links are listed, not followed; `.git` and the SKIPPED_DIRS dependency, VCS and build
   *  folders are skipped at any depth), up to LISTING_FILES_CAP. */
  files: ListingEntry[];
  filesTruncated?: boolean;
  /** The skipped dependency, VCS and build folders found (relative paths, at most 20; 1.1.1, A06-06). */
  skippedDirs?: string[];
  /** The MCP configuration files plugin.json names in `mcpServers` (a `.json` string or array element), in the order
   *  written (1.1.1, A06-01). Their findings are at rule severity since 1.3.0 (info in 1.1.1 to 1.2.x). */
  mcpFiles?: PluginMcpFile[];
}

/** An MCP configuration file named in plugin.json `mcpServers`: read when it is a `./` path inside the plugin. */
export interface PluginMcpFile extends ListingJson {
  /** The value as written in plugin.json. */
  ref: string;
  /** Why it was not read: not a `./` path, a path that escapes the plugin folder, or a path that does not exist. */
  problem?: 'not-relative' | 'escapes' | 'not-found';
}

/** Where the OpenAI listing fields were found: plugin.json with extensions.com.openai (Agent Plugins), a Codex
 *  manifest with a root `interface`, or a bare MCP configuration (mcp.json) with no listing at all. */
export type OpenAiFormat = 'agent-plugins' | 'codex' | 'mcp-config' | 'unknown';

/** A ChatGPT plugin package (`--openai-manifest`): its manifest and the companion MCP configuration. */
export interface OpenAiListing {
  manifest: ListingJson;
  format: OpenAiFormat;
  /** mcp.json or .mcp.json at the package root (the manifest itself for format mcp-config). */
  mcp?: ListingJson;
  /** The package root's own entries (one level). */
  files: ListingEntry[];
  /** Icons and screenshots the listing names, with their sizes (additive; absent for a bare mcp.json). */
  images?: ListingImage[];
}

export type ImageFormat = 'png' | 'jpeg' | 'webp' | 'svg';

/** An icon or screenshot named in the package manifest, examined by its header (src/listing/image.ts). */
export interface ListingImage {
  source: 'openai';
  /** The manifest key: logo, logoDark, composerIcon, composerIconDark or screenshots[n]. */
  key: string;
  /** The value as written in the manifest. */
  ref: string;
  bytes?: number;
  format?: ImageFormat;
  width?: number;
  height?: number;
  /** Why no size is known: not-a-path, outside (not a ./ path inside the package), link, not-file, missing, too-large,
   *  unreadable (detail: error code), unknown-format (no PNG/JPEG/WebP/SVG signature), no-dimensions (SVG without
   *  numeric width/height/viewBox, or a header the reader could not parse). For an SVG, `detail` is `no-start-tag` or
   *  `units` when the reader could not tell (src/listing/image.ts svgMeasure; 1.3.0, A06-03). */
  problem?: 'not-a-path' | 'outside' | 'link' | 'not-file' | 'missing' | 'too-large' | 'unreadable' | 'unknown-format' | 'no-dimensions';
  detail?: string;
}

export interface ListingError {
  source: 'plugin' | 'openai';
  path: string;
  message: string;
}

/** snap.listing: additive; absent when neither input was given (no LST rule runs then). */
export interface Listing {
  plugin?: PluginListing;
  openai?: OpenAiListing;
  /** Files that could not be read or parsed. */
  errors: ListingError[];
  /** Strings cut by the input caps (the same records as snap.limits.truncated). */
  truncated: Limits['truncated'];
}
