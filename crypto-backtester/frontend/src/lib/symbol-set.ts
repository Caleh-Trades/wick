import type { MarketId } from "./types.ts"

/** Shared cap for Cross-book and Correlation lists. */
export const SYMBOL_SET_CAP = 12

export const DEFAULT_CROSS_SYMBOLS: MarketId[] = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]

export const DEFAULT_CORRELATION_SYMBOLS: MarketId[] = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT"]

export function asMarketId(value: unknown): MarketId | null {
  if (typeof value !== "string") return null
  const symbol = value.trim().toUpperCase()
  if (!symbol.endsWith("USDT") || symbol.length < 6) return null
  return symbol as MarketId
}

/** Unique USDT markets, capped. Empty input falls back to the defaults. */
export function sanitizeSymbolSet(value: unknown, fallback: readonly MarketId[]): MarketId[] {
  const listed = Array.isArray(value) ? value.map(asMarketId).filter((item): item is MarketId => item != null) : []
  const unique = [...new Set(listed)].slice(0, SYMBOL_SET_CAP)
  if (unique.length === 0) return [...fallback]
  return unique
}

export function addSymbol(set: readonly MarketId[], next: string, cap = SYMBOL_SET_CAP): MarketId[] {
  const symbol = asMarketId(next)
  if (!symbol) return [...set]
  if (set.includes(symbol)) return [...set]
  if (set.length >= cap) return [...set]
  return [...set, symbol]
}

export function removeSymbol(set: readonly MarketId[], symbol: string): MarketId[] {
  return set.filter((item) => item !== symbol)
}
