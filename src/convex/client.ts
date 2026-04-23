/**
 * HTTP client for the events-management Convex `/cms-snapshot/*`
 * endpoints.
 *
 * These endpoints are the contract we pull from. Full spec:
 *   events-management/convex/SNAPSHOT_CONTRACT.md
 *
 * Summary:
 *   - Base URL is the Convex `.convex.site` host (NOT `.convex.cloud`).
 *   - Auth via shared secret in `x-internal-cms-key` header
 *     (validated against Convex's INTERNAL_CMS_KEY env var).
 *   - Query params:
 *       ?city=<slug>   — optional, defaults to "tulum" server-side.
 *                        Unknown city → empty envelope (never errors).
 *       ?drafts=1      — only honored by publishable routes. Flips from
 *                        frozen published-snapshot mode to live
 *                        projection with `isDraft` tagging.
 *   - Response envelope (always):
 *       {
 *         syncedAt: ISO-8601 string,
 *         citySlug: string,
 *         [collection]: Row[],
 *         mode?: "published" | "draft"  // publishable routes only
 *       }
 *
 * Env vars required:
 *   - CONVEX_SITE_URL   e.g. https://abcd-efgh-123.convex.site
 *   - INTERNAL_CMS_KEY  shared secret (rotate together with Convex env)
 */

/**
 * Collections with no `?drafts=1` support. The sync can still pass
 * `includeDrafts: true` to these routes — the endpoint silently
 * ignores the param — but it's a code smell, so guard at the call
 * site by branching on the collection kind.
 */
const NON_PUBLISHABLE_COLLECTIONS = new Set(["redirects"]);

export interface SnapshotEnvelope<Row = unknown> {
  syncedAt: string;
  citySlug: string;
  /** Publishable routes echo this back; plain routes omit it. */
  mode?: "published" | "draft";
  /**
   * The row array lives under a key matching the URL slug
   * (`venues`, `events`, …). Typed via an index signature because
   * TypeScript can't narrow by collection name without a generic
   * and the sync doesn't benefit from the narrowing — callers reach
   * in via `envelope[collection]`.
   */
  [collection: string]: unknown;
}

export interface FetchSnapshotOptions {
  /**
   * Pass `true` to get the live projection with `isDraft` flags
   * instead of frozen published-only snapshots. Only meaningful for
   * publishable collections — see NON_PUBLISHABLE_COLLECTIONS above.
   */
  includeDrafts?: boolean;
}

/**
 * Fetch one collection's snapshot for one city.
 *
 * Throws on missing env vars, non-2xx responses, or malformed JSON.
 * The caller decides whether to bail on the whole sync or just log
 * and skip — `sync.ts` currently logs + skips per-collection so a
 * single broken endpoint doesn't starve the other 11.
 */
export async function fetchSnapshot(
  collection: string,
  citySlug: string,
  options: FetchSnapshotOptions = {},
): Promise<SnapshotEnvelope> {
  const baseUrl = process.env.CONVEX_SITE_URL;
  const key = process.env.INTERNAL_CMS_KEY;
  if (!baseUrl) {
    throw new Error("CONVEX_SITE_URL env var is not set");
  }
  if (!key) {
    throw new Error("INTERNAL_CMS_KEY env var is not set");
  }

  const url = new URL(`/cms-snapshot/${collection}`, baseUrl);
  url.searchParams.set("city", citySlug);

  // Only publishable routes honor ?drafts. Skip sending it to
  // `/cms-snapshot/redirects` etc. so the URL stays minimal + the
  // intent is clear in server logs.
  if (options.includeDrafts && !NON_PUBLISHABLE_COLLECTIONS.has(collection)) {
    url.searchParams.set("drafts", "1");
  }

  // The Convex HTTP action already emits `Cache-Control: no-store`,
  // so responses aren't cached at the transport layer. Node's built-in
  // fetch doesn't expose a `cache` option in its `RequestInit` types
  // (that's a browser-only field) — skip it.
  const res = await fetch(url, {
    headers: {
      "x-internal-cms-key": key,
      accept: "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "<no body>");
    throw new Error(
      `/cms-snapshot/${collection}?city=${citySlug}: ` +
        `${res.status} ${res.statusText} — ${body.slice(0, 200)}`,
    );
  }

  const parsed = (await res.json()) as SnapshotEnvelope;
  if (!parsed || typeof parsed !== "object" || !("syncedAt" in parsed)) {
    throw new Error(
      `/cms-snapshot/${collection}?city=${citySlug}: response lacks envelope shape`,
    );
  }
  return parsed;
}

/**
 * Helper — extract the row array for a given collection from an
 * envelope. Envelope keys match the URL slug, so `venues` envelope →
 * `envelope.venues`. Typed narrowly because the sync always knows
 * which collection it just fetched.
 */
export function rowsOf<Row = unknown>(
  envelope: SnapshotEnvelope,
  collection: string,
): Row[] {
  const rows = envelope[collection];
  if (!Array.isArray(rows)) {
    throw new Error(
      `envelope for /cms-snapshot/${collection} missing "${collection}" array`,
    );
  }
  return rows as Row[];
}
