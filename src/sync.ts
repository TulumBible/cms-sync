/**
 * cms-sync entrypoint (multi-city).
 *
 * Fetches the city registry from the events-management Convex
 * deployment (`/cms-snapshot/cities`), iterates over the active
 * cities, pulls every registered collection from the
 * `/cms-snapshot/*` endpoints, and writes per-city JSON files under
 * `data/{slug}/`.
 *
 * ## City discovery
 *
 * The city list lives in Convex (the `cities` table) — activating a
 * region there is the only step needed for it to start syncing. The
 * local `cities.json` is a FALLBACK used only when the
 * `/cms-snapshot/cities` endpoint is unreachable or not yet deployed,
 * so a Convex-side outage can't stop the daily backstop run.
 *
 * ## Output layout
 *
 * `data/cities.json` — the city registry envelope (when fetched from
 * Convex), for downstream consumers that need the region list.
 *
 * Per active city, one JSON file per collection registered in
 * `src/collections.ts` (venues, events, blogs, categories, amenities,
 * authors, faqs, reviews, yachts, villas, legals, transport-routes,
 * transport-vehicles, redirects — see the registry for the current
 * set).
 *
 * The Webflow-era legacy outputs are fully retired (2026-07): first
 * `venues-lite.json` (tulum-core migrated to the new envelope), then
 * `venues-full.json` (concierge migrated). Every consumer now reads
 * the Convex envelope files directly.
 *
 * ## Change detection
 *
 * Files are only rewritten when their content (ignoring the volatile
 * top-level `syncedAt` stamp) actually changed. This keeps no-op cron
 * runs from committing timestamp churn — and from triggering pointless
 * downstream rebuilds. A file's `syncedAt` therefore reflects the last
 * CONTENT change, not the last sync run.
 *
 * ## Env vars
 *
 *   CONVEX_SITE_URL   e.g. https://<deployment>.convex.site
 *   INTERNAL_CMS_KEY  shared secret (must match Convex env)
 *   SYNC_ONLY_CITY    (optional) restrict to a single city slug
 *   SYNC_INCLUDE_DRAFTS  (optional) "1"|"true" to flip publishable
 *                     routes to live-projection mode. Used on the
 *                     staging (`draft`) branch of this repo.
 *   SYNC_ALLOW_SHRINK (optional) "1"|"true" to bypass the mass-
 *                     deletion guard (see src/lib/shrink-guard.ts)
 *                     when a large content removal is intentional.
 *
 * ## Branch discipline
 *
 *   main    → SYNC_INCLUDE_DRAFTS unset → frozen published snapshots
 *             → production consumers rebuild
 *   draft   → SYNC_INCLUDE_DRAFTS=1 → live projection with isDraft flags
 *             → staging consumers rebuild
 *
 * Error policy: per-city + per-collection failures log and continue,
 * so a single broken endpoint never starves the others. The run exits
 * 1 if ANY failure was recorded so CI catches regressions.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchSnapshot, rowsOf } from "./convex/client.js";
import { COLLECTIONS, type CollectionDef } from "./collections.js";
import { sameIgnoringSyncedAt } from "./lib/compare.js";
import { evaluateShrinkGuard } from "./lib/shrink-guard.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT_DIR, "data");
const CITIES_FALLBACK_CONFIG = resolve(ROOT_DIR, "cities.json");

// ---------------------------------------------------------------------------
// City registry — Convex first, local cities.json as fallback
// ---------------------------------------------------------------------------

interface CityConfig {
  slug: string;
  displayName: string;
}

/** Row shape emitted by /cms-snapshot/cities (active cities only). */
interface ConvexCityRow {
  convexId: string;
  slug: string;
  name: string;
  shortName: string | null;
  countryCode: string | null;
  timezone: string | null;
  currency: string | null;
  domainProd: string | null;
  domainStaging: string | null;
  sortOrder: number | null;
}

interface FallbackCitiesFile {
  cities: { slug: string; displayName: string; active: boolean }[];
}

/**
 * Load the active-city list. Primary source is Convex's
 * `/cms-snapshot/cities` (already filtered to active cities); when
 * that fails — endpoint not deployed yet, transient outage — fall
 * back to the local `cities.json` so the run can still proceed.
 *
 * When the Convex fetch succeeds, the registry envelope is also
 * written to `data/cities.json` for downstream consumers.
 */
