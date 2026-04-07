/**
 * Webflow → normalized venue transforms.
 *
 * Lifted from tb-ai-concierge/packages/convex/convex/sync/transforms.ts
 * (transformVenueLocale, transformVenueBase) and actions.ts (mergeLocaleItems),
 * with all Convex-specific code stripped out.
 */

import type { WebflowItem } from "../webflow/collections.js";

// ============================================================
// Field slug constants
// ============================================================
//
// Slugs marked NEW are added for the core-tulum lite output and
// will be verified against the live Webflow schema in Batch 2.

export const VENUE_FIELDS = {
  // Locale-specific
  name: "name",
  tagline: "tagline", // NEW — short locale-specific headline
  neighborhood: "neighborhood", // NEW — locale-specific neighborhood label
  description: "description", // PlainText — short description
  body: "body", // RichText — long/rich description
  address: "actual-address", // PlainText
  menuDescription: "menu-description",
  fees: "fees",

  // Base
  slug: "slug",
  category: "category", // MultiReference → Categories collection
  isClosed: "is-closed",
  area: "area",
  image1: "image-1",
  image2: "image-2",
  image3: "image-3",
  image4: "image-4",
  image5: "image-5",
  multiImage: "multi-image",
  coverImage: "cover-image", // NEW — explicit cover image (falls back to image-1)
  tableLayout: "table-layout",
  isFeatured: "featured",
  featuredOnCoreTulum: "featured-on-core-tulum", // NEW — gates lite output
  openingTimes: "opening-times", // RichText (legacy)
  openingHours: "opening-hours", // NEW — structured per-day hours (PlainText/JSON)
  googleMapsCode: "google-maps-code",
  pricing: "pricing",
  priceRange: "price-range", // NEW — explicit display string ("$$", "$$$", etc.)
  foodMenu: "food-menu",
  drinkMenu: "drink-menu",
  disabledDays: "disabled-days",
  maxHours: "max-hours",
  minHours: "min-hours",
  hideReservationForm: "hide-reservation-form",
  faqs: "faqs",
  amenities: "amenities",
} as const;

// ============================================================
// HTML / image / category helpers
// ============================================================

