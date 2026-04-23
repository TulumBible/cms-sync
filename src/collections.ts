/**
 * Registry of collections the sync pulls from Convex.
 *
 * Adding a new collection = add a line here + add a registration on
 * the Convex side (see events-management/convex/http.ts). The sync
 * loop iterates this list in order.
 *
 * The `publishable` flag mirrors events-management's split between
 * `registerPublishableSnapshotRoute` (venues, events, blogs, …) and
 * `registerSnapshotRoute` (redirects). Publishable routes honor
 * `?drafts=1`; plain routes ignore it.
 */

export interface CollectionDef {
  /** Matches the URL path and the envelope key. */
  slug: string;
  /** Default filename written under data/{city}/. */
  filename: string;
  /**
   * `true` for routes registered via `registerPublishableSnapshotRoute`
   * on the Convex side. Draft-branch runs pass `?drafts=1` only to
   * these.
   */
  publishable: boolean;
}

export const COLLECTIONS: readonly CollectionDef[] = [
  // Core content tables — publishable workflow, all emitted per-city.
  { slug: "venues", filename: "venues.json", publishable: true },
  { slug: "events", filename: "events.json", publishable: true },
  { slug: "blogs", filename: "blogs.json", publishable: true },
  // Child/denormalisation tables joined via id arrays on the core rows.
  { slug: "categories", filename: "categories.json", publishable: true },
  { slug: "amenities", filename: "amenities.json", publishable: true },
  { slug: "authors", filename: "authors.json", publishable: true },
  { slug: "faqs", filename: "faqs.json", publishable: true },
  { slug: "reviews", filename: "reviews.json", publishable: true },
  // Standalone publishable tables.
  { slug: "yachts", filename: "yachts.json", publishable: true },
  { slug: "villas", filename: "villas.json", publishable: true },
  { slug: "legals", filename: "legals.json", publishable: true },
  // Non-publishable — active redirects only, no draft mode.
  { slug: "redirects", filename: "redirects.json", publishable: false },
] as const;
