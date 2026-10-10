import { normalizeSymbol } from "./markets.ts"
import { isVenue } from "./runs.ts"
import type { AlertKind } from "./workspace.ts"
import type { Venue } from "./types.ts"

const KEY = "wick-alerts"

export type JournalEntry = {
  id: string
  time: string
  symbol: string
  venue: Venue
  kind: "alert"
  side: "buy"
  price: number
  size: number
  strategy: string
  exitPrice: null
  note: string
  alertKind: AlertKind
}

type Listener = () => void

const listeners = new Set<Listener>()
let alerts: JournalEntry[] | null = null

export function alertEntries(): JournalEntry[] {
  if (alerts) return alerts
  alerts = load()
  return alerts
}

export function watchAlerts(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function logAlert(input: {
  symbol: string
  venue?: string
  alertKind: AlertKind
  value: number
  threshold: number
  time?: string
}): JournalEntry | null {
  const symbol = asSymbol(input.symbol)
  if (!symbol || !Number.isFinite(input.value) || !(input.threshold > 0)) return null
  const time = input.time && !Number.isNaN(Date.parse(input.time)) ? new Date(input.time).toISOString() : new Date().toISOString()
  const entry: JournalEntry = {
    id: crypto.randomUUID(),
    time,
    symbol,
    venue: isVenue(input.venue) ? input.venue : "spot",
    kind: "alert",
    side: "buy",
    price: input.value,
    size: 0,
    strategy: "",
    exitPrice: null,
    note: alertNote(input.alertKind, input.value, input.threshold),
    alertKind: input.alertKind,
  }
  commit([entry, ...alertEntries()].slice(0, 80))
  return entry
}

export function removeAlert(id: string): void {
  commit(alertEntries().filter((entry) => entry.id !== id))
}

function commit(next: JournalEntry[]): void {
  alerts = next
  try {
    localStorage.setItem(KEY, JSON.stringify(alerts))
  } catch {
    /* the alerts still show for this visit */
  }
  for (const listener of listeners) listener()
}

function load(): JournalEntry[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map(sanitize).filter((entry) => entry != null).slice(0, 80)
  } catch {
    return []
  }
}

function sanitize(value: unknown): JournalEntry | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Partial<JournalEntry>
  const symbol = asSymbol(typeof raw.symbol === "string" ? raw.symbol : "")
  const alertKind = raw.alertKind === "above" || raw.alertKind === "below" || raw.alertKind === "delta" ? raw.alertKind : null
  const price = Number(raw.price)
  if (!symbol || !alertKind || !Number.isFinite(price)) return null
  const time = typeof raw.time === "string" && !Number.isNaN(Date.parse(raw.time)) ? new Date(raw.time).toISOString() : new Date().toISOString()
  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id : crypto.randomUUID(),
    time,
    symbol,
    venue: isVenue(raw.venue) ? raw.venue : "spot",
    kind: "alert",
    side: "buy",
    price,
    size: 0,
    strategy: "",
    exitPrice: null,
    note: typeof raw.note === "string" ? raw.note.trim().slice(0, 280) : "",
    alertKind,
  }
}

function alertNote(kind: AlertKind, value: number, threshold: number): string {
  const hit = formatAlertValue(value)
  const line = formatAlertValue(threshold)
  if (kind === "above") return `Price ${hit} crossed above ${line}`
  if (kind === "below") return `Price ${hit} crossed below ${line}`
  return `60s delta ${hit} crossed ${line}`
}

function formatAlertValue(value: number): string {
  if (!Number.isFinite(value)) return "—"
  const abs = Math.abs(value)
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : 6
  return value.toLocaleString("en-US", { maximumFractionDigits: digits })
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
