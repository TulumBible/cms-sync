# cms-sync

Serves every Core market — Tulum, Cabos, Mykonos, etc. Cities are managed in the CMS (Convex `cities` table); activating a region there is all it takes to start syncing it.

Standalone **Convex → JSON sync** for the Core hospitality network. Polls the `events-management` Convex deployment's `/cms-snapshot/*` HTTP endpoints, writes per-city JSON files into `data/{slug}/`, and commits them back to this repo. Downstream apps (`tulum-bible-astro`, `tb-ai-concierge`, `tulum-core`) read those committed JSON files directly from GitHub.

**Migrated from Webflow to Convex** — the `events-management` repo is the editorial source of truth. All output uses the Convex envelope shape; the Webflow-era legacy files (`venues-lite.json`, `venues-full.json`) were retired in 2026-07 once tulum-core and the concierge migrated to `venues.json`.

## Why a separate repo

Zero coupling to the main stacks. It only needs:
- A URL for the Convex HTTP host (`.convex.site`)
- A shared secret for auth
- GitHub permissions to push commits back to itself

Runs on a GitHub Actions cron (daily backstop) and on `workflow_dispatch` triggers fired by the CMS on every publish/unpublish. Consumers fetch the raw JSON from GitHub.

## Data flow

```
events-management (Convex)
   │   HTTP GET /cms-snapshot/cities      (city registry)
   │   HTTP GET /cms-snapshot/*?city=…    (x-internal-cms-key header)
   ▼
cms-sync  (this repo — GitHub Actions)
   │   writes JSON → commits to GitHub (only when content changed)
   ▼
data/{city}/*.json on GitHub
   ▼
Downstream consumers:
   - tulum-bible-astro  (reads all collections)
   - tulum-core         (reads venues.json)
   - tb-ai-concierge    (reads venues, events, faqs, reviews, blogs, villas, yachts)
```

