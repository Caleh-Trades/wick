import { profitFactor, tradeExpectancy } from "./backtest.ts"
import type { BotOp } from "./bot-edits.ts"
import { asRiskMode, isSessionLight, type RiskMode, type SessionLight } from "./desk.ts"
import { normalizeSymbol } from "./markets.ts"
import { isRange, isTimeframe, isVenue, normalizeCombo, normalizeRule, ruleById, ruleParams } from "./runs.ts"
import type { RunParams, SampleSlice, Trade, Venue } from "./types.ts"

export const PAGE_SIZE = 50

export type TradeSide = "long" | "short"
export type TradeSource = "desk" | "bot" | "paper"

export type StrategyRecord = {
  id: string
  name: string
  market: Venue
  symbol: string
  timeframe: string
  range: string
  rule: string
  params: RunParams
  fee: number
  slippage: number
  risk: number
  combo: { rule: string; params: RunParams }[]
  capital: number
  leverage: number
  allowShort: boolean
  note: string
}

export type RunMetrics = {
  total_return_pct: number
  cagr_pct: number | null
  max_drawdown_pct: number
  sharpe: number | null
  win_rate_pct: number | null
  profit_factor: number | null
  expectancy: number | null
  trades: number
  final_equity: number
}

/** In-sample, holdout, and three windows of the same pass. Small enough to keep on the row. */
export type RunSample = {
  inSample: SampleSlice
  holdout: SampleSlice
  windows: SampleSlice[]
}

/** Before fees, fees, slippage, and the return after those costs. */
export type RunCosts = {
  beforeFees: number
  fees: number
  slippage: number
  afterCosts: number
}

/** A run points at its trades by id. It does not embed them or any candles. */
export type RunRecord = {
  id: string
  strategyId: string
  range: string
  metrics: RunMetrics
  createdAt: string
  note: string
  sample: RunSample | null
  costs: RunCosts | null
  /** Scored forward on each new closed candle. The backtest row stays put. */
  paper: boolean
  /** Last candle time when paper was turned on. Older closes stay in the backtest. */
  paperSince: string | null
}

export type TradeRecord = {
  id: string
  strategyId: string
  runId: string | null
  symbol: string
  side: TradeSide
  entryTime: string
  entryPrice: number
  exitTime: string | null
  exitPrice: number | null
  size: number
  fee: number
  slippage: number
  pnl: number | null
  returnPct: number | null
  /** Worst open return, percent. Null when the path was not on the tape. */
  mae: number | null
  /** Best open return, percent. Null when the path was not on the tape. */
  mfe: number | null
  note: string
  /** Free-text strategy from a working ticket. A linked strategy name is used when this is blank. */
  strategyName: string
  source: TradeSource
  /** Spot and perp are different logs. A perp fill never lands in the spot log. */
  market: Venue
  stop: number | null
  r: number | null
  riskMode: RiskMode
  ticketId: string | null
}

export type WorkingTicket = {
  id: string
  symbol: string
  market: Venue
  side: TradeSide
  strategy: string
  entry: number
  stop: number
  size: number
  r: number
  riskMode: RiskMode
  session: SessionLight
  armed: boolean
  tradeId: string | null
  createdAt: string
  filledAt: string | null
}

export type TradeQuery = {
  symbol: string
  strategyId: string
  side: "" | TradeSide
  from: string
  to: string
  state: "" | "open" | "closed"
  market: "" | Venue
  riskMode: "" | RiskMode
  page: number
}

export type TicketQuery = {
  symbol: string
  strategy: string
  side: "" | TradeSide
  riskMode: "" | RiskMode
  session: "" | SessionLight
  page: number
}

export type TicketPage = {
  rows: WorkingTicket[]
  total: number
}

export type TradePage = {
  rows: TradeRecord[]
  total: number
  closed: number
  open: number
  profitFactor: number | null
  expectancy: number | null
}

export type KeptListRow = {
  run: RunRecord
  strategy: StrategyRecord
}

type Listener = () => void

const listeners = new Set<Listener>()

export function watchBook(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emit(): void {
  for (const listener of listeners) listener()
}

export function emptyQuery(page = 0): TradeQuery {
  return { symbol: "", strategyId: "", side: "", from: "", to: "", state: "", market: "", riskMode: "", page }
}

export function emptyTicketQuery(page = 0): TicketQuery {
  return { symbol: "", strategy: "", side: "", riskMode: "", session: "", page }
}

export function emptyPage(): TradePage {
  return { rows: [], total: 0, closed: 0, open: 0, profitFactor: null, expectancy: null }
}

/** A journal row is one you logged, or a bot logged. A backtest fill belongs to its run. */
export function isJournalTrade(trade: TradeRecord): boolean {
  return trade.runId == null && trade.source !== "paper"
}

export function tradeMatches(trade: TradeRecord, query: TradeQuery): boolean {
  if (!isJournalTrade(trade)) return false
  if (query.symbol && !trade.symbol.toLowerCase().includes(query.symbol.trim().toLowerCase())) return false
  if (query.strategyId && trade.strategyId !== query.strategyId) return false
  if (query.side && trade.side !== query.side) return false
  if (query.market && trade.market !== query.market) return false
  if (query.riskMode && trade.riskMode !== query.riskMode) return false
  if (query.state === "open" && trade.exitTime != null) return false
  if (query.state === "closed" && trade.exitTime == null) return false
  const from = query.from ? Date.parse(`${query.from}T00:00:00.000Z`) : null
  const to = query.to ? Date.parse(`${query.to}T23:59:59.999Z`) : null
  const entry = Date.parse(trade.entryTime)
  if (from != null && !Number.isNaN(from) && entry < from) return false
  if (to != null && !Number.isNaN(to) && entry > to) return false
  return true
}

/** Newest first. The returned page is at most one page of rows; `total` is the match count. */
export function pageTrades(trades: TradeRecord[], query: TradeQuery, pageSize = PAGE_SIZE): TradePage {
  const matched = trades.filter((trade) => tradeMatches(trade, query)).sort(byNewest)
  const start = Math.max(0, query.page) * pageSize
  return pageFrom(matched.slice(start, start + pageSize), matched)
}

function byNewest(left: TradeRecord, right: TradeRecord): number {
  return right.entryTime.localeCompare(left.entryTime) || right.id.localeCompare(left.id)
}

function pageFrom(rows: TradeRecord[], matched: TradeRecord[]): TradePage {
  let closed = 0
  let open = 0
  const samples: Array<{ pnl: number; return_pct: number; status: string }> = []
  for (const trade of matched) {
    if (trade.exitTime == null) open += 1
    else closed += 1
    samples.push({
      pnl: trade.pnl == null ? Number.NaN : trade.pnl,
      return_pct: trade.returnPct == null ? Number.NaN : trade.returnPct,
      status: trade.exitTime == null ? "open" : "closed",
    })
  }
  return {
    rows,
    total: matched.length,
    closed,
    open,
    profitFactor: profitFactor(samples),
    expectancy: tradeExpectancy(samples),
  }
}

type Memory = {
  strategies: Map<string, StrategyRecord>
  runs: Map<string, RunRecord>
  trades: Map<string, TradeRecord>
  tickets: Map<string, WorkingTicket>
}

function createMemory(): Memory {
  return { strategies: new Map(), runs: new Map(), trades: new Map(), tickets: new Map() }
}

let memory = createMemory()
let ready: Promise<void> | null = null

export function resetBookForTests(): void {
  memory = createMemory()
  ready = Promise.resolve()
}

export function bookReady(): Promise<void> {
  if (!ready) ready = hydrate()
  return ready
}

async function hydrate(): Promise<void> {
  if (hasIndexedDb()) {
    memory = await readDb()
  }
  migrateLegacy()
  if (hasIndexedDb()) await writeDb(memory)
}

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined"
}

