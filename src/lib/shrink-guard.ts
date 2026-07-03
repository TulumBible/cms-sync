/**
 * Mass-deletion guard.
 *
 * This pipeline auto-commits whatever Convex returns, and downstream
 * (Astro, concierge, core) picks it up within seconds. A CMS bug or an
 * accidental bulk-unpublish would therefore wipe public data almost
 * instantly. This guard blocks the two suspicious shapes of that
 * accident while letting normal editorial shrinkage through:
 *
 *   - WIPE:   a collection that had >= 3 rows comes back EMPTY
 *   - SHRINK: a collection that had >= 10 rows loses more than 80%
 *
 * Small collections (< 3 rows) can legitimately empty out (e.g. the
 * only yacht gets unpublished), so they're never blocked. Intentional
 * mass-removals are unblocked by re-running with SYNC_ALLOW_SHRINK=1
 * (the `allowShrink` workflow_dispatch input).
 *
 * A blocked collection is reported as a sync FAILURE (run exits 1,
 * CMS admin shows red) and the previously committed file stays as-is.
 */

/** A collection this small may legitimately empty out — never block. */
const WIPE_MIN_PREVIOUS_ROWS = 3;
/** Only collections at least this big get the percentage check. */
const SHRINK_MIN_PREVIOUS_ROWS = 10;
/** Block when fewer than this fraction of previous rows survive. */
const SHRINK_KEEP_RATIO = 0.2;

export interface ShrinkVerdict {
  blocked: boolean;
  reason?: string;
}

/**
 * @param prevCount row count in the previously committed file, or
 *   null when there is no previous file (first sync of a city) or it
 *   couldn't be parsed — never blocked.
 * @param nextCount row count the endpoint just returned.
 */
export function evaluateShrinkGuard(
  prevCount: number | null,
  nextCount: number,
): ShrinkVerdict {
  if (prevCount === null) return { blocked: false };

  if (nextCount === 0 && prevCount >= WIPE_MIN_PREVIOUS_ROWS) {
    return {
      blocked: true,
      reason: `refusing to wipe: ${prevCount} rows -> 0`,
    };
  }

  if (
    prevCount >= SHRINK_MIN_PREVIOUS_ROWS &&
    nextCount < prevCount * SHRINK_KEEP_RATIO
  ) {
    return {
      blocked: true,
      reason: `refusing to shrink >80%: ${prevCount} rows -> ${nextCount}`,
    };
  }

  return { blocked: false };
}
