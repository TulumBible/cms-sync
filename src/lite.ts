/**
 * Lite venue projection — the public JSON consumed by core-tulum.
 *
 * Filters: featured-on-core-tulum === true AND not draft AND not archived.
 * Schema is the contract documented in README.md.
 */

import type { WebflowItem } from "./webflow/collections.js";
import type {
  VenueBaseData,
  VenueLocaleData,
} from "./transforms/venues.js";

export interface FullVenue {
  webflowItemId: string;
  base: VenueBaseData;
  locales: Record<string, VenueLocaleData>;
  lastPublished?: string;
  lastUpdated?: string;
}

export interface LiteVenueLocale {
  name: string;
  tagline: string;
  neighborhood: string;
}

export interface LiteVenue {
  slug: string;
  category: string;
  coverImage: string | null;
  priceRange: string | null;
  openingHours: Record<string, string> | null;
  tulumBibleSlug: string;
  locales: {
    en: LiteVenueLocale;
    es: LiteVenueLocale;
  };
}

function pickLocale(
  locales: Record<string, VenueLocaleData>,
  tag: string,
): LiteVenueLocale {
  const data = locales[tag];
  return {
    name: data?.name ?? "",
    tagline: data?.tagline ?? "",
    neighborhood: data?.neighborhood ?? "",
  };
}

/**
 * Project a fully-normalized venue into the lite shape.
 * Returns null if the venue should be filtered out of the lite output.
 */
export function toLiteVenue(
  venue: FullVenue,
  rawItem: WebflowItem,
): LiteVenue | null {
  if (rawItem.isDraft || rawItem.isArchived) return null;
  if (!venue.base.isFeaturedOnCoreTulum) return null;

  return {
    slug: venue.base.slug,
    category: venue.base.category,
    coverImage: venue.base.coverImage,
    priceRange: venue.base.priceRange,
    openingHours: venue.base.openingHours,
    tulumBibleSlug: venue.base.slug,
    locales: {
      en: pickLocale(venue.locales, "en"),
      es: pickLocale(venue.locales, "es"),
    },
  };
}
