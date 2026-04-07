import type { WebflowClient } from "webflow-api";

export interface LocaleInfo {
  cmsLocaleId: string;
  tag: string; // e.g. "en-US", "es-ES"
  displayName: string;
}

export interface LocaleMap {
  primary: LocaleInfo;
  secondary: LocaleInfo[];
  /** cmsLocaleId → normalized tag ("en" | "es") */
  byCmsLocaleId: Record<string, string>;
  /** normalized tag → cmsLocaleId */
  byTag: Record<string, string>;
}

/** Normalize "en-US" → "en", "es-MX" → "es" */
export function normalizeLocaleTag(tag: string): string {
  return tag.split("-")[0].toLowerCase();
}

/**
 * Discover locale configuration from the Webflow site.
 * Returns primary + secondary locales with their cmsLocaleIds.
 */
export async function discoverLocales(
  client: WebflowClient,
  siteId: string,
): Promise<LocaleMap> {
  const site = await client.sites.get(siteId);

  // The SDK types may not fully cover locales — use type assertion
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const locales = (site as any).locales;

  if (!locales?.primary) {
    // Site may not have localization enabled — treat as single-locale
    return {
      primary: { cmsLocaleId: "default", tag: "en", displayName: "English" },
      secondary: [],
      byCmsLocaleId: { default: "en" },
      byTag: { en: "default" },
    };
  }

  const primary: LocaleInfo = {
    cmsLocaleId: locales.primary.cmsLocaleId ?? "",
    tag: locales.primary.tag ?? "en",
    displayName:
      locales.primary.displayName ?? locales.primary.tag ?? "English",
  };

  const secondary: LocaleInfo[] = (locales.secondary ?? []).map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (loc: any) => ({
      cmsLocaleId: loc.cmsLocaleId ?? "",
      tag: loc.tag ?? "",
      displayName: loc.displayName ?? loc.tag ?? "",
    }),
  );

  const byCmsLocaleId: Record<string, string> = {};
  const byTag: Record<string, string> = {};

  const primaryTag = normalizeLocaleTag(primary.tag);
  if (primary.cmsLocaleId) {
    byCmsLocaleId[primary.cmsLocaleId] = primaryTag;
  }
  byTag[primaryTag] = primary.cmsLocaleId;

  for (const loc of secondary) {
    const tag = normalizeLocaleTag(loc.tag);
    if (loc.cmsLocaleId) {
      byCmsLocaleId[loc.cmsLocaleId] = tag;
    }
    byTag[tag] = loc.cmsLocaleId;
  }

  return { primary, secondary, byCmsLocaleId, byTag };
}
