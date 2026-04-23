/**
 * Convex venue snapshot → legacy `venues-full.json` + `venues-lite.json`
 * shapes. Preserves the exact contract that `tb-ai-concierge` and
 * `tulum-core` have been reading since the Webflow era — migrating
 * the SOURCE of truth without forcing a downstream rewrite.
 *
 * When adding/removing fields on the Convex side, either:
 *   - extend this transform to preserve the legacy field (backward
 *     compat), OR
 *   - migrate the legacy consumers to read the new envelope directly
 *     and retire this file.
 *
 * The Convex venue snapshot shape is the source of truth. See
 * `events-management/convex/publish/snapshots.ts:projectVenueSnapshot`.
 */

// ---------------------------------------------------------------------------
// Incoming shape — subset of projectVenueSnapshot output used by legacy.
// Kept narrow on purpose; extras pass through untouched.
// ---------------------------------------------------------------------------

interface ConvexVenueLocale {
  slug?: string;
  name?: string;
  description?: string;
  body?: string;
  address?: string;
  feesHtml?: string;
  menuDescription?: string;
}

interface ConvexVenueBase {
  category?: string | null;
  area?: string | null;
  pricing?: string | null;
  coverImage?: string | null;
  imageUrls?: string[];
  isClosed?: boolean;
  isFeatured?: boolean;
  isFeaturedOnCoreTulum?: boolean;
  googleMapsCode?: string | null;
  foodMenuUrl?: string | null;
  drinkMenuUrl?: string | null;
  openingHoursHtml?: string;
  publishedAt?: string | null;
}

export interface ConvexVenueRow {
  convexId: string;
  base: ConvexVenueBase;
  locales: {
    en: ConvexVenueLocale;
    es: ConvexVenueLocale;
  };
  lastUpdated?: string;
}

// ---------------------------------------------------------------------------
// Legacy output shapes — unchanged from the Webflow era.
// ---------------------------------------------------------------------------

export interface LegacyFullVenueLocale {
  name: string;
  description: string;
  body: string;
  address: string;
  feesHtml: string;
}

export interface LegacyFullVenueBase {
  slug: string;
  category: string | null;
  area: string | null;
  pricing: string | null;
  coverImage: string | null;
  imageUrls: string[];
  isClosed: boolean;
  isFeatured: boolean;
  isFeaturedOnCoreTulum: boolean;
  googleMapsCode: string | null;
  foodMenuUrl: string | null;
  drinkMenuUrl: string | null;
  openingHoursHtml: string;
}

export interface LegacyFullVenue {
  /**
   * Originally a Webflow item ID; now the Convex row `_id`. Consumers
   * treated this as an opaque join key so the switch is transparent.
   * Field name kept for contract stability.
   */
  webflowItemId: string;
  base: LegacyFullVenueBase;
  locales: {
    en: LegacyFullVenueLocale;
    es: LegacyFullVenueLocale;
  };
  /** Derived from Convex `publishedAt` (fallback to `lastUpdated`). */
  lastPublished?: string;
  lastUpdated?: string;
}

export interface LegacyLiteVenueLocale {
  name: string;
  description: string;
}

export interface LegacyLiteVenue {
  slug: string;
  category: string | null;
  area: string | null;
  pricing: string | null;
  coverImage: string | null;
  isClosed: boolean;
  /** Always equals `slug` — kept for legacy consumer compatibility. */
  tulumBibleSlug: string;
  /** HTML stripped to plain text, one line per day (Mon–Sun). */
  openingHours: string | null;
  locales: {
    en: LegacyLiteVenueLocale;
    es: LegacyLiteVenueLocale;
  };
}

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------

function pickFullLocale(locale: ConvexVenueLocale): LegacyFullVenueLocale {
  return {
    name: locale.name ?? "",
    description: locale.description ?? "",
    body: locale.body ?? "",
    address: locale.address ?? "",
    feesHtml: locale.feesHtml ?? "",
  };
}

