import type { MarketId, Run, RunParams, RuleId, TapeCandle, Timeframe } from "@/lib/types"

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
}

export type RuleSpec = {
  id: RuleId
  name: string
  summary: string
  params: ParamField[]
}

export const MARKETS: { id: MarketId; base: string; name: string }[] = [
  { id: "BTC-USD", base: "BTC", name: "Bitcoin" },
  { id: "ETH-USD", base: "ETH", name: "Ethereum" },
  { id: "SOL-USD", base: "SOL", name: "Solana" },
  { id: "XRP-USD", base: "XRP", name: "XRP" },
  { id: "DOGE-USD", base: "DOGE", name: "Dogecoin" },
  { id: "AVAX-USD", base: "AVAX", name: "Avalanche" },
  { id: "LINK-USD", base: "LINK", name: "Chainlink" },
  { id: "LTC-USD", base: "LTC", name: "Litecoin" },
  { id: "ADA-USD", base: "ADA", name: "Cardano" },
]

const period = (key: string, label: string, min: number, max: number, fallback: number): ParamField => ({
  key,
  label,
  min,
  max,
  step: 1,
  default: fallback,
  integer: true,
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
    summary: "Long when the fast simple average is above the slow one. Flat again when it falls back underneath.",
    params: [period("fast", "Fast period", 2, 200, 20), period("slow", "Slow period", 3, 400, 50)],
  },
  {
    id: "ema_cross",
    name: "EMA crossover",
    summary: "Same cross as the simple averages, but recent closes count for more than old ones.",
    params: [period("fast", "Fast period", 2, 200, 12), period("slow", "Slow period", 3, 400, 26)],
  },
  {
    id: "rsi_reversion",
    name: "RSI reversion",
    summary: "Buy a stretch below the oversold line. Leave it once the reading pushes through overbought.",
    params: [
      period("period", "RSI period", 2, 100, 14),
      { key: "oversold", label: "Oversold", min: 5, max: 50, step: 1, default: 30, integer: false },
      { key: "overbought", label: "Overbought", min: 50, max: 95, step: 1, default: 70, integer: false },
    ],
  },
  {
    id: "bollinger",
    name: "Bollinger bounce",
    summary: "Buy a close under the lower band. Exit when price gets back to the middle band.",
    params: [
      period("period", "Period", 5, 200, 20),
      { key: "mult", label: "Band width", min: 0.5, max: 4, step: 0.1, default: 2, integer: false },
    ],
  },
  {
    id: "macd",
    name: "MACD cross",
    summary: "Long when the MACD line is above its signal line. The signal line is a moving average of the MACD itself.",
    params: [
      period("fast", "Fast EMA", 2, 100, 12),
      period("slow", "Slow EMA", 3, 200, 26),
      period("signal", "Signal", 2, 50, 9),
    ],
  },
  {
    id: "donchian",
    name: "Donchian breakout",
    summary: "Buy a close through the prior high. Get out on a close through the shorter trailing low.",
    params: [period("entry", "Entry window", 2, 200, 20), period("exit", "Exit window", 1, 200, 10)],
  },
]

export const TIMEFRAMES: { id: Timeframe; label: string; phrase: string }[] = [
  { id: "1m", label: "1m", phrase: "1-minute" },
  { id: "5m", label: "5m", phrase: "5-minute" },
  { id: "30m", label: "30m", phrase: "30-minute" },
  { id: "1d", label: "1D", phrase: "daily" },
]

export const RUN_COLORS = ["#e4b15a", "#7dcea0", "#d07a6a", "#8eb4d4", "#c9a0dc"] as const

export type DeskState = {
  runs: Run[]
  selectedId: string
  timeframe: Timeframe
  paused: boolean
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

export function marketById(symbol: string): { id: MarketId; base: string; name: string } | undefined {
  return MARKETS.find((item) => item.id === symbol)
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
  if ((spec.id === "sma_cross" || spec.id === "ema_cross" || spec.id === "macd") && resolved.fast! >= resolved.slow!) {
    throw new Error("The fast period has to be shorter than the slow period.")
  }
  if (spec.id === "rsi_reversion" && resolved.oversold! >= resolved.overbought!) {
    throw new Error("Oversold has to sit below overbought.")
  }
  if (spec.id === "donchian" && resolved.exit! > resolved.entry!) {
    throw new Error("The exit window should be shorter than or equal to the entry window.")
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

export function suggestedName(rule: RuleId, params: RunParams): string {
  const fast = params.fast ?? 20
  const slow = params.slow ?? 50
  if (rule === "sma_cross") return `SMA ${fast}/${slow}`
  if (rule === "ema_cross") return `EMA ${fast}/${slow}`
  if (rule === "rsi_reversion") return `RSI ${params.period ?? 14}`
  if (rule === "bollinger") return `Bollinger ${params.period ?? 20}`
  if (rule === "macd") return `MACD ${fast}/${slow}`
  if (rule === "donchian") return `Donchian ${params.entry ?? 20}/${params.exit ?? 10}`
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
  const params = { ...defaultParams(), ...partial?.params }
  const rule = partial?.rule ?? "sma_cross"
  return {
    id: crypto.randomUUID(),
    name: partial?.name ?? uniqueName(suggestedName(rule, params), existing),
    symbol: partial?.symbol ?? "BTC-USD",
    rule,
    params,
    feeBps: partial?.feeBps ?? 10,
    hidden: partial?.hidden ?? false,
  }
}

export function defaultDesk(): DeskState {
  const run = createRun({ name: "SMA 20/50" })
  return { runs: [run], selectedId: run.id, timeframe: "1d", paused: false }
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
    return { runs: trimmed, selectedId, timeframe, paused: Boolean(parsed.paused) }
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
  return timeframe === "30m" || timeframe === "1d" ? 60_000 : 30_000
}

export function fingerprint(run: Run): string {
  const spec = ruleById(normalizeRule(run.rule))
  const fields = (spec?.params ?? []).map((param) => `${param.key}:${run.params[param.key] ?? param.default}`)
  return [run.symbol, normalizeRule(run.rule), fields.join(","), run.feeBps].join("|")
}

function sanitizeRun(value: unknown): Run | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Partial<Run>
  if (typeof raw.id !== "string" || !raw.id) return null
  const symbol = marketById(String(raw.symbol))?.id ?? "BTC-USD"
  const rule = normalizeRule(String(raw.rule ?? "sma_cross"))
  return {
    id: raw.id,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 48) : suggestedName(rule, defaultParams()),
    symbol,
    rule,
    params: sanitizeParams(raw.params),
    feeBps: clampInt(raw.feeBps, 0, 1000, 10),
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

function isTimeframe(value: unknown): value is Timeframe {
  return value === "1m" || value === "5m" || value === "30m" || value === "1d"
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
