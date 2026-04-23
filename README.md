# cms-sync

Serves every Core market — Tulum, Cabos, Mykonos, etc. Add new cities by editing `cities.json`.

Standalone **Convex → JSON sync** for the Core hospitality network. Polls the `events-management` Convex deployment's `/cms-snapshot/*` HTTP endpoints, writes per-city JSON files into `data/{slug}/`, and commits them back to this repo. Downstream apps (`tulum-bible-astro`, `tb-ai-concierge`, `tulum-core`) read those committed JSON files directly from GitHub.

**Migrated from Webflow to Convex** — the `events-management` repo is now the editorial source of truth. The output JSON shapes for `venues-lite.json` and `venues-full.json` are preserved byte-compatible for legacy consumers; everything else is new additive output.

## Why a separate repo

Zero coupling to the main stacks. It only needs:
- A URL for the Convex HTTP host (`.convex.site`)
- A shared secret for auth
- GitHub permissions to push commits back to itself

Runs on a GitHub Actions cron and commits its output. Consumers fetch the raw JSON from GitHub or add this repo as a git submodule.

## Data flow

```
events-management (Convex)
   │   HTTP GET /cms-snapshot/*  (x-internal-cms-key header)
   ▼
cms-sync  (this repo — GitHub Actions cron)
   │   writes JSON → commits to GitHub
   ▼
data/{city}/*.json on GitHub
   ▼
Downstream consumers:
   - tulum-bible-astro  (reads all 12 collections)
   - tb-ai-concierge    (reads venues-lite.json + venues-full.json, legacy shape)
   - tulum-core         (reads venues-lite.json + venues-full.json, legacy shape)
```

