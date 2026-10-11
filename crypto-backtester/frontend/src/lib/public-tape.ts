import { krakenProduct } from "@/lib/book"
import { barSeconds } from "@/lib/forming"
import type { MarketId, RangeId, Tape, TapeCandle, Timeframe, Venue } from "@/lib/types"

const BINANCE_KLINES = "https://data-api.binance.vision/api/v3/klines"
const KRAKEN_CHARTS = "https://futures.kraken.com/api/charts/v1/trade"
const KLINE_LIMIT = 1000
const PAGE_BATCH = 4
const MAX_WINDOWS = 60
const KRAKEN_PAGES = 40
const DAY = 86_400

/** Coinbase bar size used by the desk's history cap. Finer bars share a page budget. */
const COINBASE_SECONDS: Record<string, number> = {
  "1m": 60,
  "3m": 60,
  "5m": 300,
  "15m": 900,
  "30m": 300,
  "1h": 3_600,
  "4h": 3_600,
  "1d": 86_400,
}

const KRAKEN_RESOLUTION: Record<string, string> = {
  "1m": "1m",
  "3m": "1m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1h",
  "4h": "4h",
  "1d": "1d",
}

const KRAKEN_NATIVE: Record<string, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "30m": 1_800,
  "1h": 3_600,
  "4h": 14_400,
  "1d": 86_400,
}

/** Same window the desk asks Binance or Kraken for. Zero days is the longest tape that bar size carries. */
export function publicSpanDays(interval: string, days: number | null | undefined): number {
  const seconds = barSeconds(interval)
  const source = COINBASE_SECONDS[interval] ?? seconds
  let cap = Math.max(1, Math.floor((160 * 279 * source) / DAY))
  if (seconds >= DAY) cap = 365 * 12
  const span = days == null ? cap : days <= 0 ? cap : Math.max(1, Math.min(days, cap))
  if (seconds < 3_600 || !days || days <= 0) return span
  return Math.max(1, Math.min(days, 365 * 12))
}

export function periodsPerYear(interval: string): number {
  const seconds = barSeconds(interval)
  if (seconds <= 0) return 365
  return Math.round((365 * DAY) / seconds)
}

export function klineCandle(row: unknown): TapeCandle | null {
  if (!Array.isArray(row) || row.length < 6) return null
  const open = Number(row[1])
  const high = Number(row[2])
  const low = Number(row[3])
  const close = Number(row[4])
  const volume = Number(row[5])
  const stamp = Math.floor(Number(row[0]) / 1000)
  if (![open, high, low, close, volume, stamp].every(Number.isFinite)) return null
  if (Math.min(open, high, low, close) <= 0 || high < low) return null
  return { t: stamp, time: isoStamp(stamp), open, high, low, close, volume }
}

export function chartCandle(item: unknown): TapeCandle | null {
  if (!item || typeof item !== "object") return null
  const row = item as Record<string, unknown>
  const open = Number(row.open)
  const high = Number(row.high)
  const low = Number(row.low)
  const close = Number(row.close)
  const volume = Number(row.volume)
  const stamp = Math.floor(Number(row.time) / 1000)
  if (![open, high, low, close, volume, stamp].every(Number.isFinite)) return null
  if (Math.min(open, high, low, close) <= 0 || high < low) return null
  return { t: stamp, time: isoStamp(stamp), open, high, low, close, volume }
}

/** Bundle smaller bars into aligned buckets. Incomplete buckets in the middle are dropped. */
export function resampleCandles(candles: TapeCandle[], targetSeconds: number, sourceSeconds: number): TapeCandle[] {
  if (candles.length === 0 || targetSeconds < sourceSeconds || sourceSeconds <= 0) return candles.slice()
  const expected = Math.floor(targetSeconds / sourceSeconds)
  const grouped = new Map<number, TapeCandle[]>()
  const order: number[] = []
  for (const candle of candles) {
    const bucket = candle.t - (candle.t % targetSeconds)
    const group = grouped.get(bucket)
    if (!group) {
      grouped.set(bucket, [candle])
      order.push(bucket)
    } else {
      group.push(candle)
    }
  }
  const bundled: TapeCandle[] = []
  order.forEach((bucket, index) => {
    const group = grouped.get(bucket) ?? []
    if (group.length < expected && index !== order.length - 1) return
    const first = group[0]
    const last = group[group.length - 1]
    if (!first || !last) return
    bundled.push({
      t: bucket,
      time: isoStamp(bucket),
      open: first.open,
      high: Math.max(...group.map((item) => item.high)),
      low: Math.min(...group.map((item) => item.low)),
      close: last.close,
      volume: group.reduce((sum, item) => sum + (item.volume ?? 0), 0),
    })
  })
  return bundled
}

export function isoStamp(stamp: number): string {
  return new Date(stamp * 1000).toISOString().replace(/\.\d{3}Z$/, "Z")
}

