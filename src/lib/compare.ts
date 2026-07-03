/**
 * Envelope comparison for change-detected writes.
 *
 * Kept in its own module (rather than inline in sync.ts) so it can be
 * unit-tested without importing the entrypoint, which runs main() on
 * import.
 */

/**
 * Compare two parsed envelopes ignoring the volatile top-level
 * `syncedAt` stamp. Key order is stable for unchanged content (both
 * sides originate from the same serializer), so string comparison of
 * the stripped objects is sufficient and cheap.
 */
export function sameIgnoringSyncedAt(a: unknown, b: unknown): boolean {
  const strip = (v: unknown): unknown => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const { syncedAt: _ignored, ...rest } = v as Record<string, unknown>;
      return rest;
    }
    return v;
  };
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}
