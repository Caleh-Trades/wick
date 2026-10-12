import { useEffect, useState } from "react"

import { armTapeBlocked, isTapeStale } from "./stale-tape.ts"
import { pollIntervalMs } from "./runs.ts"
import { useBookView } from "./use-book.ts"
import type { Timeframe, Venue } from "./types.ts"

/** Slow wall clock for aging checks. Book ticks already re-render via useBookView. */
function useSlowNow(ms = 2000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms)
    return () => window.clearInterval(id)
  }, [ms])
  return now
}

/**
 * Local stale/arm gates for one slot. Keeps the tick off the App root so the
 * desk does not re-render every second.
 */
export function useTapeFreshness(
  symbol: string | null,
  venue: Venue,
  timeframe: Timeframe | string,
  candleClock: Date | null,
): { tapeStale: boolean; armBlocked: boolean } {
  const book = useBookView(symbol, venue)
  const now = useSlowNow(2000)
  const grace = Math.max(15_000, pollIntervalMs(timeframe as Timeframe))
  const heard = book.heardAt
  const candle = candleClock?.getTime() ?? null
  return {
    tapeStale: isTapeStale(heard, candle, now, grace),
    armBlocked: armTapeBlocked(heard, candle, now, grace),
  }
}
