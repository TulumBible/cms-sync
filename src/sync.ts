/**
 * core-cms-sync entrypoint (multi-city).
 *
 * Reads cities.json, iterates over active cities, pulls every
 * registered collection from the events-management Convex
 * `/cms-snapshot/*` endpoints, and writes per-city JSON files under
 * `data/{slug}/`.
 *
 * ## Output layout
 *
 * Per active city, one JSON file per collection:
 *   data/{slug}/venues.json
 *   data/{slug}/events.json
 *   data/{slug}/blogs.json
 *   data/{slug}/categories.json
 *   data/{slug}/amenities.json
 *   data/{slug}/authors.json
 *   data/{slug}/faqs.json
 *   data/{slug}/reviews.json
 *   data/{slug}/yachts.json
 *   data/{slug}/villas.json
 *   data/{slug}/legals.json
 *   data/{slug}/redirects.json
 *
 * Plus two legacy files projected from the venues bundle for
 * backward compat with `tb-ai-concierge` and `tulum-core`:
 *   data/{slug}/venues-full.json  — all published venues (legacy shape)
 *   data/{slug}/venues-lite.json  — featured-on-core subset (legacy shape)
 *
 * See `src/transforms/venues-legacy.ts` for the legacy shape
 * preservation. When the legacy consumers migrate to the new
 * envelope shape, delete the transform + those two file writes.
 *
 * ## Env vars
 *
 *   CONVEX_SITE_URL   e.g. https://<deployment>.convex.site
 *   INTERNAL_CMS_KEY  shared secret (must match Convex env)
 *   SYNC_ONLY_CITY    (optional) restrict to a single city slug
 *   SYNC_INCLUDE_DRAFTS  (optional) "1"|"true" to flip publishable
 *                     routes to live-projection mode. Used on the
 *                     staging (`draft`) branch of this repo.
 *
 * ## Branch discipline
 *
 *   main    → SYNC_INCLUDE_DRAFTS unset → frozen published snapshots
 *             → production consumers rebuild
 *   draft   → SYNC_INCLUDE_DRAFTS=1 → live projection with isDraft flags
 *             → staging consumers rebuild
 *
 * Error policy: per-city + per-collection failures log and continue,
 * so a single broken endpoint never starves the other 11. The run
 * exits 1 if ANY failure was recorded so CI catches regressions.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchSnapshot, rowsOf } from "./convex/client.js";
import { COLLECTIONS } from "./collections.js";
import {
  toLegacyFullVenue,
  toLegacyLiteVenue,
  type ConvexVenueRow,
  type LegacyFullVenue,
  type LegacyLiteVenue,
} from "./transforms/venues-legacy.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT_DIR, "data");
const CITIES_CONFIG = resolve(ROOT_DIR, "cities.json");

// ---------------------------------------------------------------------------
// Cities config
// ---------------------------------------------------------------------------

interface CityConfig {
  slug: string;
  displayName: string;
  active: boolean;
}

interface CitiesConfigFile {
  cities: CityConfig[];
}

async function loadCitiesConfig(): Promise<CityConfig[]> {
  const raw = await readFile(CITIES_CONFIG, "utf8");
  const parsed = JSON.parse(raw) as CitiesConfigFile;
  if (!Array.isArray(parsed.cities)) {
    throw new Error(`cities.json: missing or invalid "cities" array`);
  }
  return parsed.cities;
}

// ---------------------------------------------------------------------------
// JSON output helpers
// ---------------------------------------------------------------------------

async function writeCityJson(
  citySlug: string,
  filename: string,
  payload: unknown,
): Promise<void> {
  const cityDir = resolve(DATA_DIR, citySlug);
  await mkdir(cityDir, { recursive: true });
  const path = resolve(cityDir, filename);
  await writeFile(path, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`    wrote ${path}`);
}

// ---------------------------------------------------------------------------
// Per-city sync
// ---------------------------------------------------------------------------

interface CitySyncResult {
  slug: string;
  collectionsOk: number;
  collectionsFailed: number;
  legacyFullCount: number;
  legacyLiteCount: number;
}

async function syncCity(
  city: CityConfig,
  includeDrafts: boolean,
): Promise<CitySyncResult> {
  console.log(`\n→ ${city.displayName} (${city.slug})`);
  console.log(`  mode: ${includeDrafts ? "draft (live projection)" : "published (frozen)"}`);

  let collectionsOk = 0;
  let collectionsFailed = 0;
  let venuesEnvelope: { rows: ConvexVenueRow[]; raw: unknown } | null = null;

  for (const collection of COLLECTIONS) {
    try {
      console.log(`  → fetching ${collection.slug}`);
      const envelope = await fetchSnapshot(collection.slug, city.slug, {
        includeDrafts: collection.publishable && includeDrafts,
      });
      const rows = rowsOf(envelope, collection.slug);
      console.log(`    ${rows.length} rows`);

      await writeCityJson(city.slug, collection.filename, envelope);
      collectionsOk++;

      // Capture venues for the legacy projection step. We pass the
      // full envelope through and also keep the rows for the legacy
      // transforms.
      if (collection.slug === "venues") {
        venuesEnvelope = {
          rows: rows as ConvexVenueRow[],
          raw: envelope,
        };
      }
    } catch (err) {
      collectionsFailed++;
      console.error(
        `    ✗ ${collection.slug} failed:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // Legacy compat — venues-full.json + venues-lite.json projected from
  // the venues envelope. Skip silently if venues fetch failed
  // (collectionsFailed will already reflect the problem).
  let legacyFullCount = 0;
  let legacyLiteCount = 0;
  if (venuesEnvelope) {
    const legacyFull: LegacyFullVenue[] = [];
    const legacyLite: LegacyLiteVenue[] = [];
    for (const row of venuesEnvelope.rows) {
      try {
        legacyFull.push(toLegacyFullVenue(row));
        const lite = toLegacyLiteVenue(row);
        if (lite) legacyLite.push(lite);
      } catch (err) {
        console.warn(
          `    ! legacy projection failed for ${row.convexId}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
    legacyFullCount = legacyFull.length;
    legacyLiteCount = legacyLite.length;

    const syncedAt = new Date().toISOString();
    await writeCityJson(city.slug, "venues-full.json", {
      syncedAt,
      citySlug: city.slug,
      venues: legacyFull,
    });
    await writeCityJson(city.slug, "venues-lite.json", {
      syncedAt,
      citySlug: city.slug,
      venues: legacyLite,
    });
  } else {
    console.warn(
      `  ! skipping legacy venues-full/venues-lite — venues fetch failed`,
    );
  }

  const okStr = `${collectionsOk}/${COLLECTIONS.length} collections`;
  const legacyStr = venuesEnvelope
    ? `${legacyFullCount} full / ${legacyLiteCount} lite`
    : "(legacy skipped)";
  console.log(
    `  ${collectionsFailed === 0 ? "✓" : "⚠"} ${city.displayName}: ` +
      `${okStr}, legacy: ${legacyStr}`,
  );

  return {
    slug: city.slug,
    collectionsOk,
    collectionsFailed,
    legacyFullCount,
    legacyLiteCount,
  };
}

// ---------------------------------------------------------------------------
// Main: loop over cities
// ---------------------------------------------------------------------------

function parseIncludeDrafts(): boolean {
  const raw = process.env.SYNC_INCLUDE_DRAFTS?.toLowerCase() ?? "";
  return raw === "1" || raw === "true" || raw === "yes";
}

async function main(): Promise<void> {
  console.log("→ loading cities config");
  const allCities = await loadCitiesConfig();
  const activeCities = allCities.filter((c) => c.active);

  console.log(
    `  ${activeCities.length}/${allCities.length} cities active: ` +
      activeCities.map((c) => c.slug).join(", "),
  );

  if (activeCities.length === 0) {
    console.log("  ! no active cities — nothing to sync");
    return;
  }

  const includeDrafts = parseIncludeDrafts();
  if (includeDrafts) {
    console.log("  ! SYNC_INCLUDE_DRAFTS set — draft-branch mode");
  }

  // Optional: filter to a single city via env var (used by
  // workflow_dispatch input to sync only the requested city).
  const onlyCitySlug = process.env.SYNC_ONLY_CITY?.trim();
  const citiesToSync = onlyCitySlug
    ? activeCities.filter((c) => c.slug === onlyCitySlug)
    : activeCities;

  if (onlyCitySlug && citiesToSync.length === 0) {
    throw new Error(
      `SYNC_ONLY_CITY="${onlyCitySlug}" but no matching active city in cities.json`,
    );
  }
  if (onlyCitySlug) {
    console.log(`  ! filtered by SYNC_ONLY_CITY=${onlyCitySlug}`);
  }

  // Sync each city. Don't bail on the first failure — partial success
  // is better than total failure when one city's Convex deployment
  // has a transient hiccup.
  const results: CitySyncResult[] = [];
  const errors: { slug: string; error: string }[] = [];

  for (const city of citiesToSync) {
    try {
      const result = await syncCity(city, includeDrafts);
      results.push(result);
    } catch (err) {
      errors.push({
        slug: city.slug,
        error: err instanceof Error ? err.message : String(err),
      });
      console.error(
        `  ✗ ${city.slug} failed:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // Summary
  console.log("\n→ summary");
  for (const r of results) {
    const mark = r.collectionsFailed === 0 ? "✓" : "⚠";
    console.log(
      `  ${mark} ${r.slug}: ${r.collectionsOk}/${COLLECTIONS.length} collections, ` +
        `legacy ${r.legacyFullCount} full / ${r.legacyLiteCount} lite`,
    );
  }
  for (const e of errors) {
    console.log(`  ✗ ${e.slug}: ${e.error}`);
  }

  const collectionFailures = results.reduce(
    (sum, r) => sum + r.collectionsFailed,
    0,
  );
  if (errors.length > 0 || collectionFailures > 0) {
    console.error(
      `\n✗ sync completed with ${errors.length} city failures ` +
        `and ${collectionFailures} collection failures`,
    );
    process.exit(1);
  }
  console.log("\n✓ all cities synced");
}

main().catch((err) => {
  console.error("✗ sync failed:", err);
  process.exit(1);
});
