import type { MarketId, Run, RunParams, RuleId, TapeCandle, Timeframe } from "@/lib/types"

export const STORAGE_KEY = "wick-runs"
export const MAX_RUNS = 5

export const MARKETS: { id: MarketId; base: string; name: string }[] = [
  { id: "BTC-USD", base: "BTC", name: "Bitcoin" },
  { id: "ETH-USD", base: "ETH", name: "Ethereum" },
]

export const RULES: { id: RuleId; name: string; summary: string }[] = [
  {
    id: "sma_cross",
    name: "SMA crossover",
    summary: "Long when the fast simple average closes above the slow one. Flat again when it falls back.",
  },
  {
    id: "rsi",
    name: "RSI reversion",
    summary: "Buy a stretch at or below 30. Leave it once the reading pushes through 70.",
  },
  {
    id: "buy_hold",
    name: "Buy and hold",
    summary: "Stay long the whole window. This is the baseline every other rule has to beat.",
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

export function defaultParams(): RunParams {
  return { fast: 20, slow: 50, rsi: 14 }
}

export function suggestedName(rule: RuleId, params: RunParams): string {
  if (rule === "sma_cross") return `SMA ${params.fast}/${params.slow}`
  if (rule === "rsi") return `RSI ${params.rsi}`
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
  return [run.symbol, run.rule, run.params.fast, run.params.slow, run.params.rsi, run.feeBps].join("|")
}

function sanitizeRun(value: unknown): Run | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Partial<Run>
  if (typeof raw.id !== "string" || !raw.id) return null
  const symbol: MarketId = raw.symbol === "ETH-USD" ? "ETH-USD" : "BTC-USD"
  const rule: RuleId = raw.rule === "rsi" || raw.rule === "buy_hold" ? raw.rule : "sma_cross"
  const params = raw.params ?? defaultParams()
  return {
    id: raw.id,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 48) : suggestedName(rule, defaultParams()),
    symbol,
    rule,
    params: {
      fast: clampInt(params.fast, 2, 200, 20),
      slow: clampInt(params.slow, 3, 400, 50),
      rsi: clampInt(params.rsi, 2, 100, 14),
    },
    feeBps: clampInt(raw.feeBps, 0, 1000, 10),
    hidden: Boolean(raw.hidden),
  }
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
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
