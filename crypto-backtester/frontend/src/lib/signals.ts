import { ruleById } from "./runs.ts"
import type { RuleId, RunParams, TapeCandle } from "./types"

const SKIP_LAST = 1
const RSI_FILTER_LENGTH = 14
const RSI_FILTER_LEVEL = 30
const CHANDELIER_ATR = 22

export function buildSignals(rule: RuleId, candles: TapeCandle[], params: RunParams): number[] {
  const closes = candles.map((bar) => bar.close)
  const highs = candles.map((bar) => bar.high)
  const lows = candles.map((bar) => bar.low)
  const opens = candles.map((bar) => bar.open)
  const volumes = candles.map((bar) => (bar.volume != null && bar.volume > 0 ? bar.volume : 1))
  const days = candles.map((bar) => Math.floor(bar.t / 86_400))
  const signals = series(rule, { closes, highs, lows, opens, volumes, days }, params)
  return signals.map((value) => (value > 0 ? 1 : value < 0 ? -1 : 0))
}

/** Values that fired the entry. Moving averages are read on the signal bar, one bar before the fill. */
export function ruleReading(rule: RuleId, candles: TapeCandle[], params: RunParams, entryTime: string): string[] {
  const entry = candles.findIndex((bar) => bar.time === entryTime)
  const signal = Math.max(0, (entry < 0 ? 0 : entry) - 1)
  const closes = candles.map((bar) => bar.close)
  if (rule === "sma_cross" || rule === "dual_ma") {
    const lines = [
      `Fast SMA ${readingValue(sma(closes, params.fast ?? 20)[signal])}`,
      `Slow SMA ${readingValue(sma(closes, params.slow ?? 50)[signal])}`,
    ]
    if (rule === "dual_ma") lines.push(`Filter SMA ${readingValue(sma(closes, params.filter ?? 200)[signal])}`)
    return lines
  }
  if (rule === "ema_cross") {
    return [
      `Fast EMA ${readingValue(ema(closes, params.fast ?? 12)[signal])}`,
      `Slow EMA ${readingValue(ema(closes, params.slow ?? 26)[signal])}`,
    ]
  }
  const spec = ruleById(rule)
  if (!spec || spec.params.length === 0) return spec ? [spec.name] : []
  return spec.params.map((param) => {
    const value = params[param.key] ?? param.default
    const option = param.options?.find((item) => item.value === value)
    return `${param.label} ${option?.label ?? value}`
  })
}

function readingValue(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—"
  const abs = Math.abs(value)
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : 6
  return value.toFixed(digits)
}

type Bars = {
  closes: number[]
  highs: number[]
  lows: number[]
  opens: number[]
  volumes: number[]
  days: number[]
}

function series(rule: RuleId, bars: Bars, params: RunParams): number[] {
  switch (rule) {
    case "buy_hold":
      return bars.closes.map(() => 1)
    case "sma_cross":
      return cross(sma(bars.closes, params.fast ?? 20), sma(bars.closes, params.slow ?? 50))
    case "ema_cross":
      return cross(ema(bars.closes, params.fast ?? 12), ema(bars.closes, params.slow ?? 26))
    case "donchian":
      return donchian(bars, params.entry ?? 20, params.exit ?? 10)
    case "tsmom":
      return momentum(bars.closes, params.lookback ?? 20)
    case "bollinger":
      return bollingerRevert(bars.closes, params.period ?? 20, params.mult ?? 2, (params.rsiOn ?? 0) >= 1)
    case "bb_break":
      return bollingerBreak(bars.closes, params.period ?? 20, params.mult ?? 2)
    case "rsi_reversion":
      return rsiReversal(rsi(bars.closes, params.period ?? 14), params.oversold ?? 30, params.overbought ?? 70)
    case "macd":
      return macdTrend(
        bars,
        params.fast ?? 12,
        params.slow ?? 26,
        params.signal ?? 9,
        params.atr ?? 14,
        params.mult ?? 3,
      )
    case "keltner":
      return keltner(bars, params.period ?? 20, params.atr ?? 14, params.mult ?? 2)
    case "supertrend":
      return supertrend(bars, params.atr ?? 10, params.mult ?? 3)
    case "orb":
      return openingRange(bars, params.bars ?? 6)
    case "prev_day":
      return previousDay(bars)
    case "gap_fade":
      return gap(bars, params.gap ?? 0.5, "fade")
    case "gap_go":
      return gap(bars, params.gap ?? 0.5, "go")
    case "vwap":
      return vwapReclaim(bars)
    case "chandelier":
      return chandelier(bars, params.period ?? 50, params.mult ?? 3)
    case "dual_ma":
      return dualTrend(bars.closes, params.fast ?? 20, params.slow ?? 50, params.filter ?? 200)
    case "fair_value_gap":
      return fairValueGap(bars, params.gap ?? 0.15)
    case "candle_trigger":
      return candleTrigger(bars, params.pattern ?? 0, params.mult ?? 1.5)
    case "heikin_ashi":
      return heikinTrend(bars)
    case "break_structure":
      return structureBreak(bars, params.swing ?? 5, "bos")
    case "change_character":
      return structureBreak(bars, params.swing ?? 5, "choch")
    case "supply_demand":
      return supplyDemand(bars, params.mult ?? 1.5)
    case "rsi_divergence":
      return rsiDivergence(bars, params.period ?? 14, params.swing ?? 5)
    case "renko":
      return renkoTrend(bars, params.atr ?? 14, params.mult ?? 1)
    default: {
      const unreachable: never = rule
      return unreachable
    }
  }
}

