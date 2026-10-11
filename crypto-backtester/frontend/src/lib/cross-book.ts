import type { MarketId, Run, Venue } from "./types.ts"

export const CROSS_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"] as const

/** The active rule on one of the three books. Spot cannot short. Perp keeps the run's short switch, on Kraken. */
export function crossBookRun(run: Run, symbol: MarketId, venue: Venue): Run {
  return {
    ...run,
    symbol,
    allowShort: venue === "perp" && run.allowShort,
  }
}
