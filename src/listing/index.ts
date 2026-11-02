// Listing inputs: --plugin-dir (Claude plugin folder) and --openai-manifest (ChatGPT plugin package), spec Q3.
import type { Snapshot } from '../snapshot.js';
import type { Listing } from './types.js';

export * from './types.js';
export { emptyListing, loadOpenAiManifest, loadPluginDir, mergeListings, openAiFormat, LISTING_FILES_CAP, LISTING_JSON_CAP, LISTING_TEXT_CAP } from './load.js';

/** Store a listing on the snapshot (additive: nothing changes without one) and report its cut strings with the other
 *  input caps in snap.limits.truncated. */
export function attachListing(snap: Snapshot, listing: Listing | undefined): Snapshot {
  if (!listing || (!listing.plugin && !listing.openai)) return snap;
  snap.listing = listing;
  if (listing.truncated.length) (snap.limits ??= { truncated: [] }).truncated.push(...listing.truncated);
  return snap;
}