The HTTP contract the Convex side exposes is documented in [`cms/convex/SNAPSHOT_CONTRACT.md`](https://github.com/TulumBible/cms/blob/main/convex/SNAPSHOT_CONTRACT.md).

## Multi-city architecture

The city registry lives in the Convex `cities` table and is fetched at the start of every run via `/cms-snapshot/cities` (active cities only). The local [`cities.json`](cities.json) is a **fallback** used only when that endpoint is unreachable, so a Convex outage can't stop the daily backstop run.

**Adding a new city** = create it in the CMS admin with `isActive: true` and scope content to it. No change in this repo needed. (Optionally mirror it into `cities.json` so the fallback stays current.)

Each run iterates over the active cities, fetches every registered collection for that city, and writes:

```
data/
├── cities.json                # City registry envelope (from Convex)
├── tulum/
│   ├── venues.json            # Convex envelope passthrough
│   ├── events.json
│   ├── blogs.json
│   ├── categories.json
│   ├── amenities.json
│   ├── authors.json
│   ├── faqs.json
│   ├── reviews.json
│   ├── yachts.json
│   ├── villas.json
│   ├── legals.json
│   ├── transport-routes.json
│   ├── transport-vehicles.json
│   └── redirects.json
└── los-cabos/
    └── … (same set once active in the CMS)
```

Files are only rewritten (and therefore committed) when their content actually changed — the volatile `syncedAt` stamp is ignored during comparison, so no-op runs produce no commits and no downstream rebuilds. A file's `syncedAt` reflects the last **content** change.

**Mass-deletion guard**: because commits propagate to every consumer within seconds, a collection that suddenly comes back empty (had ≥ 3 rows) or loses more than 80% of its rows (had ≥ 10) is treated as an upstream accident — the previous file is kept and the run fails so the CMS admin shows red. If the removal is intentional, re-run the workflow with the `allowShrink` input checked. See [`src/lib/shrink-guard.ts`](src/lib/shrink-guard.ts).

## Required env vars

| Variable            | Description                                                                           |
| ------------------- | ------------------------------------------------------------------------------------- |
| `CONVEX_SITE_URL`   | e.g. `https://<deployment>.convex.site`. The **`.site`** host, NOT `.cloud`.           |
| `INTERNAL_CMS_KEY`  | Shared secret — must match Convex's `INTERNAL_CMS_KEY` env var. Rotate both together. |

Optional:

| Variable                | Description                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| `SYNC_ONLY_CITY`        | Restrict to a single city slug. Used by manual dispatch.                                                    |
| `SYNC_INCLUDE_DRAFTS`   | Set to `"1"` on the `draft` branch to fetch publishable routes with `?drafts=1` (live projection).         |
| `SYNC_ALLOW_SHRINK`     | Set to `"1"` to bypass the mass-deletion guard when a large content removal is intentional.                 |

For local runs, copy `.env.example` to `.env.local` and fill in values. For the GitHub Action, add `CONVEX_SITE_URL` and `INTERNAL_CMS_KEY` as repository secrets.

## Branch discipline

| Branch  | `SYNC_INCLUDE_DRAFTS` | Convex mode returned           | Consumers                              |
| ------- | --------------------- | ------------------------------- | -------------------------------------- |
| `main`  | unset                 | Frozen published snapshots      | Production Astro + concierge + core    |
| `draft` | `"1"`                 | Live projection w/ `isDraft`    | Staging Astro (staging.tulumbible.com) |

The workflow **refuses** `includeDrafts=true` on any branch except `draft` — this repo is public, and draft mode would commit unpublished content where the world (and production consumers) can read it.

> ⚠️ Before wiring up the `draft` branch: unpublished drafts on a **public** repo are world-readable. Make the repo private, or point draft output somewhere access-controlled.

## Run locally

```bash
pnpm install

# Sync every active city (published-only):
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

# Draft-mode sync (only allowed on the draft branch)
gh workflow run sync.yml --ref draft -f includeDrafts=true
```

The workflow also runs daily at 07:00 UTC via cron as a backstop; fast propagation comes from the CMS firing a `workflow_dispatch` on every publish/unpublish.

## Output schemas

### Convex envelope (all collection files)

Every `/cms-snapshot/*` file uses the same envelope:

```ts
{
  syncedAt: string;           // ISO-8601 — last CONTENT change, not last run
  citySlug: string;           // echoes ?city=
  [collection]: Row[];        // key matches URL slug + filename
  mode?: "published" | "draft"; // publishable routes only
}
```

Row shapes per collection are documented in [`cms/convex/publish/snapshots.ts`](https://github.com/TulumBible/cms/blob/main/convex/publish/snapshots.ts) — every row follows `{ convexId, base, locales: { en, es } }`.

### `data/cities.json`

```ts
{
  syncedAt: string;
  cities: Array<{
    convexId: string;
    slug: string;              // "tulum"
    name: string;              // "Tulum Bible"
    shortName: string | null;  // "Tulum"
    countryCode: string | null;
    timezone: string | null;
    currency: string | null;
    domainProd: string | null;
    domainStaging: string | null;
    sortOrder: number | null;
  }>;
}
```

## Repo layout

```
cities.json                   FALLBACK city registry (primary lives in Convex)
cities.schema.json            JSON Schema for the fallback file
src/
├── convex/
│   └── client.ts             fetchSnapshot + rowsOf — HTTP client for /cms-snapshot/*
├── lib/
│   ├── compare.ts            Change detection (syncedAt-insensitive envelope compare)
│   └── shrink-guard.ts       Mass-deletion guard (wipe / >80% shrink protection)
├── collections.ts            Registry of collections to sync (slug + publishable flag)
└── sync.ts                   Entrypoint — city registry → parallel collection fan-out
data/
├── cities.json               City registry envelope (committed by GitHub Action)
├── tulum/                    Per-city JSON (committed by GitHub Action)
.github/workflows/
└── sync.yml                  Daily cron backstop + workflow_dispatch (citySlug, includeDrafts)
```

## Roadmap

- ✅ Single-city sync (Tulum)
- ✅ Multi-city refactor (per-city data folders)
- ✅ Webflow → Convex source migration
- ✅ Expanded to 14 collections (events, blogs, authors, transport, etc.)
- ✅ Dynamic city registry from Convex (`/cms-snapshot/cities`, 2026-07)
- ✅ Change-detected writes — no more timestamp-churn commits (2026-07)
- ✅ Retired the legacy Webflow-era outputs — `venues-lite.json` (tulum-core migrated), then `venues-full.json` + the transform (concierge migrated)
- ⏳ `draft` branch wiring for staging Astro preview — **repo must go private first** (see Branch discipline)
- ⏳ Add second city (Los Cabos) — activate in the CMS once content is scoped
