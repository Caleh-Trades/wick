/** Book quieter than this badges the slot stale and blocks Arm. */
export const TAPE_STALE_MS = 15_000

/**
 * Stale when the book and the candle stamp are both older than their windows.
 * Book window is 15s. Candle window is at least 15s and should cover the poll
 * interval so a healthy kline refresh does not flash stale between polls.
 * Never-heard does not badge — Arm still blocks until a fresh tick.
 */
export function isTapeStale(
  bookHeardAt: number | null,
  candleStampMs: number | null,
  now = Date.now(),
  candleGraceMs = TAPE_STALE_MS,
): boolean {
  if (bookFresh(bookHeardAt, now) || candleFresh(candleStampMs, now, candleGraceMs)) return false
  return (bookHeardAt ?? 0) > 0 || (candleStampMs ?? 0) > 0
}

/** Arm needs a book tick within 15s or a candle poll inside the grace window. */
export function armTapeBlocked(
  bookHeardAt: number | null,
  candleStampMs: number | null,
  now = Date.now(),
  candleGraceMs = TAPE_STALE_MS,
): boolean {
  return !(bookFresh(bookHeardAt, now) || candleFresh(candleStampMs, now, candleGraceMs))
}

function bookFresh(bookHeardAt: number | null, now: number): boolean {
  return bookHeardAt != null && bookHeardAt > 0 && now - bookHeardAt <= TAPE_STALE_MS
}

function candleFresh(candleStampMs: number | null, now: number, graceMs: number): boolean {
  const grace = Math.max(TAPE_STALE_MS, graceMs)
  return candleStampMs != null && candleStampMs > 0 && now - candleStampMs <= grace
}
