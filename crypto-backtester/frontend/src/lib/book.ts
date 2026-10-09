export const BOOK_DEPTH = 15
export const TAPE_LENGTH = 40
export const DELTA_WINDOW_MS = 60_000
const PRINT_MEMORY = 400

export type FlowSide = "buy" | "sell"

export type Level = {
  price: number
  size: number
  cum: number
}

export type Print = {
  id: string
  t: number
  side: FlowSide
  price: number
  size: number
}

export type Book = {
  bids: Map<string, number>
  asks: Map<string, number>
  ready: boolean
  prints: Print[]
  seen: Set<string>
}

export type FeedLevel = {
  side: string
  price: string
  size: string
}

export type FeedTrade = {
  id: string
  time: string
  makerSide: string
  price: string
  size: string
}

export type FeedMessage =
  | { kind: "snapshot"; levels: FeedLevel[] }
  | { kind: "delta"; levels: FeedLevel[] }
  | { kind: "trades"; trades: FeedTrade[] }

export function createBook(): Book {
  return {
    bids: new Map(),
    asks: new Map(),
    ready: false,
    prints: [],
    seen: new Set(),
  }
}

export function applyFeed(book: Book, message: FeedMessage): void {
  if (message.kind === "trades") {
    applyTrades(book, message.trades)
    return
  }
  if (message.kind === "delta" && !book.ready) return
  if (message.kind === "snapshot") {
    book.bids.clear()
    book.asks.clear()
  }
  writeLevels(book, message.levels)
  book.ready = true
}

export function projectBook(book: Book, now: number): {
  bids: Level[]
  asks: Level[]
  spread: number | null
  mid: number | null
  prints: Print[]
  delta: number
} {
  const bids = topLevels(book.bids, "desc")
  const asks = topLevels(book.asks, "asc")
  const bestBid = bids[0]?.price
  const bestAsk = asks[0]?.price
  const spread = bestBid != null && bestAsk != null ? bestAsk - bestBid : null
  const mid = bestBid != null && bestAsk != null ? (bestAsk + bestBid) / 2 : null
  const askView = withCum(asks).slice().reverse()
  return {
    bids: withCum(bids),
    asks: askView,
    spread,
    mid,
    prints: book.prints.slice(-TAPE_LENGTH).reverse(),
    delta: rollingDelta(book.prints, now),
  }
}

/** Maker side, as on the matches channel. A sell maker was lifted; a buy maker was hit. */
export function takerSide(makerSide: string): FlowSide | null {
  const side = makerSide.toLowerCase()
  if (side === "sell") return "buy"
  if (side === "buy") return "sell"
  return null
}

export function parseCoinbase(payload: unknown): FeedMessage[] {
  if (!payload || typeof payload !== "object") return []
  const message = payload as { channel?: unknown; events?: unknown }
  const channel = message.channel
  if (!Array.isArray(message.events)) return []
  const parsed: FeedMessage[] = []
  for (const event of message.events) {
    if (!event || typeof event !== "object") continue
    const record = event as { type?: unknown; updates?: unknown; trades?: unknown }
    if (channel === "l2_data") {
      const levels = readLevels(record.updates)
      if (levels.length === 0) continue
      parsed.push({ kind: record.type === "snapshot" ? "snapshot" : "delta", levels })
    } else if (channel === "market_trades") {
      const trades = readTrades(record.trades)
      if (trades.length === 0) continue
      parsed.push({ kind: "trades", trades })
    }
  }
  return parsed
}

function writeLevels(book: Book, levels: FeedLevel[]): void {
  for (const level of levels) {
    const bookSide = level.side === "bid" ? book.bids : level.side === "offer" || level.side === "ask" ? book.asks : null
    if (!bookSide) continue
    const size = Number(level.size)
    const price = Number(level.price)
    if (!level.price || !Number.isFinite(size) || size < 0 || !Number.isFinite(price) || price <= 0) continue
    if (size === 0) bookSide.delete(level.price)
    else bookSide.set(level.price, size)
  }
}

function applyTrades(book: Book, trades: FeedTrade[]): void {
  const incoming = [...trades].sort((left, right) => Date.parse(left.time) - Date.parse(right.time))
  for (const trade of incoming) {
    if (!trade.id || book.seen.has(trade.id)) continue
    const side = takerSide(trade.makerSide)
    const price = Number(trade.price)
    const size = Number(trade.size)
    const t = Date.parse(trade.time)
    if (!side || !Number.isFinite(price) || price <= 0 || !Number.isFinite(size) || size <= 0 || !Number.isFinite(t)) continue
    book.seen.add(trade.id)
    book.prints.push({ id: trade.id, t, side, price, size })
  }
  if (book.prints.length > PRINT_MEMORY) {
    const dropped = book.prints.splice(0, book.prints.length - PRINT_MEMORY)
    for (const print of dropped) book.seen.delete(print.id)
  }
}

function topLevels(levels: Map<string, number>, direction: "asc" | "desc"): { price: number; size: number }[] {
  const rows: { price: number; size: number }[] = []
  for (const [price, size] of levels) {
    const value = Number(price)
    if (!Number.isFinite(value) || value <= 0 || size <= 0) continue
    rows.push({ price: value, size })
  }
  rows.sort((left, right) => (direction === "asc" ? left.price - right.price : right.price - left.price))
  return rows.slice(0, BOOK_DEPTH)
}

function withCum(levels: { price: number; size: number }[]): Level[] {
  let cum = 0
  return levels.map((level) => {
    cum += level.size
    return { price: level.price, size: level.size, cum }
  })
}

function rollingDelta(prints: Print[], now: number): number {
  const cutoff = now - DELTA_WINDOW_MS
  let delta = 0
  for (const print of prints) {
    if (print.t < cutoff) continue
    delta += print.side === "buy" ? print.size : -print.size
  }
  return delta
}

function readLevels(value: unknown): FeedLevel[] {
  if (!Array.isArray(value)) return []
  const levels: FeedLevel[] = []
  for (const item of value) {
    if (!item || typeof item !== "object") continue
    const row = item as { side?: unknown; price_level?: unknown; new_quantity?: unknown }
    if (typeof row.side !== "string" || typeof row.price_level !== "string" || typeof row.new_quantity !== "string") continue
    levels.push({ side: row.side, price: row.price_level, size: row.new_quantity })
  }
  return levels
}

function readTrades(value: unknown): FeedTrade[] {
  if (!Array.isArray(value)) return []
  const trades: FeedTrade[] = []
  for (const item of value) {
    if (!item || typeof item !== "object") continue
    const row = item as { trade_id?: unknown; time?: unknown; side?: unknown; price?: unknown; size?: unknown }
    if (typeof row.time !== "string" || typeof row.side !== "string" || typeof row.price !== "string" || typeof row.size !== "string") {
      continue
    }
    const id = row.trade_id == null ? `${row.time}|${row.price}|${row.size}|${row.side}` : String(row.trade_id)
    trades.push({ id, time: row.time, makerSide: row.side, price: row.price, size: row.size })
  }
  return trades
}
