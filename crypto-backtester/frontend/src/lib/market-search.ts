const CRYPTO_ENDING_B = new Set(["ARB", "BB", "BEB", "BNB", "CKB", "DGB", "MUB", "SHIB", "TRB", "YB", "ZMB"])

export type SearchRow = {
  id: string
  base: string
  name?: string
}

/** Leveraged tokens are an existing coin plus UP, DOWN, BULL, or BEAR. JUP and SYRUP stay. */
export function isLeveragedToken(base: string, bases: ReadonlySet<string>): boolean {
  const match = /^(.*)(UP|DOWN|BULL|BEAR)$/.exec(base)
  if (!match) return false
  const stem = match[1] ?? ""
  return stem.length >= 2 && bases.has(stem)
}

/** Stock wrappers use a trailing B, as in AAPLB. Coins such as SHIB and BNB stay. */
export function isTokenizedStock(base: string): boolean {
  return base.length >= 4 && base.endsWith("B") && !CRYPTO_ENDING_B.has(base)
}

export function isHiddenMarket(base: string, bases: ReadonlySet<string>): boolean {
  return isLeveragedToken(base, bases) || isTokenizedStock(base)
}

/** 0 exact ticker, 1 ticker prefix, 2 name prefix, 3 substring. Null when it does not match. */
export function matchRank(base: string, name: string | undefined, query: string): number | null {
  const needle = query.trim().toLowerCase()
  if (!needle) return 0
  const ticker = base.toLowerCase()
  const label = name?.trim().toLowerCase()
  const named = Boolean(label) && label !== ticker
  if (ticker === needle) return 0
  if (ticker.startsWith(needle)) return 1
  if (named && label!.startsWith(needle)) return 2
  if (ticker.includes(needle) || (named && label!.includes(needle))) return 3
  return null
}

export function orderMarkets<T extends SearchRow>(
  markets: readonly T[],
  query: string,
  favourites: readonly string[],
  includeTokenized: boolean,
  bases: ReadonlySet<string>,
): { pinned: T[]; rest: T[] } {
  const visible = markets.filter((market) => includeTokenized || !isHiddenMarket(market.base, bases))
  const byId = new Map(visible.map((market) => [market.id, market]))
  const pinned = favourites.flatMap((id) => {
    const market = byId.get(id)
    return market && matchRank(market.base, market.name, query) != null ? [market] : []
  })
  const favouriteIds = new Set(pinned.map((market) => market.id))
  const rest = visible.filter((market) => !favouriteIds.has(market.id))
  return {
    pinned: rankRows(pinned, query),
    rest: rankRows(rest, query),
  }
}

function rankRows<T extends SearchRow>(rows: readonly T[], query: string): T[] {
  return rows
    .map((market, index) => ({ market, index, rank: matchRank(market.base, market.name, query) }))
    .filter((row): row is { market: T; index: number; rank: number } => row.rank != null)
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map((row) => row.market)
}