async function loadCities(): Promise<{
  cities: CityConfig[];
  source: "convex" | "fallback";
}> {
  try {
    const envelope = await fetchSnapshot("cities", null);
    const rows = rowsOf<ConvexCityRow>(envelope, "cities");
    // An empty registry would deactivate every city at once — treat it
    // as an upstream problem (same spirit as the mass-deletion guard)
    // rather than silently syncing nothing / wiping data/cities.json.
    if (rows.length === 0) {
      throw new Error("endpoint returned zero active cities");
    }
    await writeDataJson("cities.json", envelope);
    return {
      cities: rows.map((c) => ({
        slug: c.slug,
        displayName: c.shortName ?? c.name,
      })),
      source: "convex",
    };
  } catch (err) {
    console.warn(
      `  ! /cms-snapshot/cities unavailable (${err instanceof Error ? err.message : err})` +
        ` — falling back to local cities.json`,
    );
    const raw = await readFile(CITIES_FALLBACK_CONFIG, "utf8");
    const parsed = JSON.parse(raw) as FallbackCitiesFile;
    if (!Array.isArray(parsed.cities)) {
      throw new Error(`cities.json: missing or invalid "cities" array`);
    }
    return {
      cities: parsed.cities
        .filter((c) => c.active)
        .map((c) => ({ slug: c.slug, displayName: c.displayName })),
      source: "fallback",
    };
  }
}

// ---------------------------------------------------------------------------
// JSON output helpers
// ---------------------------------------------------------------------------

/**
 * Read + parse the currently committed file at `path`, or `undefined`
 * when it's missing or unparsable (first sync of a city). Read once
 * per file and reused for BOTH the mass-deletion guard (row count) and
 * change detection (deep compare), so the file is never parsed twice.
 */
async function readExistingJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Row count for `key` in an already-read envelope, or null when the
 * file was missing/unparsable. Feeds the mass-deletion guard.
 */
function rowCountOf(existing: unknown | undefined, key: string): number | null {
  if (!existing || typeof existing !== "object") return null;
  const rows = (existing as Record<string, unknown>)[key];
  return Array.isArray(rows) ? rows.length : null;
}

/**
 * Write `payload` to `path` unless `existing` already holds the same
 * content (ignoring `syncedAt`). Skipping the write keeps no-op sync
 * runs from producing timestamp-only git churn — no commit, no
 * downstream rebuild trigger. `existing` is passed in (not re-read)
 * so a caller that already read the file for the guard doesn't parse
 * it a second time.
 *
 * Returns true when the file was (re)written.
 */