function sma(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = Array.from({ length: values.length }, () => null)
  if (period < 1) return out
  let total = 0
  for (let i = 0; i < values.length; i += 1) {
    total += values[i] ?? 0
    if (i >= period) total -= values[i - period] ?? 0
    if (i >= period - 1) out[i] = total / period
  }
  return out
}

function ema(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = Array.from({ length: values.length }, () => null)
  if (period < 1 || values.length < period) return out
  let seed = 0
  for (let i = 0; i < period; i += 1) seed += values[i] ?? 0
  seed /= period
  out[period - 1] = seed
  const alpha = 2 / (period + 1)
  let previous = seed
  for (let i = period; i < values.length; i += 1) {
    previous = (values[i] ?? 0) * alpha + previous * (1 - alpha)
    out[i] = previous
  }
  return out
}

function rsi(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = Array.from({ length: values.length }, () => null)
  if (period < 1 || values.length <= period) return out
  let gainSum = 0
  let lossSum = 0
  for (let i = 1; i <= period; i += 1) {
    const delta = (values[i] ?? 0) - (values[i - 1] ?? 0)
    if (delta >= 0) gainSum += delta
    else lossSum -= delta
  }
  let avgGain = gainSum / period
  let avgLoss = lossSum / period
  out[period] = rsiValue(avgGain, avgLoss)
  for (let i = period + 1; i < values.length; i += 1) {
    const delta = (values[i] ?? 0) - (values[i - 1] ?? 0)
    const gain = delta > 0 ? delta : 0
    const loss = delta < 0 ? -delta : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    out[i] = rsiValue(avgGain, avgLoss)
  }
  return out
}

function rsiValue(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return 100
  return 100 - 100 / (1 + avgGain / avgLoss)
}

function atr(highs: number[], lows: number[], closes: number[], period: number): Array<number | null> {
  const out: Array<number | null> = Array.from({ length: closes.length }, () => null)
  if (period < 1 || closes.length <= period) return out
  let seed = 0
  for (let i = 1; i <= period; i += 1) seed += trueRange(highs, lows, closes, i)
  let previous = seed / period
  out[period] = previous
  for (let i = period + 1; i < closes.length; i += 1) {
    previous = (previous * (period - 1) + trueRange(highs, lows, closes, i)) / period
    out[i] = previous
  }
  return out
}

function trueRange(highs: number[], lows: number[], closes: number[], index: number): number {
  const high = highs[index] ?? 0
  const low = lows[index] ?? 0
  const span = high - low
  if (index === 0) return span
  const prev = closes[index - 1] ?? low
  return Math.max(span, Math.abs(high - prev), Math.abs(low - prev))
}

function cross(fast: Array<number | null>, slow: Array<number | null>): number[] {
  return fast.map((fastValue, index) => {
    const slowValue = slow[index]
    if (fastValue == null || slowValue == null) return 0
    if (fastValue > slowValue) return 1
    if (fastValue < slowValue) return -1
    return 0
  })
}