export async function searchTrades(query: TradeQuery): Promise<TradePage> {
  await bookReady()
  if (hasIndexedDb()) return searchDb(query)
  return pageTrades([...memory.trades.values()], query)
}

export async function matchingTrades(query: TradeQuery): Promise<TradeRecord[]> {
  await bookReady()
  const all = [...memory.trades.values()]
  return all.filter((trade) => tradeMatches(trade, { ...query, page: 0 })).sort(byNewest)
}

export async function listRuns(): Promise<KeptListRow[]> {
  await bookReady()
  const rows: KeptListRow[] = []
  for (const run of memory.runs.values()) {
    const strategy = memory.strategies.get(run.strategyId)
    if (!strategy) continue
    rows.push({ run, strategy })
  }
  return rows.sort((left, right) => right.run.createdAt.localeCompare(left.run.createdAt))
}

export async function listStrategies(): Promise<StrategyRecord[]> {
  await bookReady()
  return [...memory.strategies.values()].sort((left, right) => left.name.localeCompare(right.name) || left.symbol.localeCompare(right.symbol))
}

/** Strategies that have a trade in the journal, not only a kept backtest. */
export async function listJournalStrategies(): Promise<StrategyRecord[]> {
  await bookReady()
  const ids = new Set(
    [...memory.trades.values()].filter((trade) => isJournalTrade(trade) && trade.strategyId).map((trade) => trade.strategyId),
  )
  return (await listStrategies()).filter((strategy) => ids.has(strategy.id))
}

export async function getStrategy(id: string): Promise<StrategyRecord | null> {
  await bookReady()
  return memory.strategies.get(id) ?? null
}

export async function getRun(id: string): Promise<RunRecord | null> {
  await bookReady()
  return memory.runs.get(id) ?? null
}

export async function tradesForRun(runId: string): Promise<TradeRecord[]> {
  await bookReady()
  return [...memory.trades.values()].filter((trade) => trade.runId === runId).sort(byNewest)
}

export async function findRun(match: {
  symbol: string
  market: Venue
  timeframe: string
  range: string
  rule: string
  params: RunParams
}): Promise<KeptListRow | null> {
  const rows = await listRuns()
  const rule = normalizeRule(match.rule)
  return (
    rows.find(
      (row) =>
        row.strategy.symbol === match.symbol &&
        row.strategy.market === match.market &&
        row.strategy.timeframe === match.timeframe &&
        row.run.range === match.range &&
        row.strategy.rule === rule &&
        sameParams(row.strategy.params, match.params),
    ) ?? null
  )
}

export async function logBookTrade(input: {
  symbol: string
  side: string
  entryPrice: number
  exitPrice?: number | null
  size: number
  fee?: number
  slippage?: number
  note?: string
  source?: TradeSource
  strategyId?: string
  strategyName?: string
  rule?: string
  entryTime?: string
  venue?: string
  market?: string
  stop?: number | null
  r?: number | null
  riskMode?: string
  ticketId?: string | null
}): Promise<TradeRecord | null> {
  await bookReady()
  const symbol = asSymbol(input.symbol)
  const side = asTradeSide(input.side)
  if (!symbol || !side || !(input.entryPrice > 0) || !(input.size > 0)) return null
  const exitPrice = input.exitPrice != null && input.exitPrice > 0 ? input.exitPrice : null
  const fee = Number.isFinite(input.fee) ? Number(input.fee) : 0
  const slippage = Number.isFinite(input.slippage) ? Number(input.slippage) : 0
  const move = exitPrice == null ? null : side === "long" ? exitPrice - input.entryPrice : input.entryPrice - exitPrice
  const strategyName = input.strategyName?.trim().slice(0, 48) ?? ""
  let strategyId = input.strategyId ?? ""
  const known = ruleById(input.rule?.trim() ?? "")
  if (!strategyId && known) {
    const strategy = await saveStrategy({
      name: strategyName || known.name,
      symbol,
      market: isVenue(input.market) ? input.market : isVenue(input.venue) ? input.venue : "spot",
      timeframe: "1d",
      range: "1Y",
      rule: known.id,
      params: {},
      fee: 0,
      slippage: 0,
      risk: 1,
      note: "",
    })
    strategyId = strategy?.id ?? ""
  }
  const row: TradeRecord = {
    id: crypto.randomUUID(),
    strategyId,
    runId: null,
    symbol,
    side,
    entryTime: stamp(input.entryTime),
    entryPrice: input.entryPrice,
    exitTime: exitPrice == null ? null : stamp(input.entryTime),
    exitPrice,
    size: input.size,
    fee,
    slippage,
    pnl: move == null ? null : move * input.size - fee - slippage,
    returnPct: move == null || !(input.entryPrice > 0) ? null : (move / input.entryPrice) * 100,
    mae: null,
    mfe: null,
    note: (input.note ?? "").trim().slice(0, 280),
    strategyName,
    source: input.source === "bot" ? "bot" : "desk",
    market: isVenue(input.market) ? input.market : isVenue(input.venue) ? input.venue : "spot",
    stop: input.stop != null && input.stop > 0 ? input.stop : null,
    r: input.r != null && input.r > 0 ? input.r : null,
    riskMode: asRiskMode(input.riskMode),
    ticketId: input.ticketId ?? null,
  }
  memory.trades.set(row.id, row)
  await persistOne("trades", row)
  emit()
  return row
}

