import { getMarkets, marketName, normalizeSymbol } from "./markets.ts"
import type { MarketId, RangeId, Run, RunParams, RuleId, TapeCandle, Timeframe, Venue } from "./types.ts"

export const STORAGE_KEY = "wick-runs"
export const MAX_RUNS = 5

export type ParamField = {
  key: string
  label: string
  min: number
  max: number
  step: number
  default: number
  integer: boolean
  toggle?: boolean
}

export type RuleSpec = {
  id: RuleId
  name: string
  summary: string
  params: ParamField[]
}

const period = (key: string, label: string, min: number, max: number, fallback: number): ParamField => ({
  key,
  label,
  min,
  max,
  step: 1,
  default: fallback,
  integer: true,
})

const scale = (key: string, label: string, min: number, max: number, step: number, fallback: number): ParamField => ({
  key,
  label,
  min,
  max,
  step,
  default: fallback,
  integer: false,
})

const toggle = (key: string, label: string): ParamField => ({
  key,
  label,
  min: 0,
  max: 1,
  step: 1,
  default: 0,
  integer: true,
  toggle: true,
})

export const RULES: RuleSpec[] = [
  {
    id: "buy_hold",
    name: "Buy and hold",
    summary: "Stay long the whole window. This is the baseline every other rule has to beat.",
    params: [],
  },
  {
    id: "sma_cross",
    name: "SMA crossover",
    summary: "Long when the fast simple average is above the slow one. Short when it falls back underneath.",
    params: [period("fast", "Fast", 2, 200, 20), period("slow", "Slow", 3, 400, 50)],
  },
  {
    id: "ema_cross",
    name: "EMA crossover",
    summary: "Same cross as the simple averages, but recent closes count for more. Short when the fast average drops under the slow one.",
    params: [period("fast", "Fast", 2, 200, 12), period("slow", "Slow", 3, 400, 26)],
  },
  {
    id: "donchian",
    name: "Donchian breakout",
    summary: "Long on a close through the entry channel high. Short on a close through the entry channel low. The shorter exit channel takes the position off before the opposite break.",
    params: [period("entry", "Entry channel", 2, 200, 20), period("exit", "Exit channel", 1, 200, 10)],
  },
  {
    id: "tsmom",
    name: "Time-series momentum",
    summary: "Long when the lookback return, measured through the prior bar, is positive. Short when that return is negative.",
    params: [period("lookback", "Lookback", 1, 400, 20)],
  },
  {
    id: "bollinger",
    name: "Bollinger mean reversion",
    summary: "Long on a close under the lower band, short on a close over the upper band, and flat back at the middle. The RSI filter, when on, requires a 14-bar RSI at 30 or below to buy and at 70 or above to short.",
    params: [
      period("period", "Length", 5, 200, 20),
      scale("mult", "Standard deviations", 0.5, 4, 0.1, 2),
      toggle("rsiOn", "RSI filter"),
    ],
  },
  {
    id: "bb_break",
    name: "Bollinger breakout",
    summary: "Long on a close through the upper band. Short on a close through the lower band. Flat when price returns through the middle band.",
    params: [period("period", "Length", 5, 200, 20), scale("mult", "Standard deviations", 0.5, 4, 0.1, 2)],
  },
  {
    id: "rsi_reversion",
    name: "RSI reversal",
    summary: "Long when RSI touches oversold. Short when it reaches overbought.",
    params: [
      period("period", "Length", 2, 100, 14),
      scale("oversold", "Oversold", 5, 50, 1, 30),
      scale("overbought", "Overbought", 50, 95, 1, 70),
    ],
  },
  {
    id: "macd",
    name: "MACD trend",
    summary: "Long when the MACD line is above its signal, short when it is below. Flat when the cross fails or the close breaks an ATR trail off the extreme since entry.",
    params: [
      period("fast", "Fast", 2, 100, 12),
      period("slow", "Slow", 3, 200, 26),
      period("signal", "Signal", 2, 50, 9),
      period("atr", "ATR length", 2, 100, 14),
      scale("mult", "ATR multiple", 0.5, 10, 0.1, 3),
    ],
  },
  {
    id: "keltner",
    name: "Keltner breakout",
    summary: "Long on a close through the upper Keltner band, an EMA plus ATR. Short through the lower band. Flat back through the EMA.",
    params: [
      period("period", "EMA length", 2, 200, 20),
      period("atr", "ATR length", 2, 100, 14),
      scale("mult", "Multiple", 0.5, 10, 0.1, 2),
    ],
  },
  {
    id: "supertrend",
    name: "Supertrend",
    summary: "Long while the Supertrend line is under price. Short while the line is above price.",
    params: [period("atr", "ATR length", 2, 100, 10), scale("mult", "Multiple", 0.5, 10, 0.1, 3)],
  },
  {
    id: "orb",
    name: "Opening-range breakout",
    summary: "The first bars of each UTC day set the range. Long on a later close through that high, short through that low, and flat at the next day.",
    params: [period("bars", "Range bars", 1, 48, 6)],
  },
  {
    id: "prev_day",
    name: "Previous-day break",
    summary: "Long on a close through the prior UTC day's high. Short on a close through that day's low.",
    params: [],
  },
  {
    id: "gap_fade",
    name: "Gap fade",
    summary: "Long after a UTC-day gap down of at least the minimum, short after a gap up. Flat when the gap fills or the session ends.",
    params: [scale("gap", "Minimum gap %", 0.05, 20, 0.05, 0.5)],
  },
  {
    id: "gap_go",
    name: "Gap continuation",
    summary: "Long after a UTC-day gap up of at least the minimum, short after a gap down. Flat at the next session.",
    params: [scale("gap", "Minimum gap %", 0.05, 20, 0.05, 0.5)],
  },
  {
    id: "vwap",
    name: "VWAP reclaim",
    summary: "Session VWAP resets each UTC day. Long when the close is above it, short when the close is below it.",
    params: [],
  },
  {
    id: "chandelier",
    name: "ATR chandelier",
    summary: "Long after a close crosses above the trend EMA, short after a close crosses below it. Flat on a close through the 22-bar ATR chandelier, or back through the EMA.",
    params: [period("period", "Trend EMA", 2, 400, 50), scale("mult", "ATR multiple", 0.5, 10, 0.1, 3)],
  },
  {
    id: "dual_ma",
    name: "Dual moving average",
    summary: "Long when the fast average is above the slow one and price is above a longer filter average. Short when both the cross and the filter point down. That filter stands in for a higher timeframe.",
    params: [
      period("fast", "Fast", 2, 200, 20),
      period("slow", "Slow", 3, 400, 50),
      period("filter", "Filter length", 4, 600, 200),
    ],
  },
]

