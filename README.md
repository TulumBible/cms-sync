# tulum-cms-sync

Standalone Webflow → JSON sync for [tulumbible.com](https://tulumbible.com) venues. Pulls the venues collection from Webflow CMS, normalizes it, and writes two JSON files into `data/` that downstream sites (`core-tulum`) can consume directly from this repo.

## Why a separate repo

This repo intentionally has zero coupling to the main concierge stack. It only needs a Webflow API token and a site ID, runs on a GitHub Actions cron, and commits its output back to itself. Consumers fetch the raw JSON from GitHub.

## Required env vars

| Variable | Description |
| --- | --- |
| `WEBFLOW_API_TOKEN` | Webflow Data API token with read access to the site |
| `WEBFLOW_SITE_ID` | Webflow site ID |

For local runs, copy `.env.example` to `.env` and fill in values. For the GitHub Action, add both as repository secrets.

## Run locally

```bash
pnpm install
# export WEBFLOW_API_TOKEN=...; export WEBFLOW_SITE_ID=...
pnpm sync
```

Outputs land in `data/venues-lite.json` and `data/venues-full.json`.

## Manually trigger the GitHub Action

```bash
gh workflow run sync.yml
```

The workflow also runs daily at 07:00 UTC via cron.

## Output schema

### `data/venues-lite.json`

The trimmed, public-facing payload consumed by core-tulum. Only includes venues where `featured-on-core-tulum === true` and which are not draft/archived.

```ts
{
  syncedAt: string;            // ISO timestamp
  venues: Array<{
    slug: string;
    category: string;          // restaurant | bar | beach_club | nightclub | cenote | lagoon | other
    coverImage: string | null;
    priceRange: string | null;
    openingHours: Record<string, string> | null;
    tulumBibleSlug: string;    // = slug, used to build outbound URL
    locales: {
      en: { name: string; tagline: string; neighborhood: string };
      es: { name: string; tagline: string; neighborhood: string };
    };
  }>;
}
```

### `data/venues-full.json`

The full normalized corpus — every non-draft, non-archived venue with all fields the transforms know how to extract. Used for debugging and as the source of truth for any future downstream consumer.

## Repo layout

```
src/
├── webflow/
│   ├── client.ts        Webflow SDK client + env helpers
│   ├── locales.ts       discoverLocales, normalizeLocaleTag
│   └── collections.ts   discoverCollections, fetchAllItems, ...
├── transforms/
│   └── venues.ts        venue field mapping + mergeLocaleItems
├── lite.ts              toLiteVenue + filter logic
└── sync.ts              entrypoint
```

## Roadmap

- **Batch 1 (this repo):** sync script + GitHub Action ✅
- **Batch 2:** confirm Webflow schema (`featured-on-core-tulum`, `tagline`, `neighborhood`, `cover-image`, `opening-hours`, `price-range` slugs) and run the first real sync
- **Batch 3:** webhook receiver so Webflow item-changed events trigger the action without waiting for the daily cron
- **Batch 4:** wire `core-tulum` to fetch `venues-lite.json` from this repo at build time