export async function logTradeOp(op: BotOp): Promise<boolean> {
  const exitRaw = op.exitPrice ?? op.exit
  const exitPrice = exitRaw == null || exitRaw === "" ? null : Number(exitRaw)
  const row = await logBookTrade({
    symbol: typeof op.symbol === "string" ? op.symbol : "",
    side: typeof op.side === "string" ? op.side : "",
    entryPrice: Number(op.price),
    exitPrice: exitPrice != null && exitPrice > 0 ? exitPrice : null,
    size: Number(op.size),
    note: typeof op.note === "string" ? op.note : "",
    strategyName: typeof op.strategy === "string" ? op.strategy : "",
    rule: typeof op.strategy === "string" ? op.strategy : "",
    venue: typeof op.venue === "string" ? op.venue : "spot",
    market: typeof op.venue === "string" ? op.venue : "spot",
    riskMode: typeof op.riskMode === "string" ? op.riskMode : "NORMAL",
    stop: op.stop == null ? null : Number(op.stop),
    r: op.r == null ? null : Number(op.r),
    entryTime: typeof op.time === "string" ? op.time : undefined,
    source: "bot",
  })
  return row != null
}

export async function closeJournalTrade(id: string, exitPrice: number): Promise<TradeRecord | null> {
  await bookReady()
  const trade = memory.trades.get(id)
  if (!trade || trade.runId != null || !(exitPrice > 0)) return null
  if (trade.exitTime != null) return trade
  const settled = settle(trade.side, trade.entryPrice, exitPrice, trade.size, trade.fee, trade.slippage)
  const next: TradeRecord = {
    ...trade,
    exitPrice,
    exitTime: new Date().toISOString(),
    pnl: settled.pnl,
    returnPct: settled.returnPct,
  }
  memory.trades.set(id, next)
  await persistOne("trades", next)
  emit()
  return next
}

export async function setTradeNote(id: string, note: string): Promise<TradeRecord | null> {
  await bookReady()
  const trade = memory.trades.get(id)
  if (!trade || trade.runId != null) return null
  const next = { ...trade, note: note.trim().slice(0, 280) }
  memory.trades.set(id, next)
  await persistOne("trades", next)
  emit()
  return next
}

export async function saveTicket(input: {
  symbol: string
  market: Venue
  side: string
  strategy: string
  entry: number
  stop: number
  size: number
  r: number
  riskMode?: string
  session?: string
}): Promise<WorkingTicket | null> {
  await bookReady()
  const symbol = asSymbol(input.symbol)
  const side = asTradeSide(input.side)
  const strategy = input.strategy.trim().slice(0, 48)
  if (!symbol || !side || !strategy || !(input.entry > 0) || !(input.stop > 0) || !(input.size > 0) || !(input.r > 0)) return null
  const row: WorkingTicket = {
    id: crypto.randomUUID(),
    symbol,
    market: input.market === "perp" ? "perp" : "spot",
    side,
    strategy,
    entry: input.entry,
    stop: input.stop,
    size: input.size,
    r: input.r,
    riskMode: asRiskMode(input.riskMode),
    session: isSessionLight(input.session) ? input.session : "open",
    armed: false,
    tradeId: null,
    createdAt: new Date().toISOString(),
    filledAt: null,
  }
  memory.tickets.set(row.id, row)
  await persistOne("tickets", row)
  emit()
  return row
}

export function ticketMatches(ticket: WorkingTicket, query: TicketQuery): boolean {
  if (query.symbol && !ticket.symbol.toLowerCase().includes(query.symbol.trim().toLowerCase())) return false
  if (query.strategy && !ticket.strategy.toLowerCase().includes(query.strategy.trim().toLowerCase())) return false
  if (query.side && ticket.side !== query.side) return false
  if (query.riskMode && ticket.riskMode !== query.riskMode) return false
  if (query.session && ticket.session !== query.session) return false
  return true
}

export async function searchTickets(query: TicketQuery): Promise<TicketPage> {
  await bookReady()
  const matched = [...memory.tickets.values()].filter((ticket) => ticketMatches(ticket, query)).sort(byTicketNewest)
  const start = Math.max(0, query.page) * PAGE_SIZE
  return { rows: matched.slice(start, start + PAGE_SIZE), total: matched.length }
}

/** The newest ticket on this market that has not filled. Each pinned symbol keeps one of these. */
export async function liveTicket(symbol: string, market: Venue): Promise<WorkingTicket | null> {
  await bookReady()
  const id = asSymbol(symbol)
  if (!id) return null
  const rows = [...memory.tickets.values()]
    .filter((ticket) => ticket.symbol === id && ticket.market === market && ticket.filledAt == null)
    .sort(byTicketNewest)
  return rows[0] ?? null
}

export async function fillWorkingTicket(id: string, fillPrice: number): Promise<{ ticket: WorkingTicket; trade: TradeRecord } | null> {
  return withTicketLock(id, async () => {
    await bookReady()
    const ticket = memory.tickets.get(id)
    if (!ticket || !(fillPrice > 0)) return null
    if (ticket.filledAt && ticket.tradeId) {
      const existing = memory.trades.get(ticket.tradeId)
      if (existing) return { ticket, trade: existing }
    }
    const trade = await journalForTicket(ticket, fillPrice, false)
    if (!trade) return null
    const next: WorkingTicket = { ...ticket, tradeId: trade.id, filledAt: ticket.filledAt ?? new Date().toISOString() }
    memory.tickets.set(id, next)
    await persistOne("tickets", next)
    emit()
    return { ticket: next, trade }
  })
}

export async function promoteWorkingTicket(id: string): Promise<{ ticket: WorkingTicket; trade: TradeRecord } | null> {
  return withTicketLock(id, async () => {
    await bookReady()
    const ticket = memory.tickets.get(id)
    if (!ticket) return null
    const trade = await journalForTicket(ticket, null, true)
    if (!trade) return null
    const next: WorkingTicket = { ...ticket, armed: true, tradeId: trade.id }
    memory.tickets.set(id, next)
    await persistOne("tickets", next)
    emit()
    return { ticket: next, trade }
  })
}