async function writeJsonIfChanged(
  path: string,
  payload: unknown,
  existing: unknown | undefined,
): Promise<boolean> {
  if (existing !== undefined && sameIgnoringSyncedAt(existing, payload)) {
    return false;
  }
  await writeFile(path, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return true;
}

async function writeDataJson(
  filename: string,
  payload: unknown,
): Promise<boolean> {
  await mkdir(DATA_DIR, { recursive: true });
  const path = resolve(DATA_DIR, filename);
  return writeJsonIfChanged(path, payload, await readExistingJson(path));
}

// ---------------------------------------------------------------------------
// Per-city sync
// ---------------------------------------------------------------------------

interface CollectionResult {
  def: CollectionDef;
  ok: boolean;
  rowCount: number;
  written: boolean;
  error?: string;
}

interface CitySyncResult {
  slug: string;
  collectionsOk: number;
  collectionsFailed: number;
  filesWritten: number;
}

/**
 * Fetch + write one collection. Self-contained so all collections of
 * a city can run concurrently — failures are captured per-collection,
 * never thrown, matching the old sequential error policy.
 */
async function syncCollection(
  collection: CollectionDef,
  citySlug: string,
  includeDrafts: boolean,
  allowShrink: boolean,
): Promise<CollectionResult> {
  try {
    const envelope = await fetchSnapshot(collection.slug, citySlug, {
      includeDrafts: collection.publishable && includeDrafts,
    });
    const rows = rowsOf(envelope, collection.slug);

    const cityDir = resolve(DATA_DIR, citySlug);
    await mkdir(cityDir, { recursive: true });
    const path = resolve(cityDir, collection.filename);
    // Read the committed file ONCE — reused for the guard's row count
    // and the change-detection compare below.
    const existing = await readExistingJson(path);

    // Mass-deletion guard — a wiped or >80%-shrunk collection is more
    // likely a CMS accident than an editorial decision, and this
    // pipeline propagates to every consumer within seconds. Keep the
    // previously committed file and fail the run instead; re-run with
    // SYNC_ALLOW_SHRINK=1 (allowShrink input) when it's intentional.
    if (!allowShrink) {
      const prevCount = rowCountOf(existing, collection.slug);
      const verdict = evaluateShrinkGuard(prevCount, rows.length);
      if (verdict.blocked) {
        return {
          def: collection,
          ok: false,
          rowCount: rows.length,
          written: false,
          error:
            `${verdict.reason} — previous file kept. ` +
            `Re-run with allowShrink if this removal is intentional.`,
        };
      }
    }

    const written = await writeJsonIfChanged(path, envelope, existing);
    return {
      def: collection,
      ok: true,
      rowCount: rows.length,
      written,
    };
  } catch (err) {
    return {
      def: collection,
      ok: false,
      rowCount: 0,
      written: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function syncCity(
  city: CityConfig,
  includeDrafts: boolean,
  allowShrink: boolean,
): Promise<CitySyncResult> {
  console.log(`\n→ ${city.displayName} (${city.slug})`);
  console.log(`  mode: ${includeDrafts ? "draft (live projection)" : "published (frozen)"}`);

  // All collections fetch + write concurrently — they're independent
  // HTTP endpoints writing independent files, so wall-clock drops to
  // roughly the slowest single fetch instead of the sum of all.
  const results = await Promise.all(
    COLLECTIONS.map((collection) =>
      syncCollection(collection, city.slug, includeDrafts, allowShrink),
    ),
  );

  let collectionsOk = 0;
  let collectionsFailed = 0;
  let filesWritten = 0;

  for (const result of results) {
    if (result.ok) {
      collectionsOk++;
      if (result.written) filesWritten++;
      console.log(
        `  ✓ ${result.def.slug}: ${result.rowCount} rows` +
          (result.written ? "" : " (unchanged)"),
      );
    } else {
      collectionsFailed++;
      console.error(`  ✗ ${result.def.slug} failed: ${result.error}`);
    }
  }

  console.log(
    `  ${collectionsFailed === 0 ? "✓" : "⚠"} ${city.displayName}: ` +
      `${collectionsOk}/${COLLECTIONS.length} collections, ` +
      `${filesWritten} file(s) changed`,
  );

  return {
    slug: city.slug,
    collectionsOk,
    collectionsFailed,
    filesWritten,
  };
}

// ---------------------------------------------------------------------------
// Main: loop over cities
// ---------------------------------------------------------------------------

function parseBoolEnv(name: string): boolean {
  const raw = process.env[name]?.toLowerCase() ?? "";
  return raw === "1" || raw === "true" || raw === "yes";
}

async function main(): Promise<void> {
  console.log("→ loading city registry");
  const { cities, source } = await loadCities();

  console.log(
    `  ${cities.length} active cities (${source}): ` +
      cities.map((c) => c.slug).join(", "),
  );

  if (cities.length === 0) {
    console.log("  ! no active cities — nothing to sync");
    return;
  }

  const includeDrafts = parseBoolEnv("SYNC_INCLUDE_DRAFTS");
  if (includeDrafts) {
    console.log("  ! SYNC_INCLUDE_DRAFTS set — draft-branch mode");
  }

  const allowShrink = parseBoolEnv("SYNC_ALLOW_SHRINK");
  if (allowShrink) {
    console.log("  ! SYNC_ALLOW_SHRINK set — mass-deletion guard bypassed");
  }

  // Optional: filter to a single city via env var (used by
  // workflow_dispatch input to sync only the requested city).
  const onlyCitySlug = process.env.SYNC_ONLY_CITY?.trim();
  const citiesToSync = onlyCitySlug
    ? cities.filter((c) => c.slug === onlyCitySlug)
    : cities;

  if (onlyCitySlug && citiesToSync.length === 0) {
    throw new Error(
      `SYNC_ONLY_CITY="${onlyCitySlug}" but no matching active city in the registry`,
    );
  }
  if (onlyCitySlug) {
    console.log(`  ! filtered by SYNC_ONLY_CITY=${onlyCitySlug}`);
  }

  // Sync each city. Don't bail on the first failure — partial success
  // is better than total failure when one city's content has a
  // transient hiccup. Cities run sequentially (the per-city collection
  // fan-out is already parallel; stacking cities on top would multiply
  // concurrent load on Convex for little wall-clock gain at this
  // city count).
  const results: CitySyncResult[] = [];
  const errors: { slug: string; error: string }[] = [];

  for (const city of citiesToSync) {
    try {
      const result = await syncCity(city, includeDrafts, allowShrink);
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
        `${r.filesWritten} file(s) changed`,
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
