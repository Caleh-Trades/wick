import type { BotOp } from "./bot-edits.ts"
import { normalizeSymbol } from "./markets.ts"
import { isRange, isTimeframe, isVenue, normalizeRule, ruleName } from "./runs.ts"
import type { AlertKind } from "./workspace.ts"
import type { RunParams, SampleSlice, Trade, Venue } from "./types.ts"

const KEY = "wick-journal"
const KEPT_KEY = "wick-kept"
const MAX_ENTRIES = 200
const MAX_KEPT = 40
const MAX_STRATEGY = 48

export type JournalSide = "buy" | "sell"

export type JournalEntry = {
  id: string
  time: string
  symbol: string
  venue: Venue
  kind: "trade" | "alert"
  side: JournalSide
  price: number
  size: number
  strategy: string
  exitPrice: number | null
  note: string
  /** Set when kind is alert. The value that crossed the threshold. */
  alertKind: AlertKind | null
}

export type KeptMetrics = {
  total_return_pct: number
  cagr_pct: number | null
  max_drawdown_pct: number
  sharpe: number | null
  win_rate_pct: number | null
  profit_factor: number | null
  trades: number
  final_equity: number
}

export type KeptRun = {
  id: string
  time: string
  name: string
  symbol: string
  venue: Venue
  timeframe: string
  range: string
  rule: string
  params: RunParams
  combo: { rule: string; params: RunParams }[]
  feeBps: number
  capital: number
  leverage: number
  riskPct: number
  allowShort: boolean
  metrics: KeptMetrics
  note: string
  fundingPaid: number
  inSample: SampleSlice | null
  holdout: SampleSlice | null
  trades: Trade[]
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
  const trades = rows.filter((entry) => entry.kind !== "alert")
  const byStrategy = new Map<string, StrategyStat>()
  for (const entry of trades) {
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
    open: trades.length - closed,
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
  venue?: string
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
      venue: typeof op.venue === "string" ? op.venue : "spot",
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
  if (raw.kind === "alert") return alertFromStored(raw)
  return entryFromFields({
    symbol: typeof raw.symbol === "string" ? raw.symbol : "",
    side: typeof raw.side === "string" ? raw.side : "",
    price: Number(raw.price),
    size: Number(raw.size),
    venue: typeof raw.venue === "string" ? raw.venue : "spot",
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
  venue?: string
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
    venue: asVenue(input.venue),
    price: input.price,
    size: input.size,
    strategy: asStrategy(input.strategy),
    exitPrice: asExit(input.exitPrice),
    note: (input.note ?? "").trim().slice(0, 280),
    kind: "trade",
    alertKind: null,
  }
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
    venue: asVenue(input.venue),
    kind: "alert",
    side: "buy",
    price: input.value,
    size: 0,
    strategy: "",
    exitPrice: null,
    note: alertNote(input.alertKind, input.value, input.threshold),
    alertKind: input.alertKind,
  }
  commit([entry, ...journalEntries()])
  return entry
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

function alertFromStored(raw: Partial<JournalEntry>): JournalEntry | null {
  const symbol = asSymbol(typeof raw.symbol === "string" ? raw.symbol : "")
  const alertKind = raw.alertKind === "above" || raw.alertKind === "below" || raw.alertKind === "delta" ? raw.alertKind : null
  const price = Number(raw.price)
  if (!symbol || !alertKind || !Number.isFinite(price)) return null
  const time = typeof raw.time === "string" && !Number.isNaN(Date.parse(raw.time)) ? new Date(raw.time).toISOString() : new Date().toISOString()
  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id : crypto.randomUUID(),
    time,
    symbol,
    venue: asVenue(typeof raw.venue === "string" ? raw.venue : "spot"),
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

function asVenue(value: string | undefined): Venue {
  return isVenue(value) ? value : "spot"
}

const keptListeners = new Set<Listener>()
let kept: KeptRun[] | null = null

export function keptRuns(): KeptRun[] {
  if (kept) return kept
  kept = loadKept()
  return kept
}

export function watchKept(listener: Listener): () => void {
  keptListeners.add(listener)
  return () => keptListeners.delete(listener)
}

export function keepRun(input: Omit<KeptRun, "id" | "time"> & { id?: string; time?: string }): KeptRun | null {
  const row = sanitizeKept(input)
  if (!row) return null
  const next = [row, ...keptRuns().filter((item) => item.id !== row.id)]
  commitKept(next)
  return row
}

export function removeKeptRun(id: string): void {
  commitKept(keptRuns().filter((item) => item.id !== id))
}

function commitKept(next: KeptRun[]): void {
  kept = next.slice(0, MAX_KEPT)
  try {
    localStorage.setItem(KEPT_KEY, JSON.stringify(kept))
  } catch {
    /* the list still shows for this visit */
  }
  for (const listener of keptListeners) listener()
}

function loadKept(): KeptRun[] {
  try {
    const raw = localStorage.getItem(KEPT_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map(sanitizeKept).filter((row) => row != null).slice(0, MAX_KEPT)
  } catch {
    return []
  }
}

function sanitizeKept(value: unknown): KeptRun | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Partial<KeptRun>
  const symbol = asSymbol(typeof raw.symbol === "string" ? raw.symbol : "")
  const venue = asVenue(typeof raw.venue === "string" ? raw.venue : "")
  const timeframe = typeof raw.timeframe === "string" && isTimeframe(raw.timeframe) ? raw.timeframe : null
  const range = typeof raw.range === "string" && isRange(raw.range) ? raw.range : null
  const rule = typeof raw.rule === "string" ? normalizeRule(raw.rule) : null
  const metrics = asMetrics(raw.metrics)
  if (!symbol || !timeframe || !range || !rule || !metrics) return null
  const time = typeof raw.time === "string" && !Number.isNaN(Date.parse(raw.time)) ? new Date(raw.time).toISOString() : new Date().toISOString()
  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id : crypto.randomUUID(),
    time,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 48) : ruleName(rule),
    symbol,
    venue,
    timeframe,
    range,
    rule,
    params: asParams(raw.params),
    combo: asCombo(raw.combo, rule),
    feeBps: clampKept(raw.feeBps, 0, 1000, 10),
    capital: clampKept(raw.capital, 1, 1_000_000_000, 10_000),
    leverage: clampKept(raw.leverage, 1, 20, venue === "perp" ? 3 : 1),
    riskPct: clampKept(raw.riskPct, 0.1, 100, 100),
    allowShort: venue === "perp" && raw.allowShort !== false,
    metrics,
    note: typeof raw.note === "string" ? raw.note.trim().slice(0, 280) : "",
    fundingPaid: Number.isFinite(Number(raw.fundingPaid)) ? Number(raw.fundingPaid) : 0,
    inSample: asSlice(raw.inSample),
    holdout: asSlice(raw.holdout),
    trades: asTrades(raw.trades),
  }
}

export function setKeptNote(id: string, note: string): void {
  const next = keptRuns().map((row) => (row.id === id ? { ...row, note: note.slice(0, 280) } : row))
  commitKept(next)
}

export type KeptExport = {
  symbol: string
  market: Venue
  rule: string
  params: RunParams
  metrics: KeptMetrics
  in_sample: SampleSlice | null
  holdout: SampleSlice | null
  trades: Trade[]
  note: string
  funding_paid: number
}

export function keptExport(row: KeptRun): KeptExport {
  return {
    symbol: row.symbol,
    market: row.venue,
    rule: row.rule,
    params: row.params,
    metrics: row.metrics,
    in_sample: row.inSample,
    holdout: row.holdout,
    trades: row.trades,
    note: row.note,
    funding_paid: row.fundingPaid,
  }
}

export function downloadKept(row: KeptRun): void {
  const blob = new Blob([JSON.stringify(keptExport(row), null, 2)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `wick-${row.symbol}-${row.venue}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

function asSlice(value: unknown): SampleSlice | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Partial<SampleSlice>
  const total = Number(raw.total_return_pct)
  const drawdown = Number(raw.max_drawdown_pct)
  const trades = Number(raw.trades)
  if (!Number.isFinite(total) || !Number.isFinite(drawdown) || !Number.isFinite(trades)) return null
  return {
    total_return_pct: total,
    max_drawdown_pct: drawdown,
    sharpe: finiteOrNull(raw.sharpe),
    trades,
  }
}

function asTrades(value: unknown): Trade[] {
  if (!Array.isArray(value)) return []
  const trades: Trade[] = []
  for (const item of value) {
    if (!item || typeof item !== "object") continue
    const raw = item as Partial<Trade>
    const side = raw.side === "short" ? "short" : raw.side === "long" ? "long" : null
    const status = raw.status === "open" || raw.status === "closed" || raw.status === "liquidated" ? raw.status : null
    const entry = Number(raw.entry_price)
    const quantity = Number(raw.quantity)
    if (!side || !status || !Number.isFinite(entry) || !Number.isFinite(quantity)) continue
    trades.push({
      entry_time: typeof raw.entry_time === "string" ? raw.entry_time : "",
      exit_time: typeof raw.exit_time === "string" ? raw.exit_time : null,
      side,
      entry_price: entry,
      exit_price: raw.exit_price == null ? null : finiteOrNull(raw.exit_price),
      quantity,
      pnl: Number.isFinite(Number(raw.pnl)) ? Number(raw.pnl) : 0,
      return_pct: Number.isFinite(Number(raw.return_pct)) ? Number(raw.return_pct) : 0,
      bars_held: Number.isFinite(Number(raw.bars_held)) ? Number(raw.bars_held) : 0,
      status,
      funding_paid: Number.isFinite(Number(raw.funding_paid)) ? Number(raw.funding_paid) : 0,
    })
    if (trades.length >= 500) break
  }
  return trades
}

function asMetrics(value: unknown): KeptMetrics | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Partial<KeptMetrics>
  const total = Number(raw.total_return_pct)
  const drawdown = Number(raw.max_drawdown_pct)
  const equity = Number(raw.final_equity)
  const trades = Number(raw.trades)
  if (!Number.isFinite(total) || !Number.isFinite(drawdown) || !Number.isFinite(equity) || !Number.isFinite(trades)) return null
  return {
    total_return_pct: total,
    cagr_pct: finiteOrNull(raw.cagr_pct),
    max_drawdown_pct: drawdown,
    sharpe: finiteOrNull(raw.sharpe),
    win_rate_pct: finiteOrNull(raw.win_rate_pct),
    profit_factor: finiteOrNull(raw.profit_factor),
    trades,
    final_equity: equity,
  }
}

function finiteOrNull(value: unknown): number | null {
  if (value == null) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function asParams(value: unknown): RunParams {
  if (!value || typeof value !== "object") return {}
  const params: RunParams = {}
  for (const [key, item] of Object.entries(value)) {
    const number = Number(item)
    if (Number.isFinite(number)) params[key] = number
  }
  return params
}

function asCombo(value: unknown, primary: string): { rule: string; params: RunParams }[] {
  if (!Array.isArray(value)) return []
  const combo: { rule: string; params: RunParams }[] = []
  for (const item of value) {
    if (!item || typeof item !== "object") continue
    const rule = normalizeRule(String((item as { rule?: unknown }).rule ?? ""))
    if (!rule || rule === primary || combo.some((row) => row.rule === rule)) continue
    combo.push({ rule, params: asParams((item as { params?: unknown }).params) })
    if (combo.length >= 3) break
  }
  return combo
}

function clampKept(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}
