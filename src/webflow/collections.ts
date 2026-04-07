import type { WebflowClient } from "webflow-api";

export interface CollectionInfo {
  id: string;
  displayName: string;
  slug: string;
  singularName: string;
}

export interface FieldInfo {
  id: string;
  slug: string;
  displayName: string;
  type: string;
  isRequired: boolean;
}

export interface WebflowItem {
  id: string;
  cmsLocaleId?: string;
  lastPublished?: string;
  lastUpdated?: string;
  createdOn?: string;
  isArchived?: boolean;
  isDraft?: boolean;
  fieldData: Record<string, unknown>;
}

/** List all CMS collections for the site. */
export async function discoverCollections(
  client: WebflowClient,
  siteId: string,
): Promise<CollectionInfo[]> {
  const result = await client.collections.list(siteId);
  return (result.collections ?? []).map((c) => ({
    id: c.id!,
    displayName: c.displayName!,
    slug: c.slug ?? "",
    singularName: c.singularName ?? c.displayName!,
  }));
}

/**
 * Find a collection by slug.
 * Prefers an exact match (case-insensitive), then falls back to partial
 * substring match.
 */
export function findCollectionBySlug(
  collections: CollectionInfo[],
  slugSubstring: string,
): CollectionInfo | undefined {
  const lower = slugSubstring.toLowerCase();
  const exact = collections.find((c) => c.slug.toLowerCase() === lower);
  if (exact) return exact;
  return collections.find((c) => c.slug.toLowerCase().includes(lower));
}

/** Get the full field schema for a collection (useful for discovery). */
export async function getCollectionFields(
  client: WebflowClient,
  collectionId: string,
): Promise<FieldInfo[]> {
  const collection = await client.collections.get(collectionId);
  return (collection.fields ?? []).map((f) => ({
    id: f.id!,
    slug: f.slug ?? "",
    displayName: f.displayName!,
    type: String(f.type ?? ""),
    isRequired: f.isRequired ?? false,
  }));
}

/**
 * Fetch ALL items from a collection, handling offset-based pagination.
 * Optionally filtered by `cmsLocaleId` for localized content.
 */
export async function fetchAllItems(
  client: WebflowClient,
  collectionId: string,
  cmsLocaleId?: string,
): Promise<WebflowItem[]> {
  const allItems: WebflowItem[] = [];
  let offset = 0;
  const limit = 100; // Webflow maximum per page

  const MAX_PAGES = 50; // Safety cap: 50 × 100 = 5,000 items max
  let page = 0;

  while (page < MAX_PAGES) {
    page++;

    const result = await client.collections.items.listItems(collectionId, {
      cmsLocaleId,
      offset,
      limit,
    });

    const items = result.items ?? [];
    for (const item of items) {
      allItems.push({
        id: item.id!,
        cmsLocaleId: item.cmsLocaleId ?? undefined,
        lastPublished: item.lastPublished ?? undefined,
        lastUpdated: item.lastUpdated ?? undefined,
        createdOn: item.createdOn ?? undefined,
        isArchived: item.isArchived ?? undefined,
        isDraft: item.isDraft ?? undefined,
        fieldData: item.fieldData as Record<string, unknown>,
      });
    }

    const total = result.pagination?.total ?? items.length;
    offset += items.length;

    if (offset >= total || items.length === 0) {
      break;
    }
  }

  if (page >= MAX_PAGES) {
    console.warn(
      `fetchAllItems: hit MAX_PAGES limit (${MAX_PAGES}) for collection ${collectionId}`,
    );
  }

  return allItems;
}