function bollinger(
  values: number[],
  period: number,
  mult: number,
): [Array<number | null>, Array<number | null>, Array<number | null>] {
  const mid = sma(values, period)
  const upper: Array<number | null> = Array.from({ length: values.length }, () => null)
  const lower: Array<number | null> = Array.from({ length: values.length }, () => null)
  mid.forEach((center, index) => {
    if (center == null) return
    const window = values.slice(index - period + 1, index + 1)
    const variance = window.reduce((sum, value) => sum + (value - center) ** 2, 0) / period
    const width = Math.sqrt(variance) * mult
    upper[index] = center + width
    lower[index] = center - width
  })
  return [mid, upper, lower]
}

function macd(
  values: number[],
  fast: number,
  slow: number,
  signalPeriod: number,
): [Array<number | null>, Array<number | null>] {
  const fastEma = ema(values, fast)
  const slowEma = ema(values, slow)
  const line: Array<number | null> = Array.from({ length: values.length }, () => null)
  const defined: number[] = []
  const definedAt: number[] = []
  fastEma.forEach((fastValue, index) => {
    const slowValue = slowEma[index]
    if (fastValue == null || slowValue == null) return
    const value = fastValue - slowValue
    line[index] = value
    defined.push(value)
    definedAt.push(index)
  })
  const signal: Array<number | null> = Array.from({ length: values.length }, () => null)
  if (defined.length < signalPeriod) return [line, signal]
  const seeded = ema(defined, signalPeriod)
  definedAt.forEach((index, position) => {
    signal[index] = seeded[position] ?? null
  })
  return [line, signal]
}

function bollingerRevert(closes: number[], period: number, mult: number, rsiFilter: boolean): number[] {
  const [mid, upper, lower] = bollinger(closes, period, mult)
  const readings = rsiFilter ? rsi(closes, RSI_FILTER_LENGTH) : []
  const signals: number[] = []
  let state = 0
  closes.forEach((close, index) => {
    const center = mid[index]
    const highBand = upper[index]
    const lowBand = lower[index]
    if (center == null || highBand == null || lowBand == null) {
      signals.push(0)
      return
    }
    const reading = readings[index]
    const longAllowed = !rsiFilter || (reading != null && reading <= RSI_FILTER_LEVEL)
    const shortAllowed = !rsiFilter || (reading != null && reading >= 100 - RSI_FILTER_LEVEL)
    if (close < lowBand && longAllowed) state = 1
    else if (close > highBand && shortAllowed) state = -1
    else if (close > highBand && state === 1) state = 0
    else if (close < lowBand && state === -1) state = 0
    else if (state === 1 && close >= center) state = 0
    else if (state === -1 && close <= center) state = 0
    signals.push(state)
  })
  return signals
}

function bollingerBreak(closes: number[], period: number, mult: number): number[] {
  const [mid, upper, lower] = bollinger(closes, period, mult)
  const signals: number[] = []
  let state = 0
  closes.forEach((close, index) => {
    const center = mid[index]
    const highBand = upper[index]
    const lowBand = lower[index]
    if (center == null || highBand == null || lowBand == null) {
      signals.push(0)
      return
    }
    if (close > highBand) state = 1
    else if (close < lowBand) state = -1
    else if (state === 1 && close < center) state = 0
    else if (state === -1 && close > center) state = 0
    signals.push(state)
  })
  return signals
}

function rsiReversal(readings: Array<number | null>, oversold: number, overbought: number): number[] {
  const signals: number[] = []
  let state = 0
  for (const reading of readings) {
    if (reading == null) {
      signals.push(0)
      continue
    }
    if (reading <= oversold) state = 1
    else if (reading >= overbought) state = -1
    signals.push(state)
  }
  return signals
}

function donchian(bars: Bars, entry: number, exitWindow: number): number[] {
  const entryHigh = priorExtreme(bars.highs, entry, true)
  const entryLow = priorExtreme(bars.lows, entry, false)
  const exitHigh = priorExtreme(bars.highs, exitWindow, true)
  const exitLow = priorExtreme(bars.lows, exitWindow, false)
  const signals: number[] = []
  let state = 0
  bars.closes.forEach((close, index) => {
    if (entryHigh[index] != null && close > (entryHigh[index] ?? 0)) state = 1
    else if (entryLow[index] != null && close < (entryLow[index] ?? 0)) state = -1
    else if (state === 1 && exitLow[index] != null && close < (exitLow[index] ?? 0)) state = 0
    else if (state === -1 && exitHigh[index] != null && close > (exitHigh[index] ?? 0)) state = 0
    signals.push(state)
  })
  return signals
}