function stripHtml(html: string | undefined | null): string {
  if (!html) return "";
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&middot;/g, "·")
    .replace(/&#8211;/g, "–")
    .replace(/&#8212;/g, "—")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/\s+/g, " ")
    .trim();
}

function extractImageUrl(raw: unknown): string | undefined {
  if (!raw) return undefined;
  if (typeof raw === "string") return raw;
  if (typeof raw === "object" && raw !== null) {
    const obj = raw as Record<string, unknown>;
    return (obj.url as string) ?? undefined;
  }
  return undefined;
}

function extractImageUrls(raw: unknown): string[] | undefined {
  if (!raw) return undefined;
  if (Array.isArray(raw)) {
    return raw.map(extractImageUrl).filter((u): u is string => !!u);
  }
  const single = extractImageUrl(raw);
  return single ? [single] : undefined;
}

function collectVenueImages(fd: Record<string, unknown>): string[] {
  const urls: string[] = [];
  for (const key of [
    VENUE_FIELDS.image1,
    VENUE_FIELDS.image2,
    VENUE_FIELDS.image3,
    VENUE_FIELDS.image4,
    VENUE_FIELDS.image5,
  ]) {
    const url = extractImageUrl(fd[key]);
    if (url) urls.push(url);
  }
  const multiUrls = extractImageUrls(fd[VENUE_FIELDS.multiImage]);
  if (multiUrls) urls.push(...multiUrls);
  return urls;
}

const CATEGORY_MAP: Record<string, string> = {
  restaurant: "restaurant",
  restaurants: "restaurant",
  bar: "bar",
  bars: "bar",
  "beach club": "beach_club",
  "beach-club": "beach_club",
  beach_club: "beach_club",
  beachclub: "beach_club",
  nightclub: "nightclub",
  nightclubs: "nightclub",
  club: "nightclub",
  cenote: "cenote",
  cenotes: "cenote",
  lagoon: "lagoon",
  lagoons: "lagoon",
  "day club": "beach_club",
  lounge: "bar",
  rooftop: "bar",
  brunch: "restaurant",
  cafe: "restaurant",
};

export type VenueCategory =
  | "restaurant"
  | "bar"
  | "beach_club"
  | "nightclub"
  | "cenote"
  | "lagoon"
  | "other";

export function normalizeCategoryFromNames(names: string[]): VenueCategory {
  for (const name of names) {
    if (!name || typeof name !== "string") continue;
    const key = name.toLowerCase().trim();
    const mapped = CATEGORY_MAP[key];
    if (mapped) return mapped as VenueCategory;
  }
  return "other";
}

/**
 * Parse the opening-hours field. Webflow stores this as PlainText; the
 * editorial convention is to use JSON like `{"mon":"9-17", ...}`. If the
 * value isn't JSON-parseable into a flat string→string map, return null.
 */
function parseOpeningHours(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

// ============================================================
// Venue locale + base transforms
// ============================================================

export interface VenueLocaleData {
  name: string;
  tagline: string;
  neighborhood: string;
  shortDescription?: string;
  description?: string;
  address?: string;
}

/** Extract locale-specific fields from a single fieldData blob. */
export function transformVenueLocale(
  fieldData: Record<string, unknown>,
): VenueLocaleData {
  const get = (slug: string) => fieldData[slug];
  return {
    name: String(get(VENUE_FIELDS.name) ?? "").trim(),
    tagline: String(get(VENUE_FIELDS.tagline) ?? "").trim(),
    neighborhood: String(get(VENUE_FIELDS.neighborhood) ?? "").trim(),
    shortDescription:
      (get(VENUE_FIELDS.description) as string) ?? undefined,
    description: get(VENUE_FIELDS.body)
      ? stripHtml(get(VENUE_FIELDS.body) as string)
      : undefined,
    address: (get(VENUE_FIELDS.address) as string) ?? undefined,
  };
}

export interface VenueBaseData {
  slug: string;
  category: VenueCategory;
  coverImage: string | null;
  imageUrls: string[];
  priceRange: string | null;
  openingHours: Record<string, string> | null;
  isFeaturedOnCoreTulum: boolean;
  isFeatured: boolean;
  isPublished: boolean;
}

/**
 * Extract non-locale (base) fields from a Webflow venue item.
 * `categoryNames` should be the resolved Categories-collection display names
 * for this venue's MultiReference category field.
 */
export function transformVenueBase(
  item: WebflowItem,
  categoryNames: string[] = [],
): VenueBaseData {
  const fd = item.fieldData;
  const get = (slug: string) => fd[slug];

  const slug = String(get(VENUE_FIELDS.slug) ?? "").trim();
  if (!slug) {
    throw new Error(`Venue ${item.id} has no slug — cannot sync`);
  }

  const imageUrls = collectVenueImages(fd);
  const explicitCover = extractImageUrl(get(VENUE_FIELDS.coverImage));
  const coverImage = explicitCover ?? imageUrls[0] ?? null;

  const priceRangeRaw = get(VENUE_FIELDS.priceRange) ?? get(VENUE_FIELDS.pricing);
  const priceRange =
    typeof priceRangeRaw === "string" && priceRangeRaw.trim()
      ? priceRangeRaw.trim()
      : null;

  return {
    slug,
    category: normalizeCategoryFromNames(categoryNames),
    coverImage,
    imageUrls,
    priceRange,
    openingHours: parseOpeningHours(get(VENUE_FIELDS.openingHours)),
    isFeaturedOnCoreTulum: Boolean(get(VENUE_FIELDS.featuredOnCoreTulum)),
    isFeatured: Boolean(get(VENUE_FIELDS.isFeatured)),
    isPublished:
      !item.isDraft && !item.isArchived && !get(VENUE_FIELDS.isClosed),
  };
}

// ============================================================
// Locale merging (lifted from sync/actions.ts)
// ============================================================

export interface MergedVenueEntry {
  primary: WebflowItem;
  localeFieldData: Record<string, Record<string, unknown>>;
}

/** Merge primary and secondary locale items by item ID. */
export function mergeLocaleItems(
  primaryItems: WebflowItem[],
  secondaryItems: WebflowItem[],
  primaryTag: string,
  secondaryTag: string,
): Map<string, MergedVenueEntry> {
  const merged = new Map<string, MergedVenueEntry>();

  for (const item of primaryItems) {
    merged.set(item.id, {
      primary: item,
      localeFieldData: { [primaryTag]: item.fieldData },
    });
  }

  for (const item of secondaryItems) {
    const entry = merged.get(item.id);
    if (entry && secondaryTag) {
      entry.localeFieldData[secondaryTag] = item.fieldData;
    }
  }

  return merged;
}