export const TIMEFRAMES: { id: Timeframe; label: string; phrase: string }[] = [
  { id: "1m", label: "1m", phrase: "1-minute" },
  { id: "3m", label: "3m", phrase: "3-minute" },
  { id: "5m", label: "5m", phrase: "5-minute" },
  { id: "15m", label: "15m", phrase: "15-minute" },
  { id: "30m", label: "30m", phrase: "30-minute" },
  { id: "1h", label: "1h", phrase: "1-hour" },
  { id: "4h", label: "4h", phrase: "4-hour" },
  { id: "1d", label: "1D", phrase: "daily" },
]

export const RANGES: { id: RangeId; label: string; days: number }[] = [
  { id: "1D", label: "1 day", days: 1 },
  { id: "5D", label: "5D", days: 5 },
  { id: "1M", label: "1M", days: 31 },
  { id: "3M", label: "3M", days: 92 },
  { id: "1Y", label: "1Y", days: 366 },
  { id: "2Y", label: "2Y", days: 732 },
  { id: "4Y", label: "4Y", days: 1464 },
  { id: "6Y", label: "6Y", days: 2196 },
  { id: "All", label: "All", days: 0 },
]

export const RUN_COLORS = ["#c56a32", "#b8860b", "#c45c3e", "#8a5a44", "#3c2a22"] as const