const ticketLocks = new Map<string, Promise<unknown>>()

function withTicketLock<T>(id: string, run: () => Promise<T>): Promise<T> {
  const previous = ticketLocks.get(id) ?? Promise.resolve()
  const next = previous.then(run, run)
  ticketLocks.set(
    id,
    next.then(
      () => undefined,
      () => undefined,
    ),
  )
  return next
}

/** One journal row per ticket. A fill sets the entry to the fill price. Promote writes the shared id into the note. */
async function journalForTicket(ticket: WorkingTicket, fillPrice: number | null, note: boolean): Promise<TradeRecord | null> {
  const line = `ticket ${ticket.id}`
  const existing = ticket.tradeId ? memory.trades.get(ticket.tradeId) : null
  if (existing && existing.runId == null) {
    const entryPrice = fillPrice != null && fillPrice > 0 ? fillPrice : existing.entryPrice
    const next: TradeRecord = {
      ...existing,
      entryPrice,
      stop: ticket.stop,
      r: ticket.r,
      riskMode: ticket.riskMode,
      ticketId: ticket.id,
      market: ticket.market,
      note: note ? line : existing.note,
      strategyName: existing.strategyName || ticket.strategy,
    }
    memory.trades.set(existing.id, next)
    await persistOne("trades", next)
    return next
  }
  return logBookTrade({
    symbol: ticket.symbol,
    side: ticket.side,
    entryPrice: fillPrice != null && fillPrice > 0 ? fillPrice : ticket.entry,
    size: ticket.size,
    market: ticket.market,
    venue: ticket.market,
    strategyName: ticket.strategy,
    rule: ticket.strategy,
    stop: ticket.stop,
    r: ticket.r,
    riskMode: ticket.riskMode,
    ticketId: ticket.id,
    note: note ? line : "",
    source: "desk",
  })
}

function byTicketNewest(left: WorkingTicket, right: WorkingTicket): number {
  return right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
}

function settle(side: TradeSide, entry: number, exit: number, size: number, fee: number, slippage: number) {
  const move = side === "long" ? exit - entry : entry - exit
  return { pnl: move * size - fee - slippage, returnPct: entry > 0 ? (move / entry) * 100 : 0 }
}

export async function saveStrategy(
  input: Omit<StrategyRecord, "id" | "combo" | "capital" | "leverage" | "allowShort" | "note"> &
    Partial<Pick<StrategyRecord, "id" | "combo" | "capital" | "leverage" | "allowShort" | "note">>,
): Promise<StrategyRecord | null> {
  await bookReady()
  const row = sanitizeStrategy({ ...input, id: input.id })
  if (!row) return null
  const existing = [...memory.strategies.values()].find((item) => item.id !== row.id && sameSetup(item, row))
  const saved = existing ? { ...row, id: existing.id, note: row.note || existing.note } : row
  memory.strategies.set(saved.id, saved)
  await persistOne("strategies", saved)
  emit()
  return saved
}

export async function keepDeskRun(input: {
  name: string
  symbol: string
  venue: Venue
  timeframe: string
  range: string
  rule: string
  params: RunParams
  combo: { rule: string; params: RunParams }[]
  fee: number
  slippage: number
  capital: number
  leverage: number
  risk: number
  allowShort: boolean
  note: string
  metrics: RunMetrics
  trades: Trade[]
  sample?: RunSample | null
  costs?: RunCosts | null
}): Promise<{ strategy: StrategyRecord; run: RunRecord } | null> {
  const strategy = await saveStrategy({
    name: input.name,
    symbol: input.symbol,
    market: input.venue,
    timeframe: input.timeframe,
    range: input.range,
    rule: input.rule,
    params: input.params,
    combo: input.combo,
    fee: input.fee,
    slippage: input.slippage,
    capital: input.capital,
    leverage: input.leverage,
    risk: input.risk,
    allowShort: input.allowShort,
    note: "",
  })
  if (!strategy) return null
  const run: RunRecord = {
    id: crypto.randomUUID(),
    strategyId: strategy.id,
    range: input.range,
    metrics: input.metrics,
    createdAt: new Date().toISOString(),
    note: input.note.trim().slice(0, 280),
    sample: asSample(input.sample),
    costs: asCosts(input.costs),
    paper: false,
    paperSince: null,
  }
  memory.runs.set(run.id, run)
  for (const trade of input.trades) {
    const row = tradeFromBacktest(trade, strategy.id, run.id, input.symbol)
    if (row) memory.trades.set(row.id, row)
  }
  await persistAll()
  emit()
  return { strategy, run }
}

export async function setRunPaper(id: string, on: boolean, since: string): Promise<RunRecord | null> {
  await bookReady()
  const run = memory.runs.get(id)
  if (!run) return null
  const next: RunRecord = on
    ? { ...run, paper: true, paperSince: run.paper && run.paperSince ? run.paperSince : since }
    : { ...run, paper: false }
  memory.runs.set(id, next)
  await persistOne("runs", next)
  emit()
  return next
}

export async function syncPaperTrades(input: {
  runId: string
  strategyId: string
  symbol: string
  market: Venue
  since: string
  trades: Trade[]
}): Promise<void> {
  await bookReady()
  const existing = [...memory.trades.values()].filter((trade) => trade.runId === input.runId && trade.source === "paper")
  const byKey = new Map(existing.map((trade) => [`${trade.entryTime}|${trade.side}`, trade]))
  let changed = false
  for (const trade of input.trades) {
    if (trade.status === "open" || !trade.exit_time || trade.exit_time <= input.since) continue
    const key = `${trade.entry_time}|${trade.side}`
    const prior = byKey.get(key)
    if (prior && prior.exitTime === trade.exit_time && prior.pnl === trade.pnl) continue
    const row = tradeFromBacktest(trade, input.strategyId, input.runId, input.symbol)
    if (!row) continue
    row.source = "paper"
    row.market = input.market
    if (prior) row.id = prior.id
    memory.trades.set(row.id, row)
    byKey.set(key, row)
    changed = true
  }
  if (!changed) return
  await persistAll()
  emit()
}

export async function setRunNote(id: string, note: string): Promise<void> {
  await bookReady()
  const run = memory.runs.get(id)
  if (!run) return
  const next = { ...run, note: note.slice(0, 280) }
  memory.runs.set(id, next)
  await persistOne("runs", next)
  emit()
}

