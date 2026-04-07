/**
 * tulum-cms-sync entrypoint.
 *
 * Pulls the Webflow venues collection (primary + secondary locales),
 * normalizes it, and writes two JSON files into ./data:
 *   - venues-full.json   all non-draft, non-archived venues
 *   - venues-lite.json   only featured-on-core-tulum venues
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createWebflowClient, getSiteId } from "./webflow/client.js";
import { discoverLocales } from "./webflow/locales.js";
import {
  discoverCollections,
  fetchAllItems,
  findCollectionBySlug,
  type WebflowItem,
} from "./webflow/collections.js";
import {
  mergeLocaleItems,
  transformVenueBase,
  transformVenueLocale,
  type VenueLocaleData,
} from "./transforms/venues.js";
import { toLiteVenue, type FullVenue, type LiteVenue } from "./lite.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "..", "data");

async function writeJson(filename: string, payload: unknown): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const path = resolve(DATA_DIR, filename);
  await writeFile(path, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`  wrote ${path}`);
}

async function main(): Promise<void> {
  const client = createWebflowClient();
  const siteId = getSiteId();

  console.log("→ discovering locales");
  const locales = await discoverLocales(client, siteId);
  const primaryTag = locales.byCmsLocaleId[locales.primary.cmsLocaleId] ?? "en";
  const secondaryLocale = locales.secondary[0];
  const secondaryTag = secondaryLocale
    ? (locales.byCmsLocaleId[secondaryLocale.cmsLocaleId] ?? "es")
    : "";
  console.log(
    `  primary=${primaryTag} secondary=${secondaryTag || "(none)"}`,
  );

  console.log("→ discovering collections");
  const collections = await discoverCollections(client, siteId);
  const venueCollection = findCollectionBySlug(collections, "venue");
  if (!venueCollection) {
    throw new Error(
      `No venue collection found. Available: ${collections.map((c) => c.slug).join(", ")}`,
    );
  }
  console.log(
    `  venues collection: ${venueCollection.slug} (${venueCollection.id})`,
  );

  // Pre-fetch Categories collection for MultiReference resolution.
  const categoryCollection = findCollectionBySlug(collections, "categori");
  const categoryLookup: Record<string, string> = {};
  if (categoryCollection) {
    const categoryItems = await fetchAllItems(client, categoryCollection.id);
    for (const cat of categoryItems) {
      const catName = String(
        cat.fieldData["name"] ?? cat.fieldData["slug"] ?? "",
      );
      if (catName) categoryLookup[cat.id] = catName;
    }
    console.log(`  loaded ${Object.keys(categoryLookup).length} categories`);
  } else {
    console.warn(
      "  no categories collection — venues will default to 'other'",
    );
  }

  console.log("→ fetching venue items");
  const primaryItems = await fetchAllItems(client, venueCollection.id);
  console.log(`  ${primaryTag}: ${primaryItems.length} items`);

  let secondaryItems: WebflowItem[] = [];
  if (secondaryLocale?.cmsLocaleId) {
    secondaryItems = await fetchAllItems(
      client,
      venueCollection.id,
      secondaryLocale.cmsLocaleId,
    );
    console.log(`  ${secondaryTag}: ${secondaryItems.length} items`);
  }

  const merged = mergeLocaleItems(
    primaryItems,
    secondaryItems,
    primaryTag,
    secondaryTag,
  );

  console.log("→ transforming");
  const fullVenues: FullVenue[] = [];
  const liteVenues: LiteVenue[] = [];
  let skippedDraftOrArchived = 0;
  let failed = 0;

  for (const [, entry] of merged) {
    const item = entry.primary;
    if (item.isDraft || item.isArchived) {
      skippedDraftOrArchived++;
      continue;
    }
    try {
      const localesObj: Record<string, VenueLocaleData> = {};
      for (const [tag, fieldData] of Object.entries(entry.localeFieldData)) {
        localesObj[tag] = transformVenueLocale(fieldData);
      }

      const rawCatIds = item.fieldData["category"];
      const catIds = Array.isArray(rawCatIds)
        ? rawCatIds.map(String)
        : typeof rawCatIds === "string"
          ? [rawCatIds]
          : [];
      const categoryNames = catIds
        .map((id) => categoryLookup[id])
        .filter((n): n is string => !!n);

      const base = transformVenueBase(item, categoryNames);

      const full: FullVenue = {
        webflowItemId: item.id,
        base,
        locales: localesObj,
        lastPublished: item.lastPublished,
        lastUpdated: item.lastUpdated,
      };
      fullVenues.push(full);

      const lite = toLiteVenue(full, item);
      if (lite) liteVenues.push(lite);
    } catch (err) {
      failed++;
      console.warn(
        `  ! failed to transform ${item.id}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  const syncedAt = new Date().toISOString();

  console.log("→ writing JSON");
  await writeJson("venues-full.json", { syncedAt, venues: fullVenues });
  await writeJson("venues-lite.json", { syncedAt, venues: liteVenues });

  console.log("✓ sync complete");
  console.log(`  full: ${fullVenues.length} venues`);
  console.log(`  lite: ${liteVenues.length} venues`);
  console.log(`  skipped (draft/archived): ${skippedDraftOrArchived}`);
  if (failed > 0) console.log(`  failed: ${failed}`);
}

main().catch((err) => {
  console.error("✗ sync failed:", err);
  process.exit(1);
});
