/** Book or candle stamp older than this badges the slot stale and blocks Arm. */
export const TAPE_STALE_MS = 15_000

/**
 * Stale when neither the book nor the candle stamp has ticked within 15s.
 * A fresh book print or candle poll clears it.
 */
export function isTapeStale(
  bookHeardAt: number | null,
  candleStampMs: number | null,
  now = Date.now(),
): boolean {
  const latest = Math.max(bookHeardAt ?? 0, candleStampMs ?? 0)
  if (latest <= 0) return true
  return now - latest > TAPE_STALE_MS
}