export async function setStrategyNote(id: string, note: string): Promise<void> {
  await bookReady()
  const strategy = memory.strategies.get(id)
  if (!strategy) return
  const next = { ...strategy, note: note.slice(0, 280) }
  memory.strategies.set(id, next)
  await persistOne("strategies", next)
  emit()
}

export async function removeRun(id: string): Promise<void> {
  await bookReady()
  memory.runs.delete(id)
  for (const trade of [...memory.trades.values()]) {
    if (trade.runId === id) memory.trades.delete(trade.id)
  }
  await persistAll()
  emit()
}

export async function removeStrategy(id: string): Promise<boolean> {
  await bookReady()
  const used = [...memory.runs.values()].some((run) => run.strategyId === id)
  if (used || !memory.strategies.has(id)) return false
  memory.strategies.delete(id)
  await persistAll()
  emit()
  return true
}

export async function removeTrade(id: string): Promise<void> {
  await bookReady()
  memory.trades.delete(id)
  if (hasIndexedDb()) await deleteDbKey("trades", id)
  emit()
}

export type BookDump = {
  strategies: StrategyRecord[]
  runs: RunRecord[]
  trades: TradeRecord[]
  tickets: WorkingTicket[]
}

export async function dumpBook(): Promise<BookDump> {
  await bookReady()
  return {
    strategies: [...memory.strategies.values()],
    runs: [...memory.runs.values()],
    trades: [...memory.trades.values()],
    tickets: [...memory.tickets.values()],
  }
}

export async function replaceBook(raw: {
  strategies?: unknown
  runs?: unknown
  trades?: unknown
  tickets?: unknown
  journal?: unknown
  kept?: unknown
  working?: unknown
}): Promise<void> {
  await bookReady()
  const strategies = new Map<string, StrategyRecord>()
  const runs = new Map<string, RunRecord>()
  const trades = new Map<string, TradeRecord>()
  const tickets = new Map<string, WorkingTicket>()
  if (Array.isArray(raw.strategies)) {
    for (const item of raw.strategies) {
      const row = sanitizeStrategy(item)
      if (row) strategies.set(row.id, row)
    }
  }
  if (Array.isArray(raw.runs)) {
    for (const item of raw.runs) {
      const row = sanitizeRun(item)
      if (row) runs.set(row.id, row)
    }
  }
  if (Array.isArray(raw.trades)) {
    for (const item of raw.trades) {
      const row = sanitizeTrade(item)
      if (row) trades.set(row.id, row)
    }
  }
  if (Array.isArray(raw.tickets)) {
    for (const item of raw.tickets) {
      const row = sanitizeTicket(item)
      if (row) tickets.set(row.id, row)
    }
  }
  memory = { strategies, runs, trades, tickets }
  if (strategies.size + runs.size + trades.size === 0) absorbLegacy(raw)
  await persistAll()
  emit()
}

export function tradesCsv(rows: TradeRecord[]): string {
  const lines = rows.map((trade) =>
    [
      csv(trade.entryTime),
      csv(trade.exitTime ?? ""),
      trade.side,
      trade.returnPct ?? "",
      trade.pnl ?? "",
      trade.mae ?? "",
      trade.mfe ?? "",
      trade.fee,
      trade.slippage,
      trade.size,
      csv(trade.symbol),
      csv(trade.note),
      trade.source,
    ].join(","),
  )
  return ["entry,exit,side,return,pnl,mae,mfe,fee,slippage,size,symbol,note,source", ...lines].join("\n")
}

export function downloadText(filename: string, text: string, type: string): void {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export async function exportFiltered(query: TradeQuery): Promise<void> {
  const rows = await matchingTrades(query)
  const strategies = new Map<string, StrategyRecord>()
  const runs = new Map<string, RunRecord>()
  for (const row of rows) {
    const strategy = row.strategyId ? memory.strategies.get(row.strategyId) : undefined
    if (strategy) strategies.set(strategy.id, strategy)
    const run = row.runId ? memory.runs.get(row.runId) : undefined
    if (run) runs.set(run.id, run)
  }
  downloadText(
    "wick-trades.json",
    JSON.stringify({ strategies: [...strategies.values()], runs: [...runs.values()], trades: rows }, null, 2),
    "application/json",
  )
}

export async function exportFilteredCsv(query: TradeQuery): Promise<void> {
  const rows = await matchingTrades(query)
  downloadText("wick-trades.csv", tradesCsv(rows), "text/csv")
}

export async function exportRunFile(runId: string): Promise<void> {
  const run = await getRun(runId)
  const strategy = run ? await getStrategy(run.strategyId) : null
  if (!run || !strategy) return
  const trades = await tradesForRun(runId)
  downloadText(
    `wick-${strategy.symbol}-${strategy.market}.json`,
    JSON.stringify({ strategy, run, trades }, null, 2),
    "application/json",
  )
}

/** One-shot download of the run on screen. Nothing is written into the book. */
export function downloadLiveRun(input: {
  name: string
  symbol: string
  venue: Venue
  timeframe: string
  range: string
  rule: string
  params: RunParams
  fee: number
  slippage: number
  risk: number
  note: string
  metrics: RunMetrics
  trades: Trade[]
}): void {
  const rows = input.trades.flatMap((trade) => {
    const row = tradeFromBacktest(trade, "", null, input.symbol)
    return row ? [row] : []
  })
  downloadText(
    `wick-${input.symbol}-${input.venue}.json`,
    JSON.stringify(
      {
        strategy: {
          name: input.name,
          market: input.venue,
          symbol: input.symbol,
          timeframe: input.timeframe,
          range: input.range,
          rule: input.rule,
          params: input.params,
          fee: input.fee,
          slippage: input.slippage,
          risk: input.risk,
        },
        run: {
          strategyId: null,
          range: input.range,
          metrics: input.metrics,
          createdAt: new Date().toISOString(),
          note: input.note.trim().slice(0, 280),
        },
        trades: rows,
      },
      null,
      2,
    ),
    "application/json",
  )
}

export function downloadBacktestCsv(symbol: string, trades: Trade[]): void {
  const rows = trades.flatMap((trade) => {
    const row = tradeFromBacktest(trade, "", null, symbol)
    return row ? [row] : []
  })
  downloadText(`wick-${symbol}-trades.csv`, tradesCsv(rows), "text/csv")
}

function tradeFromBacktest(trade: Trade, strategyId: string, runId: string | null, symbol: string): TradeRecord | null {
  const side = trade.side === "short" ? "short" : trade.side === "long" ? "long" : null
  if (!side) return null
  const open = trade.status === "open" || trade.exit_time == null
  return {
    id: crypto.randomUUID(),
    strategyId,
    runId,
    symbol,
    side,
    entryTime: trade.entry_time,
    entryPrice: trade.entry_price,
    exitTime: open ? null : trade.exit_time,
    exitPrice: open ? null : trade.exit_price,
    size: trade.quantity,
    fee: trade.fee_paid ?? 0,
    slippage: trade.slippage_paid ?? 0,
    pnl: open ? null : trade.pnl,
    returnPct: open ? null : trade.return_pct,
    mae: open || trade.mae == null || !Number.isFinite(trade.mae) ? null : trade.mae,
    mfe: open || trade.mfe == null || !Number.isFinite(trade.mfe) ? null : trade.mfe,
    note: "",
    strategyName: "",
    source: "desk",
    market: "spot",
    stop: null,
    r: null,
    riskMode: "NORMAL",
    ticketId: null,
  }
}

function sanitizeStrategy(value: unknown): StrategyRecord | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Partial<StrategyRecord>
  const symbol = asSymbol(typeof raw.symbol === "string" ? raw.symbol : "")
  const timeframe = typeof raw.timeframe === "string" && isTimeframe(raw.timeframe) ? raw.timeframe : null
  const range = typeof raw.range === "string" && isRange(raw.range) ? raw.range : "1Y"
  const rule = typeof raw.rule === "string" ? normalizeRule(raw.rule) : null
  if (!symbol || !timeframe || !rule) return null
  const market = isVenue(raw.market) ? raw.market : "spot"
  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id : crypto.randomUUID(),
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 48) : rule,
    market,
    symbol,
    timeframe,
    range,
    rule,
    params: ruleParams(rule, asParams(raw.params)),
    fee: clamp(raw.fee, 0, 1000, 10),
    slippage: clamp(raw.slippage, 0, 1000, 5),
    risk: clamp(raw.risk, 0.1, 5, 1),
    combo: normalizeCombo(raw.combo, rule).map((item) => ({ rule: item.rule, params: item.params })),
    capital: clamp(raw.capital, 1, 1_000_000_000, 10_000),
    leverage: market === "perp" ? clamp(raw.leverage, 1, 20, 3) : 1,
    allowShort: market === "perp" && raw.allowShort !== false,
    note: typeof raw.note === "string" ? raw.note.trim().slice(0, 280) : "",
  }
}

