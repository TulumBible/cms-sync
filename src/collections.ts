/**
 * Registry of collections the sync pulls from Convex.
 *
 * Adding a new collection = add a line here + add a registration on
 * the Convex side (see events-management/convex/http.ts). The sync
 * fetches all collections in this list concurrently per city.
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
  /* Event hubs (`/tulum-beach-clubs`, `/tulum-cenotes`, …). Absent from
     this list until 2026-08-17, which is why those 13 pages have never
     existed: with no entry the file was never generated, Astro's fetch
     404'd, and because event-types is an OPTIONAL_COLLECTION the 404 was
     tolerated — so the build stayed green and emitted zero hub paths.
     The CMS route also had to move from a camelCase envelope key to the
     kebab slug, since `rowsOf(envelope, slug)` uses this same string. */
  { slug: "event-types", filename: "event-types.json", publishable: true },
  // Standalone publishable tables.
  { slug: "yachts", filename: "yachts.json", publishable: true },
  { slug: "villas", filename: "villas.json", publishable: true },
  { slug: "legals", filename: "legals.json", publishable: true },
  // Transportation — transfer routes + a reusable vehicle catalog.
  // Routes reference vehicles by id; both emitted per-city.
  { slug: "transport-routes", filename: "transport-routes.json", publishable: true },
  { slug: "transport-vehicles", filename: "transport-vehicles.json", publishable: true },
  // Non-publishable — active redirects only, no draft mode.
  { slug: "redirects", filename: "redirects.json", publishable: false },
] as const;