/**
 * Project one Convex venue row → legacy full-venue shape. Pure.
 *
 * The only non-trivial mapping is `base.slug` — Convex stores per-
 * locale slugs (`locales.en.slug`, `locales.es.slug`), while the
 * legacy shape has a single `base.slug`. Use the EN slug as the
 * canonical value, matching what the URL routing has always used.
 */
export function toLegacyFullVenue(row: ConvexVenueRow): LegacyFullVenue {
  const b = row.base;
  return {
    webflowItemId: row.convexId,
    base: {
      slug: row.locales.en.slug ?? "",
      category: b.category ?? null,
      area: b.area ?? null,
      pricing: b.pricing ?? null,
      coverImage: b.coverImage ?? null,
      imageUrls: b.imageUrls ?? [],
      isClosed: b.isClosed === true,
      isFeatured: b.isFeatured === true,
      isFeaturedOnCoreTulum: b.isFeaturedOnCoreTulum === true,
      googleMapsCode: b.googleMapsCode ?? null,
      foodMenuUrl: b.foodMenuUrl ?? null,
      drinkMenuUrl: b.drinkMenuUrl ?? null,
      openingHoursHtml: b.openingHoursHtml ?? "",
    },
    locales: {
      en: pickFullLocale(row.locales.en),
      es: pickFullLocale(row.locales.es),
    },
    // `lastPublished` in the legacy shape is an ISO timestamp of the
    // last publish event. Convex emits `publishedAt` on the snapshot —
    // same semantics. When it's missing (content migrated pre-publish-
    // workflow, or a legacy row without a publish stamp), fall back to
    // `lastUpdated` so consumers still get a non-null value.
    lastPublished: b.publishedAt ?? row.lastUpdated,
    lastUpdated: row.lastUpdated,
  };
}

/**
 * Project one Convex venue row → legacy lite-venue shape. Returns
 * `null` when the venue doesn't belong in the lite payload — the
 * lite file is an opt-in subset for core-tulum's featured listing,
 * not a full catalogue.
 *
 * Filters (match legacy behavior exactly):
 *   - `isFeaturedOnCoreTulum === true`
 *   - NOT `isClosed`
 *
 * Draft/archived filtering happens upstream — Convex's published-
 * only endpoint already skips non-published rows, and the CMS has
 * no "archived" flag on venues (blogs do; see `publish/snapshots.ts`).
 */
export function toLegacyLiteVenue(
  row: ConvexVenueRow,
): LegacyLiteVenue | null {
  const b = row.base;
  if (b.isFeaturedOnCoreTulum !== true) return null;
  if (b.isClosed === true) return null;

  const slug = row.locales.en.slug ?? "";
  if (!slug) return null;

  return {
    slug,
    category: b.category ?? null,
    area: b.area ?? null,
    pricing: b.pricing ?? null,
    coverImage: b.coverImage ?? null,
    isClosed: false, // always false — filtered above
    tulumBibleSlug: slug,
    openingHours: stripOpeningHoursHtml(b.openingHoursHtml),
    locales: {
      en: {
        name: row.locales.en.name ?? "",
        description: row.locales.en.description ?? "",
      },
      es: {
        name: row.locales.es.name ?? "",
        description: row.locales.es.description ?? "",
      },
    },
  };
}

/**
 * Convert the `<p>…</p><p>…</p>` opening-hours HTML into one time
 * per line (Mon–Sun). Mirrors the legacy transform exactly so the
 * `openingHours` field in `venues-lite.json` stays byte-identical
 * where the underlying data hasn't changed.
 */
function stripOpeningHoursHtml(html: string | undefined): string | null {
  const raw = html?.trim();
  if (!raw) return null;
  return (
    raw
      .replace(/<[^>]*>/g, "\n")
      .replace(/\n{2,}/g, "\n")
      .trim() || null
  );
}