function priorExtreme(values: number[], period: number, useMax: boolean): Array<number | null> {
  const out: Array<number | null> = Array.from({ length: values.length }, () => null)
  if (period < 1) return out
  for (let index = period; index < values.length; index += 1) {
    const window = values.slice(index - period, index)
    out[index] = useMax ? Math.max(...window) : Math.min(...window)
  }
  return out
}

function momentum(closes: number[], lookback: number): number[] {
  return closes.map((_, index) => {
    const end = index - SKIP_LAST
    const start = end - lookback
    if (start < 0) return 0
    const recent = closes[end] ?? 0
    const base = closes[start] ?? 0
    if (!(base > 0)) return 0
    if (recent > base) return 1
    if (recent < base) return -1
    return 0
  })
}

function macdTrend(bars: Bars, fast: number, slow: number, signalPeriod: number, atrLength: number, mult: number): number[] {
  const [line, signal] = macd(bars.closes, fast, slow, signalPeriod)
  const range = atr(bars.highs, bars.lows, bars.closes, atrLength)
  const signals: number[] = []
  let state = 0
  let peak = 0
  let trough = 0
  let armedLong = true
  let armedShort = true
  for (let index = 0; index < bars.closes.length; index += 1) {
    const macdLine = line[index]
    const macdSignal = signal[index]
    const bull = macdLine != null && macdSignal != null && macdLine > macdSignal
    const bear = macdLine != null && macdSignal != null && macdLine < macdSignal
    const close = bars.closes[index] ?? 0
    const high = bars.highs[index] ?? close
    const low = bars.lows[index] ?? close
    if (state === 1) {
      peak = Math.max(peak, high)
      const width = range[index]
      const stopped = width != null && close < peak - width * mult
      if (!bull || stopped) {
        state = 0
        armedLong = !bull
      }
    } else if (state === -1) {
      trough = Math.min(trough, low)
      const width = range[index]
      const stopped = width != null && close > trough + width * mult
      if (!bear || stopped) {
        state = 0
        armedShort = !bear
      }
    } else if (bull && armedLong) {
      state = 1
      peak = high
    } else if (bear && armedShort) {
      state = -1
      trough = low
    } else {
      if (!bull) armedLong = true
      if (!bear) armedShort = true
    }
    signals.push(state)
  }
  return signals
}

function keltner(bars: Bars, length: number, atrLength: number, mult: number): number[] {
  const mid = ema(bars.closes, length)
  const range = atr(bars.highs, bars.lows, bars.closes, atrLength)
  const signals: number[] = []
  let state = 0
  bars.closes.forEach((close, index) => {
    const center = mid[index]
    const width = range[index]
    if (center == null || width == null) {
      signals.push(0)
      return
    }
    if (close > center + width * mult) state = 1
    else if (close < center - width * mult) state = -1
    else if (state === 1 && close < center) state = 0
    else if (state === -1 && close > center) state = 0
    signals.push(state)
  })
  return signals
}

function supertrend(bars: Bars, period: number, mult: number): number[] {
  const range = atr(bars.highs, bars.lows, bars.closes, period)
  const upperBand: Array<number | null> = Array.from({ length: bars.closes.length }, () => null)
  const lowerBand: Array<number | null> = Array.from({ length: bars.closes.length }, () => null)
  const line: Array<number | null> = Array.from({ length: bars.closes.length }, () => null)
  const signals: number[] = []
  for (let index = 0; index < bars.closes.length; index += 1) {
    const width = range[index]
    if (width == null) {
      signals.push(0)
      continue
    }
    const high = bars.highs[index] ?? 0
    const low = bars.lows[index] ?? 0
    const close = bars.closes[index] ?? 0
    const basicUpper = (high + low) / 2 + mult * width
    const basicLower = (high + low) / 2 - mult * width
    const prevUpper = index > 0 ? upperBand[index - 1] : null
    const prevLower = index > 0 ? lowerBand[index - 1] : null
    const prevClose = index > 0 ? (bars.closes[index - 1] ?? close) : close
    const upper = prevUpper == null || basicUpper < prevUpper || prevClose > prevUpper ? basicUpper : prevUpper
    const lower = prevLower == null || basicLower > prevLower || prevClose < prevLower ? basicLower : prevLower
    upperBand[index] = upper
    lowerBand[index] = lower
    const prevLine = index > 0 ? line[index - 1] : null
    const next = prevLine == null || prevUpper == null || prevLine === prevUpper ? (close > upper ? lower : upper) : close < lower ? upper : lower
    line[index] = next
    signals.push(next === lower ? 1 : -1)
  }
  return signals
}

