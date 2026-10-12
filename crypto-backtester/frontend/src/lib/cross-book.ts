import { DEFAULT_CROSS_SYMBOLS } from "./symbol-set.ts"
import type { MarketId, Run, Venue } from "./types.ts"

/** @deprecated Prefer workspace.crossSymbols. Kept for older imports and tests. */
export const CROSS_SYMBOLS = DEFAULT_CROSS_SYMBOLS

/** The active rule on one book. Spot cannot short. Perp keeps the run's short switch, on Kraken. */
export function crossBookRun(run: Run, symbol: MarketId, venue: Venue): Run {
  return {
    ...run,
    symbol,
    allowShort: venue === "perp" && run.allowShort,
  }
}