function sanitizeRun(value: unknown): RunRecord | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Partial<RunRecord> & { candles?: unknown; trades?: unknown }
  if (!raw.strategyId || typeof raw.strategyId !== "string") return null
  const range = typeof raw.range === "string" && isRange(raw.range) ? raw.range : null
  const metrics = asMetrics(raw.metrics)
  if (!range || !metrics) return null
  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id : crypto.randomUUID(),
    strategyId: raw.strategyId,
    range,
    metrics,
    createdAt: stamp(typeof raw.createdAt === "string" ? raw.createdAt : undefined),
    note: typeof raw.note === "string" ? raw.note.trim().slice(0, 280) : "",
    sample: asSample(raw.sample),
    costs: asCosts(raw.costs),
    paper: raw.paper === true,
    paperSince: typeof raw.paperSince === "string" && raw.paperSince ? raw.paperSince : null,
  }
}

function sanitizeTrade(value: unknown): TradeRecord | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Partial<TradeRecord>
  const symbol = asSymbol(typeof raw.symbol === "string" ? raw.symbol : "")
  const side = raw.side === "long" || raw.side === "short" ? raw.side : null
  const entryPrice = Number(raw.entryPrice)
  const size = Number(raw.size)
  if (!symbol || !side || !(entryPrice > 0) || !(size > 0)) return null
  const exitPrice = raw.exitPrice == null ? null : Number(raw.exitPrice) > 0 ? Number(raw.exitPrice) : null
  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id : crypto.randomUUID(),
    strategyId: typeof raw.strategyId === "string" ? raw.strategyId : "",
    runId: typeof raw.runId === "string" && raw.runId ? raw.runId : null,
    symbol,
    side,
    entryTime: stamp(typeof raw.entryTime === "string" ? raw.entryTime : undefined),
    entryPrice,
    exitTime: exitPrice == null ? null : stamp(typeof raw.exitTime === "string" ? raw.exitTime : undefined),
    exitPrice,
    size,
    fee: Number.isFinite(Number(raw.fee)) ? Number(raw.fee) : 0,
    slippage: Number.isFinite(Number(raw.slippage)) ? Number(raw.slippage) : 0,
    pnl: exitPrice == null || raw.pnl == null || !Number.isFinite(Number(raw.pnl)) ? null : Number(raw.pnl),
    returnPct: exitPrice == null || raw.returnPct == null || !Number.isFinite(Number(raw.returnPct)) ? null : Number(raw.returnPct),
    mae: finite(raw.mae),
    mfe: finite(raw.mfe),
    note: typeof raw.note === "string" ? raw.note.slice(0, 280) : "",
    strategyName: typeof raw.strategyName === "string" ? raw.strategyName.slice(0, 48) : "",
    source: raw.source === "paper" ? "paper" : raw.source === "bot" ? "bot" : "desk",
    ...tradeStamp(raw),
  }
}

function migrateLegacy(): void {
  if (typeof localStorage === "undefined") return
  const journal = readJson("wick-journal")
  const kept = readJson("wick-kept")
  const working = readJson("wick-working")
  if (!Array.isArray(journal) && !Array.isArray(kept) && !Array.isArray(working)) return
  absorbLegacy({ journal, kept, working })
  if (Array.isArray(journal)) {
    const alerts = journal.filter((item) => item && typeof item === "object" && (item as { kind?: string }).kind === "alert")
    if (alerts.length) localStorage.setItem("wick-alerts", JSON.stringify(alerts))
    localStorage.removeItem("wick-journal")
  }
  if (Array.isArray(working)) localStorage.removeItem("wick-working")
  if (Array.isArray(kept)) localStorage.removeItem("wick-kept")
}