function openingRange(bars: Bars, rangeBars: number): number[] {
  const signals: number[] = []
  let day = Number.NaN
  let counted = 0
  let spanHigh = 0
  let spanLow = 0
  let rangeHigh: number | null = null
  let rangeLow: number | null = null
  let state = 0
  for (let index = 0; index < bars.closes.length; index += 1) {
    if (bars.days[index] !== day) {
      day = bars.days[index] ?? day
      counted = 0
      spanHigh = bars.highs[index] ?? 0
      spanLow = bars.lows[index] ?? 0
      rangeHigh = null
      rangeLow = null
      state = 0
    }
    const high = bars.highs[index] ?? 0
    const low = bars.lows[index] ?? 0
    const close = bars.closes[index] ?? 0
    if (rangeHigh == null) {
      spanHigh = Math.max(spanHigh, high)
      spanLow = Math.min(spanLow, low)
      counted += 1
      if (counted >= rangeBars) {
        rangeHigh = spanHigh
        rangeLow = spanLow
      }
      state = 0
    } else if (close > rangeHigh) state = 1
    else if (rangeLow != null && close < rangeLow) state = -1
    signals.push(state)
  }
  return signals
}

function previousDay(bars: Bars): number[] {
  const signals: number[] = []
  let day = Number.NaN
  let dayHigh = 0
  let dayLow = 0
  let prevHigh: number | null = null
  let prevLow: number | null = null
  let state = 0
  for (let index = 0; index < bars.closes.length; index += 1) {
    const high = bars.highs[index] ?? 0
    const low = bars.lows[index] ?? 0
    const close = bars.closes[index] ?? 0
    if (bars.days[index] !== day) {
      if (!Number.isNaN(day)) {
        prevHigh = dayHigh
        prevLow = dayLow
      }
      day = bars.days[index] ?? day
      dayHigh = high
      dayLow = low
    } else {
      dayHigh = Math.max(dayHigh, high)
      dayLow = Math.min(dayLow, low)
    }
    if (prevHigh != null && prevLow != null) {
      if (close > prevHigh) state = 1
      else if (close < prevLow) state = -1
    }
    signals.push(state)
  }
  return signals
}

function gapSide(gapPct: number, minPct: number, mode: "fade" | "go"): number {
  if (mode === "go") {
    if (gapPct >= minPct) return 1
    if (gapPct <= -minPct) return -1
    return 0
  }
  if (gapPct <= -minPct) return 1
  if (gapPct >= minPct) return -1
  return 0
}

function gap(bars: Bars, minPct: number, mode: "fade" | "go"): number[] {
  const signals = Array.from({ length: bars.closes.length }, () => 0)
  let start = 0
  for (let index = 1; index <= bars.closes.length; index += 1) {
    const ended = index === bars.closes.length || bars.days[index] !== bars.days[index - 1]
    if (!ended) continue
    const prevClose = start > 0 ? bars.closes[start - 1] : null
    const open = bars.opens[start] ?? 0
    if (prevClose != null && prevClose > 0) {
      const gapPct = ((open - prevClose) / prevClose) * 100
      const side = gapSide(gapPct, minPct, mode)
      if (side !== 0) {
        for (let cursor = start; cursor < index; cursor += 1) {
          const close = bars.closes[cursor] ?? 0
          if (mode === "fade" && side > 0 && close >= prevClose) break
          if (mode === "fade" && side < 0 && close <= prevClose) break
          signals[cursor] = side
        }
      }
    }
    if (index - start > 1) signals[index - 1] = 0
    start = index
  }
  return signals
}

function vwapReclaim(bars: Bars): number[] {
  const signals: number[] = []
  let day = Number.NaN
  let total = 0
  let volume = 0
  for (let index = 0; index < bars.closes.length; index += 1) {
    if (bars.days[index] !== day) {
      day = bars.days[index] ?? day
      total = 0
      volume = 0
    }
    const high = bars.highs[index] ?? 0
    const low = bars.lows[index] ?? 0
    const close = bars.closes[index] ?? 0
    const size = bars.volumes[index] ?? 1
    total += ((high + low + close) / 3) * size
    volume += size
    const vwap = volume > 0 ? total / volume : close
    signals.push(close > vwap ? 1 : close < vwap ? -1 : 0)
  }
  return signals
}

