import { clampRisk, normalizeCombo, normalizeRule, resolveRunParams, strategyLabel } from "./runs.ts"
import { buildSignals } from "./signals.ts"
import type { BacktestResult, EquityPoint, FundingRate, Run, SampleSlice, TapeCandle, Trade, Venue } from "./types"

export const INITIAL_CAPITAL = 10_000
export const SLIPPAGE_BPS = 5
export const MAINTENANCE_MARGIN = 0.004
export const DEFAULT_LEVERAGE = 3

export type BacktestOptions = {
  venue?: Venue
  funding?: FundingRate[] | null
  fundingStale?: boolean
}

export function liquidationPrice(entry: number, side: "long" | "short", leverage: number): number {
  if (side === "long") return entry * (1 - 1 / leverage + MAINTENANCE_MARGIN)
  return entry * (1 + 1 / leverage - MAINTENANCE_MARGIN)
}

export function backtest(
  candles: TapeCandle[],
  run: Run,
  periodsPerYear: number,
  options?: BacktestOptions,
): BacktestResult {
  if (candles.length < 3) {
    throw new Error("Need at least three bars before a backtest means anything.")
  }
  if (run.feeBps < 0 || run.feeBps > 1_000) {
    throw new Error("Fees have to be between 0 and 1000 basis points.")
  }
  const capital = run.capital
  if (!(capital > 0) || capital > 1_000_000_000) {
    throw new Error("Base balance has to sit between 1 and 1,000,000,000.")
  }
  const rule = normalizeRule(run.rule)
  const params = resolveRunParams({ ...run, rule })
  const combo = normalizeCombo(run.combo, rule)
  const signals = combineSignals([
    buildSignals(rule, candles, params),
    ...combo.map((item) => buildSignals(item.rule, candles, resolveRunParams({ ...run, rule: item.rule, params: item.params }))),
  ])
  const venue = options?.venue ?? "spot"
  const leverage = venue === "perp" ? clampLeverage(run.leverage) : 1
  const riskPct = clampRisk(run.riskPct)
  if (venue === "perp" && options?.funding == null) {
    throw new Error("Funding history didn't load.")
  }
  const funding = venue === "perp" ? [...(options?.funding ?? [])].sort((left, right) => left.t - right.t) : []
  let fundIndex = 0
  const fee = run.feeBps / 10_000
  const slip = SLIPPAGE_BPS / 10_000
  const simStart = 1
  const hi = candles.length - 1
  const bench = benchmark(candles, simStart, hi, capital, fee, slip)
  const account = new Account(capital, fee)
  const equity: EquityPoint[] = []
  const trades: Trade[] = []
  const exits: number[] = []
  let peak = capital
  let exposed = 0
  let open: OpenTrade | null = null

  const allowShort = run.allowShort !== false
  for (let index = simStart; index <= hi; index += 1) {
    let target = signals[index - 1] ?? 0
    if (!allowShort && target < 0) target = 0
    const bar = candles[index]
    if (!bar) continue
    if (sign(account.qty) !== target) {
      if (account.qty !== 0 && open) {
        pushClose(trades, exits, open, account, closeFill(bar.open, account.qty, slip), bar.time, index, "closed")
        open = null
      }
      if (target !== 0 && account.cash > 1) {
        const fill = openFill(bar.open, target, slip)
        const opened = account.open(target, fill, leverage, riskPct / 100)
        if (opened.quantity > 0) {
          open = {
            entryTime: bar.time,
            entryIndex: index,
            entryPrice: fill,
            entryFee: opened.fee,
            quantity: opened.quantity,
            side: target > 0 ? "long" : "short",
            fundingPaid: 0,
          }
        }
      }
    }

    if (open && account.qty !== 0) {
      const end = barEnd(candles, index)
      while (fundIndex < funding.length && funding[fundIndex]!.t <= bar.t) fundIndex += 1
      while (fundIndex < funding.length && funding[fundIndex]!.t <= end) {
        const event = funding[fundIndex]!
        const mark = event.mark != null && event.mark > 0 ? event.mark : bar.close
        open.fundingPaid += account.applyFunding(event.rate, mark)
        fundIndex += 1
      }
      const liq = liquidationPrice(open.entryPrice, open.side, leverage)
      const hit = open.side === "long" ? bar.low <= liq : bar.high >= liq
      if (venue === "perp" && hit) {
        pushClose(trades, exits, open, account, liq, bar.time, index, "liquidated")
        open = null
      }
    }

    if (account.qty !== 0 || (trades[trades.length - 1]?.status === "liquidated" && trades[trades.length - 1]?.exit_time === bar.time)) {
      exposed += 1
    }
    const marked = account.mark(bar.close)
    peak = Math.max(peak, marked)
    equity.push({
      time: bar.time,
      equity: marked,
      benchmark: bench[index] ?? capital,
      drawdown_pct: peak ? ((marked - peak) / peak) * 100 : 0,
      price: bar.close,
    })
  }

  if (open && account.qty !== 0) {
    const last = candles[hi]
    if (last) {
      const unrealized = account.qty * (last.close - account.entry) - open.entryFee - open.fundingPaid
      const notional = open.quantity * open.entryPrice
      trades.push({
        entry_time: open.entryTime,
        exit_time: null,
        side: open.side,
        entry_price: open.entryPrice,
        exit_price: last.close,
        quantity: open.quantity,
        pnl: unrealized,
        return_pct: notional ? (unrealized / notional) * 100 : 0,
        bars_held: hi - open.entryIndex,
        status: "open",
        funding_paid: open.fundingPaid,
      })
      exits.push(hi)
    }
  }

  const window = candles.slice(simStart, hi + 1)
  const metrics = measure(equity, trades, capital, exposed, periodsPerYear)
  const split = Math.floor(equity.length * 0.7)
  const boundary = equity[split - 1]?.equity ?? capital
  const inSampleTrades = trades.filter((_, index) => (exits[index] ?? simStart) - simStart < split)
  const holdoutTrades = trades.filter((_, index) => (exits[index] ?? simStart) - simStart >= split)
  const first = window[0]
  const last = window[window.length - 1]
  return {
    symbol: run.symbol,
    interval: "",
    strategy: { id: rule, name: strategyLabel({ rule, combo }) },
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
      initial_capital: capital,
      allow_short: allowShort,
      venue,
      leverage,
      risk_pct: riskPct,
      maintenance_margin: venue === "perp" ? MAINTENANCE_MARGIN : 0,
      funding_stale: venue === "perp" && options?.fundingStale === true,
    },
    metrics,
    in_sample: measureSlice(equity.slice(0, split), inSampleTrades, capital, periodsPerYear),
    holdout: measureSlice(equity.slice(split), holdoutTrades, boundary, periodsPerYear),
    walk_forward: walkForward(equity, trades, exits, simStart, capital, periodsPerYear),
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
  side: "long" | "short"
  fundingPaid: number
}

