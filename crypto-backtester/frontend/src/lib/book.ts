export const TAPE_LENGTH = 40
export const DELTA_WINDOW_MS = 60_000

export type FlowSide = "buy" | "sell"

export type Level = {
  price: number
  priceKey: string
  size: number
  total: number
  changed: boolean
}

export type Print = {
  id: string
  t: number
  side: FlowSide
  price: number
  size: number
}

export type Ladder = {
  bids: Level[]
  asks: Level[]
  spread: number | null
  mid: number | null
  crossed: boolean
}

type RawLevel = { priceKey: string; price: number; size: number }

export function streamNames(symbol: string): string[] {
  const pair = symbol.toLowerCase()
  return [`${pair}@depth20@100ms`, `${pair}@trade`]
}

/** Binance `m` is true when the buyer is the maker, so the taker sold. */
export function takerSide(buyerIsMaker: boolean): FlowSide {
  return buyerIsMaker ? "sell" : "buy"
}

export function projectLadder(
  bids: Array<[string, string]>,
  asks: Array<[string, string]>,
  previous: Map<string, number>,
): Ladder {
  const bidRows = parseLevels(bids).sort((left, right) => right.price - left.price)
  const askRows = parseLevels(asks).sort((left, right) => left.price - right.price)
  const bestBid = bidRows[0]?.price
  const bestAsk = askRows[0]?.price
  const crossed = bestBid == null || bestAsk == null || bestBid >= bestAsk
  if (crossed) {
    return { bids: [], asks: [], spread: null, mid: null, crossed: true }
  }
  return {
    bids: withTotals(bidRows, "bid", previous, false),
    asks: withTotals(askRows, "ask", previous, true),
    spread: bestAsk - bestBid,
    mid: (bestAsk + bestBid) / 2,
    crossed: false,
  }
}

export function rollingFlow(prints: Print[], now: number): { delta: number; buy: number; sell: number } {
  const cutoff = now - DELTA_WINDOW_MS
  let buy = 0
  let sell = 0
  for (const print of prints) {
    if (print.t < cutoff) continue
    if (print.side === "buy") buy += print.size
    else sell += print.size
  }
  return { delta: buy - sell, buy, sell }
}

export function stepDecimals(step: string): number {
  const text = step.trim()
  const dot = text.indexOf(".")
  if (dot < 0) return 0
  const fraction = text.slice(dot + 1).replace(/0+$/, "")
  return fraction.length
}

function parseLevels(rows: Array<[string, string]>): RawLevel[] {
  const levels: RawLevel[] = []
  for (const [priceKey, sizeKey] of rows) {
    const price = Number(priceKey)
    const size = Number(sizeKey)
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(size) || size <= 0) continue
    levels.push({ priceKey, price, size })
  }
  return levels
}

function withTotals(levels: RawLevel[], side: "bid" | "ask", previous: Map<string, number>, reverse: boolean): Level[] {
  let total = 0
  const summed = levels.map((level) => {
    total += level.size
    const key = `${side}:${level.priceKey}`
    const prior = previous.get(key)
    return {
      price: level.price,
      priceKey: level.priceKey,
      size: level.size,
      total,
      changed: prior !== undefined && prior !== level.size,
    }
  })
  return reverse ? summed.reverse() : summed
}