function chandelier(bars: Bars, trendLength: number, mult: number): number[] {
  const trend = ema(bars.closes, trendLength)
  const range = atr(bars.highs, bars.lows, bars.closes, CHANDELIER_ATR)
  const signals: number[] = []
  let state = 0
  let peak = 0
  let trough = 0
  let cooledLong = true
  let cooledShort = true
  for (let index = 0; index < bars.closes.length; index += 1) {
    const close = bars.closes[index] ?? 0
    const high = bars.highs[index] ?? close
    const low = bars.lows[index] ?? close
    const center = trend[index]
    const trendUp = center != null && close > center
    const trendDown = center != null && close < center
    const prevCenter = index > 0 ? trend[index - 1] : null
    const prevClose = index > 0 ? (bars.closes[index - 1] ?? close) : close
    const crossedUp = trendUp && (prevCenter == null || prevClose <= prevCenter)
    const crossedDown = trendDown && (prevCenter == null || prevClose >= prevCenter)
    if (state === 1) {
      peak = Math.max(peak, high)
      const width = range[index]
      const stopped = width != null && close < peak - width * mult
      if (!trendUp || stopped) {
        state = 0
        cooledLong = !trendUp
      }
    } else if (state === -1) {
      trough = Math.min(trough, low)
      const width = range[index]
      const stopped = width != null && close > trough + width * mult
      if (!trendDown || stopped) {
        state = 0
        cooledShort = !trendDown
      }
    } else if (trendUp && cooledLong && crossedUp) {
      state = 1
      peak = high
    } else if (trendDown && cooledShort && crossedDown) {
      state = -1
      trough = low
    } else {
      if (!trendUp) cooledLong = true
      if (!trendDown) cooledShort = true
    }
    signals.push(state)
  }
  return signals
}

const CANDLE_ATR = 14

export function heikinAshi(candles: TapeCandle[]): TapeCandle[] {
  let priorOpen = 0
  let priorClose = 0
  return candles.map((bar, index) => {
    const close = (bar.open + bar.high + bar.low + bar.close) / 4
    const open = index === 0 ? (bar.open + bar.close) / 2 : (priorOpen + priorClose) / 2
    priorOpen = open
    priorClose = close
    return {
      ...bar,
      open,
      close,
      high: Math.max(bar.high, open, close),
      low: Math.min(bar.low, open, close),
    }
  })
}

function heikinTrend(bars: Bars): number[] {
  const smoothed = heikinAshi(
    bars.closes.map((close, index) => ({
      t: index,
      time: String(index),
      open: bars.opens[index] ?? close,
      high: bars.highs[index] ?? close,
      low: bars.lows[index] ?? close,
      close,
    })),
  )
  return smoothed.map((bar) => (bar.close > bar.open ? 1 : 0))
}

type Zone = { dir: 1 | -1; low: number; high: number; index: number }

function fairValueGap(bars: Bars, minPct: number): number[] {
  const signals: number[] = []
  let bull: Zone | null = null
  let bear: Zone | null = null
  let active: Zone | null = null
  let state = 0
  for (let index = 0; index < bars.closes.length; index += 1) {
    const close = bars.closes[index] ?? 0
    const high = bars.highs[index] ?? close
    const low = bars.lows[index] ?? close
    let nextBull: Zone | null = null
    let nextBear: Zone | null = null
    if (index >= 2 && close > 0) {
      const up = low - (bars.highs[index - 2] ?? low)
      const down = (bars.lows[index - 2] ?? high) - high
      if (up > 0 && (up / close) * 100 >= minPct) {
        nextBull = { dir: 1, low: bars.highs[index - 2] ?? low, high: low, index }
      }
      if (down > 0 && (down / close) * 100 >= minPct) {
        nextBear = { dir: -1, low: high, high: bars.lows[index - 2] ?? high, index }
      }
    }
    if (state !== 0 && active) {
      const filled = state > 0 ? low <= active.low : high >= active.high
      const opposite = state > 0 ? nextBear != null : nextBull != null
      if (filled || opposite) {
        if (bull === active) bull = null
        if (bear === active) bear = null
        active = null
        state = 0
      }
    }
    if (state === 0) {
      if (bull && low <= bull.low) bull = null
      if (bear && high >= bear.high) bear = null
      const zones: Zone[] = []
      if (bull) zones.push(bull)
      if (bear) zones.push(bear)
      zones.sort((left, right) => right.index - left.index)
      for (const zone of zones) {
        const overlaps = low <= zone.high && high >= zone.low
        const filled = zone.dir > 0 ? low <= zone.low : high >= zone.high
        if (!overlaps || filled) continue
        state = zone.dir
        active = zone
        break
      }
    }
    if (nextBull) bull = nextBull
    if (nextBear) bear = nextBear
    signals.push(state)
  }
  return signals
}

