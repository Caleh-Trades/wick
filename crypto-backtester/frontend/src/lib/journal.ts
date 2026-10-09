import type { BotOp } from "./bot-edits.ts"
import { normalizeSymbol } from "./markets.ts"
import { ruleName } from "./runs.ts"

const KEY = "wick-journal"
const MAX_ENTRIES = 200
const MAX_STRATEGY = 48

export type JournalSide = "buy" | "sell"

export type JournalEntry = {
  id: string
  time: string
  symbol: string
  side: JournalSide
  price: number
  size: number
  strategy: string
  exitPrice: number | null
  note: string
}

export type StrategyStat = {
  name: string
  trades: number
  wins: number
  pnl: number
}

export type JournalStats = {
  pnl: number
  winRate: number | null
  closed: number
  open: number
  profitFactor: number | null
  average: number | null
  strategies: StrategyStat[]
}

type Listener = () => void

const listeners = new Set<Listener>()
let entries: JournalEntry[] | null = null

export function journalEntries(): JournalEntry[] {
  if (entries) return entries
  entries = load()
  return entries
}

export function watchJournal(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function tradePnl(entry: Pick<JournalEntry, "side" | "price" | "size" | "exitPrice">): number | null {
  if (entry.exitPrice == null || !(entry.exitPrice > 0)) return null
  const move = entry.side === "buy" ? entry.exitPrice - entry.price : entry.price - entry.exitPrice
  return move * entry.size
}

export function journalStats(rows: JournalEntry[]): JournalStats {
  let pnl = 0
  let closed = 0
  let wins = 0
  let grossWin = 0
  let grossLoss = 0
  const byStrategy = new Map<string, StrategyStat>()
  for (const entry of rows) {
    const trade = tradePnl(entry)
    if (trade == null) continue
    closed += 1
    pnl += trade
    if (trade > 0) {
      wins += 1
      grossWin += trade
    } else if (trade < 0) grossLoss += Math.abs(trade)
    const name = entry.strategy.trim() || "No strategy"
    const row = byStrategy.get(name) ?? { name, trades: 0, wins: 0, pnl: 0 }
    row.trades += 1
    if (trade > 0) row.wins += 1
    row.pnl += trade
    byStrategy.set(name, row)
  }
  return {
    pnl,
    winRate: closed ? (wins / closed) * 100 : null,
    closed,
    open: rows.length - closed,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Number.POSITIVE_INFINITY : null,
    average: closed ? pnl / closed : null,
    strategies: [...byStrategy.values()].sort((left, right) => right.pnl - left.pnl || right.trades - left.trades),
  }
}

export function logTrade(input: {
  symbol: string
  side: string
  price: number
  size: number
  strategy?: string
  exitPrice?: number | null
  note?: string
  time?: string
}): JournalEntry | null {
  const entry = entryFromFields(input)
  if (!entry) return null
  commit([entry, ...journalEntries()])
  return entry
}

export function logTradeOp(op: BotOp): boolean {
  return (
    logTrade({
      symbol: typeof op.symbol === "string" ? op.symbol : "",
      side: typeof op.side === "string" ? op.side : "",
      price: Number(op.price),
      size: Number(op.size),
      strategy: typeof op.strategy === "string" ? op.strategy : "",
      exitPrice: exitFromOp(op),
      note: typeof op.note === "string" ? op.note : "",
      time: typeof op.time === "string" ? op.time : undefined,
    }) != null
  )
}

export function removeJournalEntry(id: string): void {
  commit(journalEntries().filter((entry) => entry.id !== id))
}

function exitFromOp(op: BotOp): number | null {
  const raw = op.exitPrice ?? op.exit
  if (raw == null || raw === "") return null
  const number = Number(raw)
  return number > 0 ? number : null
}

function commit(next: JournalEntry[]): void {
  entries = next.slice(0, MAX_ENTRIES)
  try {
    localStorage.setItem(KEY, JSON.stringify(entries))
  } catch {
    /* the journal still shows for this visit */
  }
  for (const listener of listeners) listener()
}

function load(): JournalEntry[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map(sanitize).filter((entry) => entry != null).slice(0, MAX_ENTRIES)
  } catch {
    return []
  }
}

function sanitize(value: unknown): JournalEntry | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Partial<JournalEntry>
  return entryFromFields({
    symbol: typeof raw.symbol === "string" ? raw.symbol : "",
    side: typeof raw.side === "string" ? raw.side : "",
    price: Number(raw.price),
    size: Number(raw.size),
    strategy: typeof raw.strategy === "string" ? raw.strategy : "",
    exitPrice: raw.exitPrice,
    note: typeof raw.note === "string" ? raw.note : "",
    time: typeof raw.time === "string" ? raw.time : undefined,
    id: typeof raw.id === "string" ? raw.id : undefined,
  })
}

function entryFromFields(input: {
  symbol: string
  side: string
  price: number
  size: number
  strategy?: string
  exitPrice?: number | null
  note?: string
  time?: string
  id?: string
}): JournalEntry | null {
  const symbol = asSymbol(input.symbol)
  const side = asSide(input.side)
  if (!symbol || !side || !(input.price > 0) || !(input.size > 0)) return null
  const time = input.time && !Number.isNaN(Date.parse(input.time)) ? new Date(input.time).toISOString() : new Date().toISOString()
  return {
    id: input.id && input.id.trim() ? input.id : crypto.randomUUID(),
    time,
    symbol,
    side,
    price: input.price,
    size: input.size,
    strategy: asStrategy(input.strategy),
    exitPrice: asExit(input.exitPrice),
    note: (input.note ?? "").trim().slice(0, 280),
  }
}

function asSymbol(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const direct = normalizeSymbol(trimmed)
  if (direct && direct !== "USDT") return direct
  const withQuote = normalizeSymbol(`${trimmed}USDT`)
  if (!withQuote || withQuote === "USDT") return null
  return withQuote
}

function asSide(value: string): JournalSide | null {
  const side = value.trim().toLowerCase()
  if (side === "buy" || side === "long") return "buy"
  if (side === "sell" || side === "short") return "sell"
  return null
}

function asStrategy(value: string | undefined): string {
  const trimmed = (value ?? "").trim()
  if (!trimmed) return ""
  return ruleName(trimmed).slice(0, MAX_STRATEGY)
}

function asExit(value: number | null | undefined): number | null {
  if (value == null) return null
  const number = Number(value)
  return number > 0 ? number : null
}