export type DeskState = {
  runs: Run[]
  selectedId: string
  timeframe: Timeframe
  range: RangeId
  venue: Venue
  enlarged: boolean
}

export function runColor(index: number): string {
  return RUN_COLORS[index % RUN_COLORS.length] ?? RUN_COLORS[0]
}

export function ruleById(rule: string): RuleSpec | undefined {
  return RULES.find((item) => item.id === rule)
}

export function normalizeRule(rule: string): RuleId {
  if (rule === "rsi") return "rsi_reversion"
  return ruleById(rule)?.id ?? "sma_cross"
}

export function marketById(symbol: string, venue: Venue = "spot"): { id: MarketId; base: string; name: string; tickSize?: string } | undefined {
  const id = normalizeSymbol(symbol)
  if (!id) return undefined
  const known = getMarkets(venue).find((market) => market.id === id)
  const base = known?.base ?? id.replace(/USDT$/, "")
  return { id, base, name: marketName(base), tickSize: known?.tickSize }
}

export function defaultParams(): RunParams {
  const params: RunParams = {}
  for (const rule of RULES) {
    for (const param of rule.params) params[param.key] = param.default
  }
  return params
}

export function paramsForRule(rule: RuleId, current: RunParams = defaultParams()): RunParams {
  const spec = ruleById(rule)
  const params = { ...current }
  for (const param of spec?.params ?? []) params[param.key] = param.default
  return params
}

export function resolveRunParams(run: Run): RunParams {
  const spec = ruleById(normalizeRule(run.rule))
  if (!spec) throw new Error(`Unknown strategy: ${run.rule}.`)
  const resolved: RunParams = {}
  for (const param of spec.params) {
    const number = Number(run.params[param.key] ?? param.default)
    if (!Number.isFinite(number)) throw new Error(`${param.label} needs to be a number.`)
    const value = param.integer ? Math.round(number) : number
    if (value < param.min || value > param.max) {
      throw new Error(`${param.label} has to sit between ${param.min} and ${param.max}.`)
    }
    resolved[param.key] = value
  }
  if ((spec.id === "sma_cross" || spec.id === "ema_cross" || spec.id === "macd" || spec.id === "dual_ma") && resolved.fast! >= resolved.slow!) {
    throw new Error("The fast period has to be shorter than the slow period.")
  }
  if (spec.id === "dual_ma" && resolved.filter! <= resolved.slow!) {
    throw new Error("The filter has to be longer than the slow period.")
  }
  if (spec.id === "rsi_reversion" && resolved.oversold! >= resolved.overbought!) {
    throw new Error("Oversold has to sit below overbought.")
  }
  if (spec.id === "donchian" && resolved.exit! > resolved.entry!) {
    throw new Error("The exit channel has to be shorter than or equal to the entry channel.")
  }
  return resolved
}

export function runProblem(run: Run): string | null {
  try {
    resolveRunParams(run)
    return null
  } catch (reason: unknown) {
    return reason instanceof Error ? reason.message : "This run didn't compute."
  }
}

export function ruleName(rule: string): string {
  return ruleById(rule)?.name ?? rule
}