function candleSide(bars: Bars, index: number, pattern: number): number {
  if (index < 1) return 0
  const open = bars.opens[index] ?? 0
  const close = bars.closes[index] ?? 0
  const high = bars.highs[index] ?? close
  const low = bars.lows[index] ?? close
  const prevOpen = bars.opens[index - 1] ?? 0
  const prevClose = bars.closes[index - 1] ?? 0
  const body = Math.abs(close - open)
  const upper = high - Math.max(open, close)
  const lower = Math.min(open, close) - low
  const span = high - low
  if (pattern === 1) return body > 0 && lower >= body * 2 && upper <= body ? 1 : 0
  if (pattern === 2) return body > 0 && upper >= body * 2 && lower <= body ? -1 : 0
  if (pattern === 3) {
    if (!(span > 0) || body > span * 0.1) return 0
    if (prevClose < prevOpen) return 1
    if (prevClose > prevOpen) return -1
    return 0
  }
  const prevBody = Math.abs(prevClose - prevOpen)
  const bullish = prevClose < prevOpen && close > open && open <= prevClose && close >= prevOpen && body > prevBody
  const bearish = prevClose > prevOpen && close < open && open >= prevClose && close <= prevOpen && body > prevBody
  if (bullish) return 1
  if (bearish) return -1
  return 0
}

function candleTrigger(bars: Bars, pattern: number, mult: number): number[] {
  const range = atr(bars.highs, bars.lows, bars.closes, CANDLE_ATR)
  const signals: number[] = []
  let state = 0
  let stop = 0
  const picked = Math.min(3, Math.max(0, Math.round(pattern)))
  for (let index = 0; index < bars.closes.length; index += 1) {
    const close = bars.closes[index] ?? 0
    const high = bars.highs[index] ?? close
    const low = bars.lows[index] ?? close
    const width = range[index]
    if (state > 0 && low <= stop) state = 0
    else if (state < 0 && high >= stop) state = 0
    if (state === 0 && width != null && width > 0) {
      const side = candleSide(bars, index, picked)
      if (side !== 0) {
        const next = side > 0 ? close - width * mult : close + width * mult
        const breached = side > 0 ? low <= next : high >= next
        if (!breached) {
          state = side
          stop = next
        }
      }
    }
    signals.push(state)
  }
  return signals
}

function confirmedSwing(values: number[], index: number, length: number, kind: "high" | "low"): number | null {
  const pivot = index - length
  if (pivot < length) return null
  const price = values[pivot]
  if (price == null) return null
  let leftBeyond = false
  let rightBeyond = false
  for (let cursor = pivot - length; cursor <= pivot + length; cursor += 1) {
    if (cursor === pivot) continue
    const other = values[cursor]
    if (other == null) return null
    const beyond = kind === "high" ? other < price : other > price
    const through = kind === "high" ? other > price : other < price
    if (through) return null
    if (!beyond) continue
    if (cursor < pivot) leftBeyond = true
    else rightBeyond = true
  }
  return leftBeyond && rightBeyond ? price : null
}

function structureBreak(bars: Bars, swing: number, mode: "bos" | "choch"): number[] {
  const length = Math.max(1, Math.round(swing))
  const signals: number[] = []
  let lastHigh: number | null = null
  let lastLow: number | null = null
  let bias = 0
  let state = 0
  for (let index = 0; index < bars.closes.length; index += 1) {
    const high = confirmedSwing(bars.highs, index, length, "high")
    const low = confirmedSwing(bars.lows, index, length, "low")
    if (high != null) lastHigh = high
    if (low != null) lastLow = low
    const close = bars.closes[index] ?? 0
    const brokeHigh = lastHigh != null && close > lastHigh
    const brokeLow = lastLow != null && close < lastLow
    if (mode === "bos") {
      if (brokeHigh) state = 1
      else if (brokeLow) state = 0
    } else if (brokeHigh && bias !== 1) {
      bias = 1
      state = 1
    } else if (brokeLow && bias !== -1) {
      bias = -1
      state = -1
    }
    signals.push(state)
  }
  return signals
}

