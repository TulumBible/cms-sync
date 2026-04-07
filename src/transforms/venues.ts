/**
 * Webflow → normalized venue transforms.
 *
 * Field slugs and option ID mappings come from the live Webflow venue
 * collection (slug: "venue", id: 6361c1cba09d95ad9b422dae) discovered via
 * the Webflow API.
 */

import type { WebflowItem } from "../webflow/collections.js";

// ============================================================
// Option-field ID → display value mappings
// ============================================================

const CATEGORY_OPTIONS: Record<string, string> = {
  "9bdf043c4558efe33362afe74b13ae39": "cenote",
  "ef33b4e93f0f0023147c9267a8d93ecf": "restaurant",
  "41accc3c1ca721673c9122871b9006e5": "nightclub",
  "cfb1fb36c5f954cf0f9c05baa0a29912": "beachclub",
  "d1dab861797143b44d92a14a0f516ed3": "cafe",
  "a37dbdda9243b9625c846533cabba6f7": "rooftop",
  "bb18d96aef38297fba9d808e8b895989": "lagoon",
};

const AREA_OPTIONS: Record<string, string> = {
  "a5cca364021897578aeb3bf8155aebe6": "hotel-zone",
  "bf9720b38aa87e734b7a3d844961331d": "downtown",
  "5d32743349786f23dedfec73a7da0a53": "aldea-zama",
  "3ac8276144c3c55cc177ede0a5fbca2d": "la-veleta",
  "616444e5423a8e694ef55e2d06531e95": "uptown",
};

const PRICING_OPTIONS: Record<string, string> = {
  "9533301caf485f3238092ef2dfb79aa5": "$",
  "acd41c48ef7310ba85b0f818278e1277": "$$",
  "6c5fb8197a7ad362d9db713762ea912b": "$$$",
  "74d43aa275702e23389aa1562a42fdb8": "$$$$",
  "23fc6463b6a6670e1600b27d4357f829": "$$$$$",
};

function resolveCategory(id: string | undefined): string | null {
  if (!id) return null;
  return CATEGORY_OPTIONS[id] ?? null;
}

function resolveArea(id: string | undefined): string | null {
  if (!id) return null;
  return AREA_OPTIONS[id] ?? null;
}

function resolvePricing(id: string | undefined): string | null {
  if (!id) return null;
  return PRICING_OPTIONS[id] ?? null;
}

// ============================================================
// Image helpers
// ============================================================

function extractImageUrl(raw: unknown): string | undefined {
  if (!raw) return undefined;
  if (typeof raw === "string") return raw;
  if (typeof raw === "object" && raw !== null) {
    const obj = raw as Record<string, unknown>;
    return (obj.url as string) ?? undefined;
  }
  return undefined;
}

function extractImageUrls(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map(extractImageUrl)
      .filter((u): u is string => !!u);
  }
  const single = extractImageUrl(raw);
  return single ? [single] : [];
}

function collectVenueImages(fd: Record<string, unknown>): string[] {
  const urls: string[] = [];
  for (const key of ["image-1", "image-2", "image-3", "image-4", "image-5"]) {
    const url = extractImageUrl(fd[key]);
    if (url) urls.push(url);
  }
  urls.push(...extractImageUrls(fd["extra-images"]));
  return urls;
}

function asStringId(raw: unknown): string | undefined {
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return undefined;
}

// ============================================================
// Venue locale + base transforms
// ============================================================

export interface VenueLocaleData {
  name: string;
  description: string;
  body: string;
  address: string;
  feesHtml: string;
}

/** Extract locale-specific fields from a single fieldData blob. */
export function transformVenueLocale(
  fieldData: Record<string, unknown>,
): VenueLocaleData {
  return {
    name: String(fieldData["name"] ?? "").trim(),
    description: String(fieldData["description"] ?? ""),
    body: String(fieldData["body"] ?? ""),
    address: String(fieldData["actual-address"] ?? ""),
    feesHtml: String(fieldData["fees"] ?? ""),
  };
}

export interface VenueBaseData {
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

/** Extract non-locale (base) fields from a Webflow venue item. */
export function transformVenueBase(item: WebflowItem): VenueBaseData {
  const fd = item.fieldData;

  const slug = String(fd["slug"] ?? "").trim();
  if (!slug) {
    throw new Error(`Venue ${item.id} has no slug — cannot sync`);
  }

  const imageUrls = collectVenueImages(fd);
  const coverImage = extractImageUrl(fd["image-1"]) ?? null;

  const foodMenu = fd["food-menu"];
  const drinkMenu = fd["drink-menu"];

  return {
    slug,
    category: resolveCategory(asStringId(fd["category"])),
    area: resolveArea(asStringId(fd["area"])),
    pricing: resolvePricing(asStringId(fd["pricing"])),
    coverImage,
    imageUrls,
    isClosed: fd["is-closed"] === true,
    isFeatured: fd["featured"] === true,
    isFeaturedOnCoreTulum: fd["featured-on-core-tulum"] === true,
    googleMapsCode:
      typeof fd["address"] === "string" && fd["address"]
        ? (fd["address"] as string)
        : null,
    foodMenuUrl: typeof foodMenu === "string" && foodMenu ? foodMenu : null,
    drinkMenuUrl:
      typeof drinkMenu === "string" && drinkMenu ? drinkMenu : null,
    openingHoursHtml: String(fd["opening-times-2"] ?? ""),
  };
}

// ============================================================
// Locale merging
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
