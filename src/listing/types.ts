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
  /** Package-manager configuration files anywhere in the folder (.npmrc, bunfig.toml, uv.toml, ...), with their text. */
  packageConfigs: ListingText[];
  /** Every entry of the folder (links are listed, not followed; `.git` is skipped), up to LISTING_FILES_CAP. */
  files: ListingEntry[];
  filesTruncated?: boolean;
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
