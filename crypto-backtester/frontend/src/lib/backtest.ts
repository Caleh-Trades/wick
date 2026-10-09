import { normalizeRule, resolveRunParams, ruleById } from "./runs.ts"
import type { BacktestResult, EquityPoint, RuleId, Run, TapeCandle, Trade } from "./types"

export const INITIAL_CAPITAL = 10_000
export const SLIPPAGE_BPS = 5

export function backtest(candles: TapeCandle[], run: Run, periodsPerYear: number): BacktestResult {
  if (candles.length < 3) {
    throw new Error("Need at least three bars before a backtest means anything.")
  }
  if (run.feeBps < 0 || run.feeBps > 1_000) {
    throw new Error("Fees have to be between 0 and 1000 basis points.")
  }
  const rule = normalizeRule(run.rule)
  const params = resolveRunParams({ ...run, rule })
  const closes = candles.map((bar) => bar.close)
  const highs = candles.map((bar) => bar.high)
  const lows = candles.map((bar) => bar.low)
  const signals = signalsFor(rule, closes, highs, lows, params)
  const fee = run.feeBps / 10_000
  const slip = SLIPPAGE_BPS / 10_000
  const simStart = 1
  const hi = candles.length - 1
  const bench = benchmark(candles, simStart, hi, INITIAL_CAPITAL, fee, slip)
  const account = new Account(INITIAL_CAPITAL, fee)
  const equity: EquityPoint[] = []
  const trades: Trade[] = []
  let peak = INITIAL_CAPITAL
  let exposed = 0
  let open: OpenTrade | null = null

  for (let index = simStart; index <= hi; index += 1) {
    let target = signals[index - 1] ?? 0
    if (target < 0) target = 0
    const bar = candles[index]
    if (!bar) continue
    if (sign(account.qty) !== target) {
      if (account.qty !== 0 && open) {
        const fill = closeFill(bar.open, account.qty, slip)
        const pnl = account.close(fill) - open.entryFee
        const notional = open.quantity * open.entryPrice
        trades.push({
          entry_time: open.entryTime,
          exit_time: bar.time,
          side: "long",
          entry_price: open.entryPrice,
          exit_price: fill,
          quantity: open.quantity,
          pnl,
          return_pct: notional ? (pnl / notional) * 100 : 0,
          bars_held: index - open.entryIndex,
          status: "closed",
        })
        open = null
      }
      if (target !== 0 && account.cash > 1) {
        const fill = openFill(bar.open, slip)
        const opened = account.open(fill)
        if (opened.quantity > 0) {
          open = {
            entryTime: bar.time,
            entryIndex: index,
            entryPrice: fill,
            entryFee: opened.fee,
            quantity: opened.quantity,
          }
        }
      }
    }

    if (account.qty !== 0) exposed += 1
    const marked = account.mark(bar.close)
    peak = Math.max(peak, marked)
    equity.push({
      time: bar.time,
      equity: marked,
      benchmark: bench[index] ?? INITIAL_CAPITAL,
      drawdown_pct: peak ? ((marked - peak) / peak) * 100 : 0,
      price: bar.close,
    })
  }

  if (open && account.qty !== 0) {
    const last = candles[hi]
    if (last) {
      const unrealized = account.qty * (last.close - account.entry) - open.entryFee
      const notional = open.quantity * open.entryPrice
      trades.push({
        entry_time: open.entryTime,
        exit_time: null,
        side: "long",
        entry_price: open.entryPrice,
        exit_price: last.close,
        quantity: open.quantity,
        pnl: unrealized,
        return_pct: notional ? (unrealized / notional) * 100 : 0,
        bars_held: hi - open.entryIndex,
        status: "open",
      })
    }
  }

  const window = candles.slice(simStart, hi + 1)
  const metrics = measure(equity, trades, INITIAL_CAPITAL, exposed, periodsPerYear)
  const first = window[0]
  const last = window[window.length - 1]
  return {
    symbol: run.symbol,
    interval: "",
    strategy: { id: rule, name: ruleById(rule)?.name ?? rule },
    params,
    source: "",
    window: {
      start: first?.time ?? "",
      end: last?.time ?? "",
      bars: window.length,
    },
    assumptions: {
      fill: "next_open",
      fee_bps: run.feeBps,
      slippage_bps: SLIPPAGE_BPS,
      initial_capital: INITIAL_CAPITAL,
      allow_short: false,
    },
    metrics,
    equity,
    trades,
    candles: window.map((bar) => ({
      time: bar.time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
    })),
  }
}