function absorbLegacy(raw: { journal?: unknown; kept?: unknown; working?: unknown }): void {
  if (Array.isArray(raw.working)) {
    for (const item of raw.working) {
      const strategy = strategyFromLegacy(item)
      if (strategy) memory.strategies.set(strategy.id, strategy)
    }
  }
  if (Array.isArray(raw.kept)) {
    for (const item of raw.kept) {
      if (!item || typeof item !== "object") continue
      const source = item as Record<string, unknown>
      const strategy = strategyFromLegacy(source)
      const metrics = asMetrics(source.metrics)
      const range = typeof source.range === "string" && isRange(source.range) ? source.range : null
      if (!strategy || !metrics || !range) continue
      memory.strategies.set(strategy.id, strategy)
      const run: RunRecord = {
        id: typeof source.id === "string" && source.id.trim() ? `${source.id}-run` : crypto.randomUUID(),
        strategyId: strategy.id,
        range,
        metrics,
        createdAt: stamp(typeof source.time === "string" ? source.time : undefined),
        note: typeof source.note === "string" ? source.note.slice(0, 280) : "",
        sample: asSample(source.sample),
        costs: asCosts(source.costs),
        paper: false,
        paperSince: null,
      }
      memory.runs.set(run.id, run)
      const embedded = Array.isArray(source.trades) ? source.trades : []
      for (const trade of embedded) {
        const row = tradeFromBacktest(trade as Trade, strategy.id, run.id, strategy.symbol)
        if (row) memory.trades.set(row.id, row)
      }
    }
  }
  if (Array.isArray(raw.journal)) {
    for (const item of raw.journal) {
      if (!item || typeof item !== "object") continue
      if ((item as { kind?: string }).kind === "alert") continue
      const legacy = item as {
        symbol?: string
        side?: string
        price?: number
        exitPrice?: number | null
        size?: number
        note?: string
        strategy?: string
        time?: string
        venue?: string
      }
      const symbol = asSymbol(legacy.symbol ?? "")
      const side = asTradeSide(legacy.side ?? "")
      if (!symbol || !side || !(Number(legacy.price) > 0) || !(Number(legacy.size) > 0)) continue
      const strategy = legacy.strategy
        ? strategyFromLegacy({
            name: legacy.strategy,
            symbol,
            market: legacy.venue,
            timeframe: "1d",
            range: "1Y",
            rule: legacy.strategy,
            params: {},
          })
        : null
      if (strategy && !memory.strategies.has(strategy.id)) memory.strategies.set(strategy.id, strategy)
      const exitPrice = legacy.exitPrice != null && Number(legacy.exitPrice) > 0 ? Number(legacy.exitPrice) : null
      const entryPrice = Number(legacy.price)
      const size = Number(legacy.size)
      const move = exitPrice == null ? null : side === "long" ? exitPrice - entryPrice : entryPrice - exitPrice
      const trade: TradeRecord = {
        id: crypto.randomUUID(),
        strategyId: strategy?.id ?? "",
        runId: null,
        symbol,
        side,
        entryTime: stamp(legacy.time),
        entryPrice,
        exitTime: exitPrice == null ? null : stamp(legacy.time),
        exitPrice,
        size,
        fee: 0,
        slippage: 0,
        pnl: move == null ? null : move * size,
        returnPct: move == null ? null : (move / entryPrice) * 100,
        mae: null,
        mfe: null,
        note: typeof legacy.note === "string" ? legacy.note.slice(0, 280) : "",
        strategyName: typeof legacy.strategy === "string" ? legacy.strategy.slice(0, 48) : "",
        source: "desk",
        market: isVenue(legacy.venue) ? legacy.venue : "spot",
        stop: null,
        r: null,
        riskMode: "NORMAL",
        ticketId: null,
      }
      memory.trades.set(trade.id, trade)
    }
  }
}

function strategyFromLegacy(value: unknown): StrategyRecord | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Record<string, unknown>
  return sanitizeStrategy({
    id: raw.id,
    name: raw.name,
    symbol: raw.symbol,
    market: raw.market ?? raw.venue,
    timeframe: raw.timeframe,
    range: raw.range,
    rule: raw.rule,
    params: raw.params,
    combo: raw.combo,
    fee: raw.fee ?? raw.feeBps,
    slippage: raw.slippage ?? raw.slippageBps,
    risk: raw.risk ?? raw.riskPct,
    capital: raw.capital,
    leverage: raw.leverage,
    allowShort: raw.allowShort,
    note: raw.note,
  })
}

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as unknown) : null
  } catch {
    return null
  }
}

const DB_NAME = "wick-records"
const DB_VERSION = 3
const STORES = ["strategies", "runs", "trades", "tickets"] as const

function sanitizeTicket(value: unknown): WorkingTicket | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Partial<WorkingTicket>
  const symbol = asSymbol(typeof raw.symbol === "string" ? raw.symbol : "")
  const side = raw.side === "long" || raw.side === "short" ? raw.side : null
  const strategy = typeof raw.strategy === "string" ? raw.strategy.trim().slice(0, 48) : ""
  const entry = Number(raw.entry)
  const stop = Number(raw.stop)
  const size = Number(raw.size)
  const r = Number(raw.r)
  if (!symbol || !side || !strategy || !(entry > 0) || !(stop > 0) || !(size > 0) || !(r > 0)) return null
  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id : crypto.randomUUID(),
    symbol,
    market: raw.market === "perp" ? "perp" : "spot",
    side,
    strategy,
    entry,
    stop,
    size,
    r,
    riskMode: asRiskMode(raw.riskMode),
    session: isSessionLight(raw.session) ? raw.session : "open",
    armed: raw.armed === true,
    tradeId: typeof raw.tradeId === "string" && raw.tradeId ? raw.tradeId : null,
    createdAt: stamp(typeof raw.createdAt === "string" ? raw.createdAt : undefined),
    filledAt: typeof raw.filledAt === "string" && !Number.isNaN(Date.parse(raw.filledAt)) ? new Date(raw.filledAt).toISOString() : null,
  }
}

function asSample(value: unknown): RunSample | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Partial<RunSample>
  const inSample = asSlice(raw.inSample)
  const holdout = asSlice(raw.holdout)
  const windows = Array.isArray(raw.windows) ? raw.windows.map(asSlice).filter((item) => item != null) : []
  if (!inSample || !holdout || windows.length !== 3) return null
  return { inSample, holdout, windows }
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
    sharpe: finite(raw.sharpe),
    trades,
  }
}

function asCosts(value: unknown): RunCosts | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Partial<RunCosts>
  const beforeFees = Number(raw.beforeFees)
  const fees = Number(raw.fees)
  const slippage = Number(raw.slippage)
  const afterCosts = Number(raw.afterCosts)
  if (![beforeFees, fees, slippage, afterCosts].every(Number.isFinite)) return null
  return { beforeFees, fees, slippage, afterCosts }
}