export function suggestedName(rule: RuleId, params: RunParams): string {
  const fast = params.fast ?? 20
  const slow = params.slow ?? 50
  if (rule === "sma_cross") return `SMA ${fast}/${slow}`
  if (rule === "ema_cross") return `EMA ${fast}/${slow}`
  if (rule === "donchian") return `Donchian ${params.entry ?? 20}/${params.exit ?? 10}`
  if (rule === "tsmom") return `TSMOM ${params.lookback ?? 20}`
  if (rule === "bollinger") return `BB revert ${params.period ?? 20}`
  if (rule === "bb_break") return `BB break ${params.period ?? 20}`
  if (rule === "rsi_reversion") return `RSI ${params.period ?? 14}`
  if (rule === "macd") return `MACD ${fast}/${slow}`
  if (rule === "keltner") return `Keltner ${params.period ?? 20}`
  if (rule === "supertrend") return `Supertrend ${params.atr ?? 10}`
  if (rule === "orb") return `ORB ${params.bars ?? 6}`
  if (rule === "prev_day") return "Prior day"
  if (rule === "gap_fade") return `Gap fade ${params.gap ?? 0.5}`
  if (rule === "gap_go") return `Gap go ${params.gap ?? 0.5}`
  if (rule === "vwap") return "VWAP reclaim"
  if (rule === "chandelier") return `Chandelier ${params.period ?? 50}`
  if (rule === "dual_ma") return `Dual MA ${fast}/${slow}`
  return "Buy and hold"
}

export function uniqueName(base: string, runs: Run[]): string {
  const taken = new Set(runs.map((run) => run.name))
  if (!taken.has(base)) return base
  for (let index = 2; index < 20; index += 1) {
    const next = `${base} ${index}`
    if (!taken.has(next)) return next
  }
  return `${base} ${Math.random().toString(36).slice(2, 6)}`
}

export function createRun(partial?: Partial<Run>, existing: Run[] = []): Run {
  const rule = partial?.rule ?? "sma_cross"
  const params = { ...defaultParams(), ...partial?.params }
  for (const param of ruleById(rule)?.params ?? []) {
    if (partial?.params?.[param.key] == null) params[param.key] = param.default
  }
  return {
    id: crypto.randomUUID(),
    name: partial?.name ?? uniqueName(suggestedName(rule, params), existing),
    symbol: partial?.symbol ?? "BTCUSDT",
    rule,
    params,
    feeBps: partial?.feeBps ?? 10,
    capital: clampNum(partial?.capital, 1, 1_000_000_000, 10_000),
    leverage: clampNum(partial?.leverage, 1, 20, 3),
    allowShort: partial?.allowShort !== false,
    hidden: partial?.hidden ?? false,
  }
}

export function rangeDays(range: RangeId): number {
  return RANGES.find((item) => item.id === range)?.days ?? 0
}

export function phraseFor(interval: string): string {
  return TIMEFRAMES.find((item) => item.id === interval)?.phrase ?? interval
}

export function barsLabel(interval: string, count: number): string {
  const label = TIMEFRAMES.find((item) => item.id === interval)?.label ?? interval
  return `${count.toLocaleString("en-US")} ${label} bars`
}

export function windowNote(range: RangeId, tape: { interval: string; candles: { t: number }[] }): string | null {
  const candles = tape.candles
  if (candles.length < 2) return null
  const span = candles[candles.length - 1]!.t - candles[0]!.t
  const loadedDays = Math.max(1, Math.round(span / 86_400))
  const requested = rangeDays(range)
  const phrase = phraseFor(tape.interval)
  const shortOfRange = requested > 5 && span < (requested - 2) * 86_400
  const shortAll = requested === 0 && tape.interval !== "1d" && span < 365 * 3 * 86_400
  if (!shortOfRange && !shortAll) return null
  return `Deepest window · ${loadedDays}d of ${phrase}`
}

export function defaultDesk(): DeskState {
  const run = createRun({ name: "SMA 20/50" })
  return { runs: [run], selectedId: run.id, timeframe: "1d", range: "All", venue: "spot", enlarged: false }
}