type OpenTrade = {
  entryTime: string
  entryIndex: number
  entryPrice: number
  entryFee: number
  quantity: number
}

function signalsFor(
  rule: RuleId,
  closes: number[],
  highs: number[],
  lows: number[],
  params: Record<string, number>,
): number[] {
  if (rule === "buy_hold") return closes.map(() => 1)
  if (rule === "sma_cross") return cross(sma(closes, params.fast ?? 20), sma(closes, params.slow ?? 50))
  if (rule === "ema_cross") return cross(ema(closes, params.fast ?? 12), ema(closes, params.slow ?? 26))
  if (rule === "rsi_reversion") {
    return rsiReversion(rsi(closes, params.period ?? 14), params.oversold ?? 30, params.overbought ?? 70)
  }
  if (rule === "bollinger") {
    const [mid, upper, lower] = bollinger(closes, params.period ?? 20, params.mult ?? 2)
    return bollingerBounce(closes, mid, upper, lower)
  }
  if (rule === "macd") {
    const [line, signal] = macd(closes, params.fast ?? 12, params.slow ?? 26, params.signal ?? 9)
    return cross(line, signal)
  }
  return donchian(closes, highs, lows, params.entry ?? 20, params.exit ?? 10)
}

function sma(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = Array.from({ length: values.length }, () => null)
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
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
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

function bollingerBounce(
  closes: number[],
  mid: Array<number | null>,
  upper: Array<number | null>,
  lower: Array<number | null>,
): number[] {
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
    if (close < lowBand) state = 1
    else if (close > highBand) state = -1
    else if (state === 1 && close >= center) state = 0
    else if (state === -1 && close <= center) state = 0
    signals.push(state)
  })
  return signals
}

