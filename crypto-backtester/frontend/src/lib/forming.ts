import type { Print } from "@/lib/book"
import type { TapeCandle } from "@/lib/types"

const BAR_SECONDS: Record<string, number> = {
  "1m": 60,
  "3m": 180,
  "5m": 300,
  "15m": 900,
  "30m": 1_800,
  "1h": 3_600,
  "4h": 14_400,
  "1d": 86_400,
}

export function barSeconds(interval: string): number {
  return BAR_SECONDS[interval] ?? 0
}

export function mergeForming(candles: TapeCandle[], prints: Print[], seconds: number, sinceMs: number): TapeCandle[] {
  if (candles.length === 0 || prints.length === 0 || seconds <= 0) return candles
  const relevant = prints.filter((print) => print.t >= sinceMs).sort((left, right) => left.t - right.t)
  if (relevant.length === 0) return candles
  const next = candles.slice()
  let last = { ...next[next.length - 1]! }
  let changed = false
  for (const print of relevant) {
    const bucket = Math.floor(print.t / 1000 / seconds) * seconds
    if (bucket < last.t) continue
    if (bucket > last.t) {
      next[next.length - 1] = last
      last = {
        t: bucket,
        time: new Date(bucket * 1000).toISOString().replace(".000Z", "Z"),
        open: print.price,
        high: print.price,
        low: print.price,
        close: print.price,
        volume: print.size,
      }
      next.push(last)
      changed = true
      continue
    }
    const high = Math.max(last.high, print.price)
    const low = Math.min(last.low, print.price)
    if (high === last.high && low === last.low && print.price === last.close) {
      last = { ...last, volume: (last.volume ?? 0) + print.size }
    } else {
      last = { ...last, high, low, close: print.price, volume: (last.volume ?? 0) + print.size }
    }
    next[next.length - 1] = last
    changed = true
  }
  return changed ? next : candles
}