export async function fetchPublicTape(
  symbol: MarketId,
  interval: Timeframe,
  options?: { since?: number; days?: number; range?: RangeId; venue?: Venue },
): Promise<Tape> {
  const venue = options?.venue ?? "spot"
  const seconds = barSeconds(interval)
  if (seconds <= 0) throw new Error("The tape didn't load.")
  if (!/^[A-Z0-9]{2,20}$/.test(symbol) || !symbol.endsWith("USDT")) {
    throw new Error("The tape didn't load.")
  }
  const end = Math.floor(Date.now() / 1000)
  const start = windowStart(interval, end, options?.since, options?.days, seconds)
  const candles =
    venue === "perp" ? await fetchKrakenCandles(symbol, interval, start, end, seconds) : await fetchBinanceCandles(symbol, interval, start, end, seconds)
  const kept = dedupe(candles).filter((candle) => candle.t >= start && candle.t <= end)
  if (kept.length === 0) throw new Error("The tape didn't load.")
  return {
    symbol,
    interval,
    range: options?.range ?? "All",
    source: venue === "perp" ? "kraken-perp" : "binance",
    venue,
    seconds,
    periodsPerYear: periodsPerYear(interval),
    candles: kept,
    funding: venue === "perp" ? null : undefined,
    fundingStale: venue === "perp",
  }
}

function windowStart(interval: string, end: number, since: number | undefined, days: number | undefined, seconds: number): number {
  if (since != null) return Math.max(0, Math.min(end - seconds * 5, since - seconds))
  return Math.max(0, end - publicSpanDays(interval, days ?? null) * DAY)
}

async function fetchBinanceCandles(symbol: string, interval: string, start: number, end: number, seconds: number): Promise<TapeCandle[]> {
  const barMs = seconds * 1000
  const startMs = start * 1000
  const endMs = end * 1000
  const windows: Array<[number, number]> = []
  let cursor = startMs
  const step = KLINE_LIMIT * barMs
  while (cursor < endMs && windows.length < MAX_WINDOWS) {
    windows.push([cursor, Math.min(endMs, cursor + step - barMs)])
    cursor += step
  }
  const candles: TapeCandle[] = []
  for (let index = 0; index < windows.length; index += PAGE_BATCH) {
    const batch = windows.slice(index, index + PAGE_BATCH)
    const pages = await Promise.all(batch.map(([from, to]) => fetchKlinePage(symbol, interval, from, to)))
    for (const page of pages) candles.push(...page)
  }
  return candles
}

async function fetchKlinePage(symbol: string, interval: string, startMs: number, endMs: number): Promise<TapeCandle[]> {
  const params = new URLSearchParams({
    symbol,
    interval,
    startTime: String(startMs),
    endTime: String(endMs),
    limit: String(KLINE_LIMIT),
  })
  const response = await fetch(`${BINANCE_KLINES}?${params.toString()}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error("The tape didn't load.")
  const payload: unknown = await response.json()
  if (!Array.isArray(payload)) throw new Error("The tape didn't load.")
  return payload.flatMap((row) => {
    const candle = klineCandle(row)
    return candle ? [candle] : []
  })
}

async function fetchKrakenCandles(symbol: string, interval: string, start: number, end: number, seconds: number): Promise<TapeCandle[]> {
  const product = krakenProduct(symbol)
  const resolution = KRAKEN_RESOLUTION[interval]
  const native = resolution ? KRAKEN_NATIVE[resolution] : undefined
  if (!product || !resolution || native == null) throw new Error("The tape didn't load.")
  const rows = await fetchKrakenPages(product, resolution, start, end, native)
  if (interval === "3m") return resampleCandles(rows, seconds, native)
  return rows
}

async function fetchKrakenPages(product: string, resolution: string, start: number, end: number, seconds: number): Promise<TapeCandle[]> {
  let cursor = Math.max(0, start)
  const rows: TapeCandle[] = []
  for (let page = 0; page < KRAKEN_PAGES; page += 1) {
    const params = new URLSearchParams({ from: String(cursor), to: String(end) })
    const response = await fetch(`${KRAKEN_CHARTS}/${product}/${resolution}?${params.toString()}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error("The tape didn't load.")
    const payload: unknown = await response.json()
    if (!payload || typeof payload !== "object") throw new Error("The tape didn't load.")
    const body = payload as { candles?: unknown; more_candles?: unknown }
    const batch = Array.isArray(body.candles)
      ? body.candles.flatMap((item) => {
          const candle = chartCandle(item)
          return candle && candle.t >= start && candle.t <= end ? [candle] : []
        })
      : []
    if (batch.length === 0) break
    rows.push(...batch)
    if (body.more_candles !== true) break
    const next = batch[batch.length - 1]!.t + seconds
    if (next <= cursor) break
    cursor = next
  }
  return rows
}

function dedupe(candles: TapeCandle[]): TapeCandle[] {
  const byTime = new Map<number, TapeCandle>()
  for (const candle of candles) byTime.set(candle.t, candle)
  return [...byTime.values()].sort((left, right) => left.t - right.t)
}