The HTTP contract the Convex side exposes is documented in [`events-management/convex/SNAPSHOT_CONTRACT.md`](https://github.com/CerkaB/events-management/blob/main/convex/SNAPSHOT_CONTRACT.md).

## Multi-city architecture

Each city is listed in `cities.json` with a slug the Convex deployment also knows about:

```json
{
  "cities": [
    { "slug": "tulum", "displayName": "Tulum", "active": true },
    { "slug": "los-cabos", "displayName": "Los Cabos", "active": false }
  ]
}
```

Each run iterates over the **active** cities, fetches every registered collection from Convex for that city, and writes:

```
data/
├── tulum/
│   ├── venues.json            # NEW — Convex envelope passthrough
│   ├── events.json            # NEW
│   ├── blogs.json             # NEW
│   ├── categories.json        # NEW
│   ├── amenities.json         # NEW
│   ├── authors.json           # NEW
│   ├── faqs.json              # NEW
│   ├── reviews.json           # NEW
│   ├── yachts.json            # NEW
│   ├── villas.json            # NEW
│   ├── legals.json            # NEW
│   ├── redirects.json         # NEW
│   ├── venues-full.json       # LEGACY — preserved for concierge + core-tulum
│   └── venues-lite.json       # LEGACY — preserved for concierge + core-tulum
└── los-cabos/
    └── … (same set when active: true)
```

Adding a new city = add a row to `cities.json` with `active: true` AND ensure the city exists in the `events-management` cities table with content scoped to it. No code changes needed.

## Required env vars

| Variable            | Description                                                                           |
| ------------------- | ------------------------------------------------------------------------------------- |
| `CONVEX_SITE_URL`   | e.g. `https://<deployment>.convex.site`. The **`.site`** host, NOT `.cloud`.           |
| `INTERNAL_CMS_KEY`  | Shared secret — must match Convex's `INTERNAL_CMS_KEY` env var. Rotate both together. |

Optional:

| Variable                | Description                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| `SYNC_ONLY_CITY`        | Restrict to a single city slug (as defined in `cities.json`). Used by manual dispatch.                     |
| `SYNC_INCLUDE_DRAFTS`   | Set to `"1"` on the `draft` branch to fetch publishable routes with `?drafts=1` (live projection).         |

For local runs, copy `.env.example` to `.env.local` and fill in values. For the GitHub Action, add `CONVEX_SITE_URL` and `INTERNAL_CMS_KEY` as repository secrets.

## Branch discipline

| Branch  | `SYNC_INCLUDE_DRAFTS` | Convex mode returned           | Consumers                              |
| ------- | --------------------- | ------------------------------- | -------------------------------------- |
| `main`  | unset                 | Frozen published snapshots      | Production Astro + concierge + core    |
| `draft` | `"1"`                 | Live projection w/ `isDraft`    | Staging Astro (staging.tulumbible.com) |

Set up two workflow runs — one on each branch — or use a single workflow with branch-aware env wiring. The current `.github/workflows/sync.yml` uses `workflow_dispatch` input for manual draft-mode runs; wire up a cron on the `draft` branch when staging comes online.

## Run locally

```bash
pnpm install

# Sync every active city in cities.json (published-only):
pnpm sync

# Sync just one city:
SYNC_ONLY_CITY=tulum pnpm sync

# Draft-mode sync (live projection, isDraft flags):
SYNC_INCLUDE_DRAFTS=1 pnpm sync
```

Outputs land in `data/{slug}/*.json`.

## Manually trigger the GitHub Action

```bash
# Sync every active city (published mode)
gh workflow run sync.yml

# Sync just one city
gh workflow run sync.yml -f citySlug=tulum

# Draft-mode sync
gh workflow run sync.yml -f includeDrafts=true
```

The workflow also runs daily at 07:00 UTC via cron.

## Output schemas

### Convex envelope (new — all 12 files)

Every `/cms-snapshot/*` file uses the same envelope:

```ts
{
  syncedAt: string;           // ISO-8601 timestamp, fresh per fetch
  citySlug: string;           // echoes ?city=
  [collection]: Row[];        // key matches URL slug + filename
  mode?: "published" | "draft"; // publishable routes only
}
```

Row shapes per collection are documented in [`events-management/convex/publish/snapshots.ts`](https://github.com/CerkaB/events-management/blob/main/convex/publish/snapshots.ts) — every row follows `{ convexId, base, locales: { en, es } }`.

### Legacy — `venues-lite.json` + `venues-full.json`

Preserved byte-compatible from the Webflow era for `tb-ai-concierge` and `tulum-core`. See `src/transforms/venues-legacy.ts` for the exact shape definitions and filter logic.

`venues-lite.json` — featured-on-core subset, closed venues excluded:

```ts
{
  syncedAt: string;
  citySlug: string;
  venues: Array<{
    slug: string;
    category: string | null;
    area: string | null;
    pricing: string | null;
    coverImage: string | null;
    isClosed: boolean;          // always false (closed venues filtered out)
    tulumBibleSlug: string;     // === slug
    openingHours: string | null; // HTML stripped, one line per day
    locales: {
      en: { name: string; description: string };
      es: { name: string; description: string };
    };
  }>;
}
```

`venues-full.json` — every published venue with all legacy fields:

```ts
{
  syncedAt: string;
  citySlug: string;
  venues: Array<{
    webflowItemId: string;      // now holds the Convex row _id, field name preserved for compat
    base: { slug, category, area, pricing, coverImage, imageUrls,
            isClosed, isFeatured, isFeaturedOnCoreTulum,
            googleMapsCode, foodMenuUrl, drinkMenuUrl, openingHoursHtml };
    locales: {
      en: { name, description, body, address, feesHtml };
      es: { name, description, body, address, feesHtml };
    };
    lastPublished?: string;     // falls back to lastUpdated when no publish stamp
    lastUpdated?: string;
  }>;
}
```

## Repo layout

```
cities.json                  Multi-city config — one row per market
src/
├── convex/
│   └── client.ts             fetchSnapshot + rowsOf — HTTP client for /cms-snapshot/*
├── transforms/
│   └── venues-legacy.ts      Convex venue → legacy venues-full + venues-lite shapes
├── collections.ts            Registry of collections to sync (slug + publishable flag)
└── sync.ts                   Entrypoint — loops cities × collections
data/
├── tulum/                    Per-city JSON (committed by GitHub Action)
│   ├── venues.json           new — Convex envelope
│   ├── events.json           new
│   ├── ... (9 more)
│   ├── venues-full.json      legacy shape
│   └── venues-lite.json      legacy shape
.github/workflows/
└── sync.yml                  Daily cron + workflow_dispatch with citySlug + includeDrafts inputs
```

## Roadmap

- ✅ Single-city sync (Tulum)
- ✅ Multi-city refactor (cities.json + per-city data folders)
- ✅ Webflow → Convex source migration (this PR)
- ✅ Expanded to 12 collections (events, blogs, authors, etc.)
- ⏳ `draft` branch wiring for staging Astro preview
- ⏳ Add second city (Los Cabos) — requires content in events-management first
- ⏳ Migrate `tb-ai-concierge` + `tulum-core` to read new `venues.json` shape, then retire the legacy `venues-full` + `venues-lite` outputs
