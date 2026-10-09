import type { TapeCandle, Trade } from "@/lib/types"

export type PlotBar = {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  entry: number | null
  exit: number | null
}

export function priceDomain(candles: Array<{ low: number; high: number }>): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (const candle of candles) {
    if (candle.low < lo) lo = candle.low
    if (candle.high > hi) hi = candle.high
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [1, 2]
  if (lo === hi) {
    const pad = Math.abs(lo) * 0.02 || 1
    const min = lo - pad <= 0 ? (lo > 0 ? lo * 0.98 : pad) : lo - pad
    return [min, hi + pad]
  }
  const pad = (hi - lo) * 0.06
  const min = lo - pad <= 0 ? (lo > 0 ? lo * 0.98 : pad) : lo - pad
  return [min, hi + pad]
}

export function plotCandles(candles: TapeCandle[], trades: Trade[], maxPoints: number): PlotBar[] {
  if (candles.length === 0) return []
  const entryAt = new Map<string, number>()
  const exitAt = new Map<string, number>()
  for (const trade of trades) {
    entryAt.set(trade.entry_time, trade.entry_price)
    if (trade.status === "closed" && trade.exit_time && trade.exit_price != null) {
      exitAt.set(trade.exit_time, trade.exit_price)
    }
  }
  const size = Math.max(1, Math.ceil(candles.length / maxPoints))
  const bars: PlotBar[] = []
  for (let index = 0; index < candles.length; index += size) {
    const slice = candles.slice(index, index + size)
    const first = slice[0]
    const last = slice[slice.length - 1]
    if (!first || !last) continue
    let high = first.high
    let low = first.low
    let volume = 0
    let entry: number | null = null
    let exit: number | null = null
    for (const bar of slice) {
      if (bar.high > high) high = bar.high
      if (bar.low < low) low = bar.low
      volume += bar.volume ?? 0
      const entryPrice = entryAt.get(bar.time)
      const exitPrice = exitAt.get(bar.time)
      if (entryPrice != null) entry = entryPrice
      if (exitPrice != null) exit = exitPrice
    }
    bars.push({
      time: first.time,
      open: first.open,
      high,
      low,
      close: last.close,
      volume,
      entry,
      exit,
    })
  }
  return bars
}

export function thinRows<T>(rows: T[], max: number): T[] {
  if (rows.length <= max) return rows
  const out: T[] = []
  const step = (rows.length - 1) / (max - 1)
  for (let index = 0; index < max; index += 1) out.push(rows[Math.round(index * step)]!)
  return out
}