function tradeStamp(raw: Partial<TradeRecord> & { venue?: unknown }): Pick<TradeRecord, "market" | "stop" | "r" | "riskMode" | "ticketId"> {
  return {
    market: isVenue(raw.market) ? raw.market : isVenue(raw.venue) ? raw.venue : "spot",
    stop: raw.stop != null && Number(raw.stop) > 0 ? Number(raw.stop) : null,
    r: raw.r != null && Number(raw.r) > 0 ? Number(raw.r) : null,
    riskMode: asRiskMode(raw.riskMode),
    ticketId: typeof raw.ticketId === "string" && raw.ticketId ? raw.ticketId : null,
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains("strategies")) db.createObjectStore("strategies", { keyPath: "id" })
      if (!db.objectStoreNames.contains("runs")) {
        const runs = db.createObjectStore("runs", { keyPath: "id" })
        runs.createIndex("strategyId", "strategyId", { unique: false })
      }
      if (!db.objectStoreNames.contains("trades")) {
        const trades = db.createObjectStore("trades", { keyPath: "id" })
        trades.createIndex("entryTime", "entryTime", { unique: false })
        trades.createIndex("runId", "runId", { unique: false })
        trades.createIndex("strategyId", "strategyId", { unique: false })
      }
      if (!db.objectStoreNames.contains("tickets")) db.createObjectStore("tickets", { keyPath: "id" })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function readDb(): Promise<Memory> {
  const db = await openDatabase()
  const next = createMemory()
  await readStore(db, "strategies", (value) => {
    const row = sanitizeStrategy(value)
    if (row) next.strategies.set(row.id, row)
  })
  await readStore(db, "runs", (value) => {
    const row = sanitizeRun(value)
    if (row) next.runs.set(row.id, row)
  })
  await readStore(db, "trades", (value) => {
    const row = sanitizeTrade(value)
    if (row) next.trades.set(row.id, row)
  })
  await readStore(db, "tickets", (value) => {
    const row = sanitizeTicket(value)
    if (row) next.tickets.set(row.id, row)
  })
  db.close()
  return next
}

function readStore(db: IDBDatabase, name: string, take: (value: unknown) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, "readonly")
    const request = tx.objectStore(name).openCursor()
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      take(cursor.value)
      cursor.continue()
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function searchDb(query: TradeQuery): Promise<TradePage> {
  const db = await openDatabase()
  const page = await new Promise<TradePage>((resolve, reject) => {
    const tx = db.transaction("trades", "readonly")
    const index = tx.objectStore("trades").index("entryTime")
    const request = index.openCursor(null, "prev")
    const rows: TradeRecord[] = []
    const samples: Array<{ pnl: number; return_pct: number; status: string }> = []
    let total = 0
    let closed = 0
    let open = 0
    const start = Math.max(0, query.page) * PAGE_SIZE
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      const trade = sanitizeTrade(cursor.value)
      if (trade && tradeMatches(trade, query)) {
        if (total >= start && rows.length < PAGE_SIZE) rows.push(trade)
        total += 1
        if (trade.exitTime == null) open += 1
        else closed += 1
        samples.push({
          pnl: trade.pnl == null ? Number.NaN : trade.pnl,
          return_pct: trade.returnPct == null ? Number.NaN : trade.returnPct,
          status: trade.exitTime == null ? "open" : "closed",
        })
      }
      cursor.continue()
    }
    tx.oncomplete = () =>
      resolve({
        rows,
        total,
        closed,
        open,
        profitFactor: profitFactor(samples),
        expectancy: tradeExpectancy(samples),
      })
    tx.onerror = () => reject(tx.error)
  })
  db.close()
  return page
}

async function writeDb(source: Memory): Promise<void> {
  const db = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([...STORES], "readwrite")
    for (const name of STORES) tx.objectStore(name).clear()
    for (const row of source.strategies.values()) tx.objectStore("strategies").put(stripRun(row))
    for (const row of source.runs.values()) tx.objectStore("runs").put(row)
    for (const row of source.trades.values()) tx.objectStore("trades").put(row)
    for (const row of source.tickets.values()) tx.objectStore("tickets").put(row)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

function stripRun<T>(row: T): T {
  return row
}

async function persistAll(): Promise<void> {
  if (hasIndexedDb()) await writeDb(memory)
}

async function persistOne(store: (typeof STORES)[number], row: { id: string }): Promise<void> {
  if (!hasIndexedDb()) return
  const db = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, "readwrite")
    tx.objectStore(store).put(row)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

async function deleteDbKey(store: "trades", id: string): Promise<void> {
  const db = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, "readwrite")
    tx.objectStore(store).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

function asMetrics(value: unknown): RunMetrics | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Partial<RunMetrics>
  const total = Number(raw.total_return_pct)
  const drawdown = Number(raw.max_drawdown_pct)
  const equity = Number(raw.final_equity)
  const trades = Number(raw.trades)
  if (!Number.isFinite(total) || !Number.isFinite(drawdown) || !Number.isFinite(equity) || !Number.isFinite(trades)) return null
  return {
    total_return_pct: total,
    cagr_pct: finite(raw.cagr_pct),
    max_drawdown_pct: drawdown,
    sharpe: finite(raw.sharpe),
    win_rate_pct: finite(raw.win_rate_pct),
    profit_factor: finite(raw.profit_factor),
    expectancy: finite(raw.expectancy),
    trades,
    final_equity: equity,
  }
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

function sameParams(left: RunParams, right: RunParams): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const key of keys) if (left[key] !== right[key]) return false
  return true
}

function sameSetup(left: StrategyRecord, right: StrategyRecord): boolean {
  return (
    left.symbol === right.symbol &&
    left.market === right.market &&
    left.timeframe === right.timeframe &&
    left.rule === right.rule &&
    left.fee === right.fee &&
    left.slippage === right.slippage &&
    left.risk === right.risk &&
    sameParams(left.params, right.params)
  )
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

function asTradeSide(value: string): TradeSide | null {
  const side = value.trim().toLowerCase()
  if (side === "buy" || side === "long") return "long"
  if (side === "sell" || side === "short") return "short"
  return null
}

function stamp(value: string | undefined): string {
  if (value && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString()
  return new Date().toISOString()
}

function finite(value: unknown): number | null {
  if (value == null) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

function csv(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`
  return value
}