export function loadDesk(): DeskState {
  const storage = readStorage()
  if (!storage) return defaultDesk()
  try {
    const parsed = JSON.parse(storage) as Partial<DeskState> & { v?: number }
    const runs = Array.isArray(parsed.runs) ? parsed.runs.map(sanitizeRun).filter((run) => run != null) : []
    if (runs.length === 0) return defaultDesk()
    const trimmed = runs.slice(0, MAX_RUNS)
    const selectedId = trimmed.some((run) => run.id === parsed.selectedId) ? String(parsed.selectedId) : trimmed[0]!.id
    const timeframe = isTimeframe(parsed.timeframe) ? parsed.timeframe : "1d"
    const range = isRange(parsed.range) ? parsed.range : "All"
    const venue = isVenue(parsed.venue) ? parsed.venue : "spot"
    return {
      runs: trimmed,
      selectedId,
      timeframe,
      range,
      venue,
      enlarged: Boolean(parsed.enlarged),
    }
  } catch {
    return defaultDesk()
  }
}

export function saveDesk(desk: DeskState): void {
  const storage = browserStorage()
  if (!storage) return
  storage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, ...desk }))
}

export function mergeCandles(existing: TapeCandle[], incoming: TapeCandle[]): TapeCandle[] {
  const byTime = new Map<number, TapeCandle>()
  for (const candle of existing) byTime.set(candle.t, candle)
  for (const candle of incoming) byTime.set(candle.t, candle)
  return [...byTime.values()].sort((left, right) => left.t - right.t)
}

export function pollIntervalMs(timeframe: Timeframe): number {
  return timeframe === "1m" || timeframe === "3m" || timeframe === "5m" || timeframe === "15m" ? 30_000 : 60_000
}

export function fingerprint(run: Run): string {
  const spec = ruleById(normalizeRule(run.rule))
  const fields = (spec?.params ?? []).map((param) => `${param.key}:${run.params[param.key] ?? param.default}`)
  return [run.symbol, normalizeRule(run.rule), fields.join(","), run.feeBps, run.capital, run.allowShort ? "short" : "flat", run.leverage].join("|")
}

function sanitizeRun(value: unknown): Run | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Partial<Run>
  if (typeof raw.id !== "string" || !raw.id) return null
  const symbol = normalizeSymbol(String(raw.symbol ?? "")) ?? "BTCUSDT"
  const rule = normalizeRule(String(raw.rule ?? "sma_cross"))
  return {
    id: raw.id,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 48) : suggestedName(rule, defaultParams()),
    symbol,
    rule,
    params: sanitizeParams(raw.params),
    feeBps: clampInt(raw.feeBps, 0, 1000, 10),
    capital: clampNum(raw.capital, 1, 1_000_000_000, 10_000),
    leverage: clampNum(raw.leverage, 1, 20, 3),
    allowShort: raw.allowShort !== false,
    hidden: Boolean(raw.hidden),
  }
}

function sanitizeParams(value: unknown): RunParams {
  const params = defaultParams()
  if (!value || typeof value !== "object") return params
  const source = { ...(value as Record<string, unknown>) }
  if (source.period == null && source.rsi != null) source.period = source.rsi
  for (const rule of RULES) {
    for (const param of rule.params) {
      if (source[param.key] == null) continue
      params[param.key] = param.integer
        ? clampInt(source[param.key], param.min, param.max, param.default)
        : clampNum(source[param.key], param.min, param.max, param.default)
    }
  }
  return params
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

function clampNum(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

export function isTimeframe(value: unknown): value is Timeframe {
  return TIMEFRAMES.some((item) => item.id === value)
}

export function isRange(value: unknown): value is RangeId {
  return RANGES.some((item) => item.id === value)
}

export function isVenue(value: unknown): value is Venue {
  return value === "spot" || value === "perp"
}

function browserStorage(): Storage | null {
  if (typeof localStorage === "undefined") return null
  return localStorage
}

function readStorage(): string | null {
  try {
    return browserStorage()?.getItem(STORAGE_KEY) ?? null
  } catch {
    return null
  }
}