function supplyDemand(bars: Bars, mult: number): number[] {
  const range = atr(bars.highs, bars.lows, bars.closes, CANDLE_ATR)
  const signals: number[] = []
  let zone: Zone | null = null
  let active: Zone | null = null
  let state = 0
  for (let index = 0; index < bars.closes.length; index += 1) {
    const close = bars.closes[index] ?? 0
    const high = bars.highs[index] ?? close
    const low = bars.lows[index] ?? close
    const width = range[index]
    const previous = index > 0 ? (bars.closes[index - 1] ?? close) : close
    if (index > 0 && width != null && width > 0 && Math.abs(close - previous) >= width * mult) {
      const dir = close > previous ? 1 : -1
      const baseLow = bars.lows[index - 1] ?? previous
      const baseHigh = bars.highs[index - 1] ?? previous
      if (baseHigh >= baseLow) zone = { dir, low: baseLow, high: baseHigh, index }
    }
    if (state !== 0 && active) {
      const stopped = state > 0 ? low <= active.low : high >= active.high
      if (stopped) {
        if (zone === active) zone = null
        active = null
        state = 0
      }
    }
    if (state === 0 && zone && zone.index < index) {
      const overlaps = low <= zone.high && high >= zone.low
      const stopped = zone.dir > 0 ? low <= zone.low : high >= zone.high
      if (stopped) zone = null
      else if (overlaps) {
        state = zone.dir
        active = zone
      }
    }
    signals.push(state)
  }
  return signals
}

function rsiDivergence(bars: Bars, length: number, swing: number): number[] {
  const readings = rsi(bars.closes, length)
  const span = Math.max(1, Math.round(swing))
  const signals: number[] = []
  let state = 0
  let priorHigh: { price: number; rsi: number } | null = null
  let priorLow: { price: number; rsi: number } | null = null
  for (let index = 0; index < bars.closes.length; index += 1) {
    const highPivot = index - span
    const lowPivot = highPivot
    if (confirmedSwing(bars.highs, index, span, "high") != null && highPivot >= 0) {
      const price = bars.highs[highPivot] ?? 0
      const reading = readings[highPivot]
      if (reading != null && priorHigh && price > priorHigh.price && reading < priorHigh.rsi) state = -1
      if (reading != null) priorHigh = { price, rsi: reading }
    }
    if (confirmedSwing(bars.lows, index, span, "low") != null && lowPivot >= 0) {
      const price = bars.lows[lowPivot] ?? 0
      const reading = readings[lowPivot]
      if (reading != null && priorLow && price < priorLow.price && reading > priorLow.rsi) state = 1
      if (reading != null) priorLow = { price, rsi: reading }
    }
    signals.push(state)
  }
  return signals
}

function renkoTrend(bars: Bars, atrLength: number, mult: number): number[] {
  const range = atr(bars.highs, bars.lows, bars.closes, atrLength)
  const signals: number[] = []
  let base: number | null = null
  let green = false
  for (let index = 0; index < bars.closes.length; index += 1) {
    const close = bars.closes[index] ?? 0
    const width = range[index]
    const brick = width != null && width > 0 ? width * mult : 0
    if (!(brick > 0)) {
      signals.push(green ? 1 : 0)
      continue
    }
    if (base == null) {
      base = close
      signals.push(0)
      continue
    }
    let guard = 0
    while (close >= base + brick && guard < 100) {
      base += brick
      green = true
      guard += 1
    }
    while (close <= base - brick && guard < 100) {
      base -= brick
      green = false
      guard += 1
    }
    signals.push(green ? 1 : 0)
  }
  return signals
}

function dualTrend(closes: number[], fastLength: number, slowLength: number, filterLength: number): number[] {
  const fast = sma(closes, fastLength)
  const slow = sma(closes, slowLength)
  const filter = sma(closes, filterLength)
  return closes.map((close, index) => {
    const fastValue = fast[index]
    const slowValue = slow[index]
    const filterValue = filter[index]
    if (fastValue == null || slowValue == null || filterValue == null) return 0
    if (fastValue > slowValue && close > filterValue) return 1
    if (fastValue < slowValue && close < filterValue) return -1
    return 0
  })
}
