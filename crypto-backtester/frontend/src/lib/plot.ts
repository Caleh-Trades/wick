import type { TapeCandle, Trade } from "@/lib/types"

export type PlotBar = {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  entry: number | null
  entrySide: "long" | "short" | null
  exit: number | null
  exitSide: "long" | "short" | null
  liquidated: boolean
}

export function spotTrades<T extends { side: "long" | "short" }>(trades: T[], venue: "spot" | "perp"): T[] {
  if (venue === "perp") return trades
  return trades.filter((trade) => trade.side !== "short")
}

/** Count missing bars. A gap stays empty; the previous close is not copied forward. */
export function missingBars(candles: Array<{ t: number }>, seconds: number): number {
  if (candles.length < 2 || !(seconds > 0)) return 0
  let gaps = 0
  for (let index = 1; index < candles.length; index += 1) {
    const step = (candles[index]?.t ?? 0) - (candles[index - 1]?.t ?? 0)
    if (step > seconds * 1.5) gaps += Math.round(step / seconds) - 1
  }
  return gaps
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
    const pad = Math.abs(lo) * 0.04 || 1
    const min = lo - pad <= 0 ? (lo > 0 ? lo * 0.96 : pad) : lo - pad
    return [min, hi + pad]
  }
  const pad = (hi - lo) * 0.04
  const min = lo - pad <= 0 ? (lo > 0 ? lo * 0.96 : pad) : lo - pad
  return [min, hi + pad]
}

export function plotCandles(candles: TapeCandle[], trades: Trade[], maxPoints: number): PlotBar[] {
  if (candles.length === 0) return []
  const entryAt = new Map<string, { price: number; side: "long" | "short" }>()
  const exitAt = new Map<string, { price: number; side: "long" | "short"; liquidated: boolean }>()
  for (const trade of trades) {
    entryAt.set(trade.entry_time, { price: trade.entry_price, side: trade.side })
    if ((trade.status === "closed" || trade.status === "liquidated") && trade.exit_time && trade.exit_price != null) {
      exitAt.set(trade.exit_time, { price: trade.exit_price, side: trade.side, liquidated: trade.status === "liquidated" })
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
    let entrySide: "long" | "short" | null = null
    let exit: number | null = null
    let exitSide: "long" | "short" | null = null
    let liquidated = false
    for (const bar of slice) {
      if (bar.high > high) high = bar.high
      if (bar.low < low) low = bar.low
      volume += bar.volume ?? 0
      const entryMark = entryAt.get(bar.time)
      const exitMark = exitAt.get(bar.time)
      if (entryMark) {
        entry = entryMark.price
        entrySide = entryMark.side
      }
      if (exitMark) {
        exit = exitMark.price
        exitSide = exitMark.side
        liquidated = exitMark.liquidated
      }
    }
    bars.push({
      time: first.time,
      open: first.open,
      high,
      low,
      close: last.close,
      volume,
      entry,
      entrySide,
      exit,
      exitSide,
      liquidated,
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