function pushClose(
  trades: Trade[],
  exits: number[],
  open: OpenTrade,
  account: Account,
  fill: number,
  exitTime: string,
  index: number,
  status: "closed" | "liquidated",
) {
  const pnl = account.close(fill) - open.entryFee - open.fundingPaid
  const notional = open.quantity * open.entryPrice
  trades.push({
    entry_time: open.entryTime,
    exit_time: exitTime,
    side: open.side,
    entry_price: open.entryPrice,
    exit_price: fill,
    quantity: open.quantity,
    pnl,
    return_pct: notional ? (pnl / notional) * 100 : 0,
    bars_held: index - open.entryIndex,
    status,
    funding_paid: open.fundingPaid,
  })
  exits.push(index)
}

function barEnd(candles: TapeCandle[], index: number): number {
  const current = candles[index]?.t ?? 0
  const next = candles[index + 1]?.t
  if (next != null) return next
  const prev = candles[index - 1]?.t
  const step = prev != null ? current - prev : 0
  return current + Math.max(0, step)
}

function clampLeverage(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_LEVERAGE
  return Math.min(20, Math.max(1, value))
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

  open(side: number, fill: number, leverage = 1, risk = 1): { quantity: number; fee: number } {
    if (fill <= 0 || this.cash <= 0 || side === 0) return { quantity: 0, fee: 0 }
    const scale = Math.min(20, Math.max(1, leverage))
    const fraction = Math.min(1, Math.max(0.001, risk))
    const budget = this.cash * fraction
    const notional = (budget * scale) / (1 + this.fee * scale)
    const feePaid = notional * this.fee
    this.cash -= feePaid
    this.qty = side * (notional / fill)
    this.entry = fill
    return { quantity: Math.abs(this.qty), fee: feePaid }
  }

  applyFunding(rate: number, mark: number): number {
    if (this.qty === 0 || mark <= 0 || !Number.isFinite(rate)) return 0
    const payment = this.qty * mark * rate
    this.cash -= payment
    return payment
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

function combineSignals(rows: number[][]): number[] {
  const length = rows[0]?.length ?? 0
  return Array.from({ length }, (_, index) => {
    const values = rows.map((row) => row[index] ?? 0)
    if (values.every((value) => value > 0)) return 1
    if (values.every((value) => value < 0)) return -1
    return 0
  })
}

function sign(qty: number): number {
  if (qty > 0) return 1
  if (qty < 0) return -1
  return 0
}

function openFill(price: number, side: number, slip: number): number {
  return side > 0 ? price * (1 + slip) : price * (1 - slip)
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

export function holdoutWarn(metrics: { sharpe: number | null }, holdout: { sharpe: number | null }): boolean {
  return metrics.sharpe != null && metrics.sharpe > 0 && holdout.sharpe != null && holdout.sharpe < 0
}

function walkForward(
  equity: EquityPoint[],
  trades: Trade[],
  exits: number[],
  simStart: number,
  capital: number,
  periodsPerYear: number,
): SampleSlice[] {
  const count = equity.length
  const cuts = [0, Math.floor(count / 3), Math.floor((2 * count) / 3), count]
  return [0, 1, 2].map((window) => {
    const start = cuts[window] ?? 0
    const end = cuts[window + 1] ?? count
    const startEquity = window === 0 ? capital : (equity[start - 1]?.equity ?? capital)
    const windowTrades = trades.filter((_, index) => {
      const exit = (exits[index] ?? simStart) - simStart
      return exit >= start && exit < end
    })
    return measureSlice(equity.slice(start, end), windowTrades, startEquity, periodsPerYear)
  })
}

function measureSlice(points: EquityPoint[], trades: Trade[], startEquity: number, periodsPerYear: number): SampleSlice {
  if (points.length === 0) {
    return { total_return_pct: 0, max_drawdown_pct: 0, sharpe: null, trades: 0 }
  }
  let peak = startEquity
  let previous = startEquity
  const drawdowns: number[] = []
  const barReturns: number[] = []
  for (const point of points) {
    peak = Math.max(peak, point.equity)
    drawdowns.push(peak ? ((point.equity - peak) / peak) * 100 : 0)
    if (previous > 0) barReturns.push(point.equity / previous - 1)
    previous = point.equity
  }
  const finalEquity = points[points.length - 1]?.equity ?? startEquity
  const closed = trades.filter((trade) => trade.status === "closed" || trade.status === "liquidated")
  const liquidations = trades.filter((trade) => trade.status === "liquidated").length
  return {
    total_return_pct: pct(finalEquity, startEquity),
    max_drawdown_pct: drawdowns.length ? Math.min(...drawdowns) : 0,
    sharpe: sharpe(barReturns, periodsPerYear),
    trades: closed.length - liquidations,
  }
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
  const closed = trades.filter((trade) => trade.status === "closed" || trade.status === "liquidated")
  const liquidations = trades.filter((trade) => trade.status === "liquidated").length
  const returns = closed.map((trade) => trade.return_pct)
  const wins = closed.filter((trade) => trade.pnl > 0)
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
    profit_factor: profitFactor(trades),
    expectancy: tradeExpectancy(closed),
    recovery_bars: recoveryBars(equity, initial),
    trades: closed.length - liquidations,
    liquidations,
    exposure_pct: equity.length ? (exposedBars / equity.length) * 100 : 0,
    final_equity: finalEquity,
    avg_trade_pct: returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : null,
    best_trade_pct: returns.length ? Math.max(...returns) : null,
    worst_trade_pct: returns.length ? Math.min(...returns) : null,
  }
}

/** Gross winning pnl divided by gross losing pnl. Open trades count. No losses is null. */
export function profitFactor(trades: Array<{ pnl: number }>): number | null {
  let grossWin = 0
  let grossLoss = 0
  for (const trade of trades) {
    if (trade.pnl > 0) grossWin += trade.pnl
    else if (trade.pnl < 0) grossLoss -= trade.pnl
  }
  if (!(grossLoss > 0)) return null
  return grossWin / grossLoss
}

function tradeExpectancy(closed: Trade[]): number | null {
  if (closed.length === 0) return null
  const wins = closed.filter((trade) => trade.pnl > 0)
  const losses = closed.filter((trade) => trade.pnl < 0)
  const winRate = wins.length / closed.length
  const avgWin = wins.length ? wins.reduce((sum, trade) => sum + trade.return_pct, 0) / wins.length : 0
  const avgLoss = losses.length ? losses.reduce((sum, trade) => sum + Math.abs(trade.return_pct), 0) / losses.length : 0
  return avgWin * winRate - avgLoss * (1 - winRate)
}

function recoveryBars(equity: EquityPoint[], initial: number): number | null {
  if (equity.length === 0) return 0
  let worst = 0
  let trough = -1
  for (let index = 0; index < equity.length; index += 1) {
    const drawdown = equity[index]?.drawdown_pct ?? 0
    if (drawdown < worst) {
      worst = drawdown
      trough = index
    }
  }
  if (trough < 0) return 0
  let peak = initial
  let peakAt = -1
  for (let index = 0; index <= trough; index += 1) {
    const marked = equity[index]?.equity ?? peak
    if (marked >= peak) {
      peak = marked
      peakAt = index
    }
  }
  if ((equity[trough]?.equity ?? peak) >= peak) return 0
  for (let index = trough + 1; index < equity.length; index += 1) {
    if ((equity[index]?.equity ?? 0) >= peak) return index - peakAt
  }
  return null
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
