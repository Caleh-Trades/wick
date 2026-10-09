import { normalizeSymbol } from "./markets.ts"
import type { BotOp } from "./bot-edits.ts"

const KEY = "wick-journal"
const MAX_ENTRIES = 200

export type JournalSide = "buy" | "sell"

export type JournalEntry = {
  id: string
  time: string
  symbol: string
  side: JournalSide
  price: number
  size: number
  note: string
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

export function logTrade(input: {
  symbol: string
  side: string
  price: number
  size: number
  note?: string
  time?: string
}): JournalEntry | null {
  const entry = entryFromFields(input)
  if (!entry) return null
  commit([entry, ...journalEntries()])
  return entry
}

export function logTradeOp(op: BotOp): boolean {
  return logTrade({
    symbol: typeof op.symbol === "string" ? op.symbol : "",
    side: typeof op.side === "string" ? op.side : "",
    price: Number(op.price),
    size: Number(op.size),
    note: typeof op.note === "string" ? op.note : "",
    time: typeof op.time === "string" ? op.time : undefined,
  }) != null
}

export function removeJournalEntry(id: string): void {
  commit(journalEntries().filter((entry) => entry.id !== id))
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