function donchian(closes: number[], highs: number[], lows: number[], entry: number, exitWindow: number): number[] {
  const entryHigh = priorExtreme(highs, entry, true)
  const entryLow = priorExtreme(lows, entry, false)
  const exitHigh = priorExtreme(highs, exitWindow, true)
  const exitLow = priorExtreme(lows, exitWindow, false)
  const signals: number[] = []
  let state = 0
  closes.forEach((close, index) => {
    const brokeUp = entryHigh[index] != null && close > (entryHigh[index] ?? 0)
    const brokeDown = entryLow[index] != null && close < (entryLow[index] ?? 0)
    if (brokeUp) state = 1
    else if (brokeDown) state = -1
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

function rsiReversion(readings: Array<number | null>, oversold: number, overbought: number): number[] {
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

class Account {
  cash: number
  fee: number
  qty = 0
  entry = 0

  constructor(cash: number, fee: number) {
    this.cash = cash
    this.fee = fee
  }

  open(fill: number): { quantity: number; fee: number } {
    if (fill <= 0 || this.cash <= 0) return { quantity: 0, fee: 0 }
    const notional = this.cash / (1 + this.fee)
    const feePaid = notional * this.fee
    this.cash -= feePaid
    this.qty = notional / fill
    this.entry = fill
    return { quantity: this.qty, fee: feePaid }
  }

  close(fill: number): number {
    const pnl = this.qty * (fill - this.entry)
    const feePaid = Math.abs(this.qty) * fill * this.fee
    this.cash += pnl - feePaid
    this.qty = 0
    this.entry = 0
    return pnl - feePaid
  }

  mark(price: number): number {
    if (this.qty === 0) return this.cash
    return this.cash + this.qty * (price - this.entry)
  }
}

function sign(qty: number): number {
  if (qty > 0) return 1
  if (qty < 0) return -1
  return 0
}

function openFill(price: number, slip: number): number {
  return price * (1 + slip)
}

function closeFill(price: number, qty: number, slip: number): number {
  return qty > 0 ? price * (1 - slip) : price * (1 + slip)
}

function benchmark(
  candles: TapeCandle[],
  simStart: number,
  hi: number,
  initial: number,
  fee: number,
  slip: number,
): number[] {
  const first = candles[simStart]
  const marks = Array.from({ length: candles.length }, () => initial)
  if (!first || first.open <= 0) return marks
  const fill = first.open * (1 + slip)
  const notional = initial / (1 + fee)
  const cash = initial - notional * fee
  const qty = notional / fill
  for (let index = simStart; index <= hi; index += 1) {
    const bar = candles[index]
    if (!bar) continue
    marks[index] = cash + qty * (bar.close - fill)
  }
  return marks
}

function measure(
  equity: EquityPoint[],
  trades: Trade[],
  initial: number,
  exposedBars: number,
  periodsPerYear: number,
) {
  const last = equity[equity.length - 1]
  const finalEquity = last?.equity ?? initial
  const benchmarkFinal = last?.benchmark ?? initial
  const total = pct(finalEquity, initial)
  const benchmarkReturn = pct(benchmarkFinal, initial)
  const closed = trades.filter((trade) => trade.status === "closed")
  const returns = closed.map((trade) => trade.return_pct)
  const wins = closed.filter((trade) => trade.pnl > 0)
  const losses = closed.filter((trade) => trade.pnl < 0)
  const grossProfit = wins.reduce((sum, trade) => sum + trade.pnl, 0)
  const grossLoss = -losses.reduce((sum, trade) => sum + trade.pnl, 0)
  const barReturns: number[] = []
  let previous = initial
  for (const point of equity) {
    if (previous > 0) barReturns.push(point.equity / previous - 1)
    previous = point.equity
  }
  const drawdowns = equity.map((point) => point.drawdown_pct)
  return {
    total_return_pct: total,
    benchmark_return_pct: benchmarkReturn,
    excess_return_pct: total - benchmarkReturn,
    cagr_pct: last ? cagr(initial, finalEquity, equity[0]?.time ?? "", last.time) : null,
    max_drawdown_pct: drawdowns.length ? Math.min(...drawdowns) : 0,
    sharpe: sharpe(barReturns, periodsPerYear),
    sortino: sortino(barReturns, periodsPerYear),
    win_rate_pct: closed.length ? (wins.length / closed.length) * 100 : null,
    profit_factor: grossLoss > 0 ? grossProfit / grossLoss : null,
    trades: closed.length,
    exposure_pct: equity.length ? (exposedBars / equity.length) * 100 : 0,
    final_equity: finalEquity,
    avg_trade_pct: returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : null,
    best_trade_pct: returns.length ? Math.max(...returns) : null,
    worst_trade_pct: returns.length ? Math.min(...returns) : null,
  }
}

function pct(final: number, initial: number): number {
  if (initial === 0) return 0
  return (final / initial - 1) * 100
}

function cagr(initial: number, final: number, start: string, end: string): number | null {
  const days = (Date.parse(end) - Date.parse(start)) / 86_400_000
  if (days < 1 || initial <= 0 || final <= 0) return null
  return ((final / initial) ** (365.25 / days) - 1) * 100
}

function sharpe(returns: number[], periodsPerYear: number): number | null {
  if (returns.length < 2) return null
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1)
  if (variance <= 0) return null
  return (mean / Math.sqrt(variance)) * Math.sqrt(periodsPerYear)
}

function sortino(returns: number[], periodsPerYear: number): number | null {
  if (returns.length < 2) return null
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length
  const downside = returns.reduce((sum, value) => sum + Math.min(value, 0) ** 2, 0) / returns.length
  if (downside <= 0) return null
  return (mean / Math.sqrt(downside)) * Math.sqrt(periodsPerYear)
}
