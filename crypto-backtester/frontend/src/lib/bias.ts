import { TIMEFRAMES } from "./runs.ts"
import type { TapeCandle, Timeframe } from "./types.ts"

const ORDER = TIMEFRAMES.map((item) => item.id)

/** True when `candidate` is a strictly higher bar size than `base`. */
export function isHigherTimeframe(candidate: Timeframe, base: Timeframe): boolean {
  return ORDER.indexOf(candidate) > ORDER.indexOf(base)
}

export function higherTimeframes(base: Timeframe): Timeframe[] {
  return ORDER.filter((item) => isHigherTimeframe(item, base))
}

/**
 * Higher-timeframe trend: close above its SMA is with-trend (+1), below is against (-1).
 * Bars before the SMA is ready stay 0.
 */
export function trendBias(candles: TapeCandle[], period = 50): number[] {
  const length = Math.max(2, Math.min(period, candles.length - 1))
  const out = new Array<number>(candles.length).fill(0)
  let sum = 0
  for (let index = 0; index < candles.length; index += 1) {
    sum += candles[index]!.close
    if (index >= length) sum -= candles[index - length]!.close
    if (index < length - 1) continue
    const sma = sum / length
    const close = candles[index]!.close
    out[index] = close > sma ? 1 : close < sma ? -1 : 0
  }
  return out
}

/** Map each lower-timeframe bar to the last completed higher-timeframe bias. */
export function alignBias(ltf: TapeCandle[], htf: TapeCandle[], htfBias: number[]): number[] {
  const out = new Array<number>(ltf.length).fill(0)
  if (htf.length === 0 || htfBias.length === 0) return out
  let cursor = 0
  let last = 0
  for (let index = 0; index < ltf.length; index += 1) {
    const t = ltf[index]!.t
    while (cursor < htf.length && htf[cursor]!.t <= t) {
      last = htfBias[cursor] ?? 0
      cursor += 1
    }
    out[index] = last
  }
  return out
}

/** Longs only when the higher-timeframe bias is with-trend. Shorts and flats stay. */
export function gateLongs(signals: number[], bias: number[]): number[] {
  return signals.map((signal, index) => {
    if (signal > 0 && (bias[index] ?? 0) < 0) return 0
    return signal
  })
}

export function latestBias(candles: TapeCandle[], period = 50): 1 | -1 | 0 {
  if (candles.length < 3) return 0
  const series = trendBias(candles, period)
  const value = series[series.length - 1] ?? 0
  return value > 0 ? 1 : value < 0 ? -1 : 0
}

export function biasLabel(bias: 1 | -1 | 0): "with trend" | "against" | null {
  if (bias > 0) return "with trend"
  if (bias < 0) return "against"
  return null
}
