import { normalizeRule, resolveRunParams, ruleById } from "./runs.ts"
import { buildSignals } from "./signals.ts"
import type { BacktestResult, EquityPoint, Run, TapeCandle, Trade } from "./types"

export const INITIAL_CAPITAL = 10_000
export const SLIPPAGE_BPS = 5

export function backtest(candles: TapeCandle[], run: Run, periodsPerYear: number): BacktestResult {
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
  const signals = buildSignals(rule, candles, params)
  const fee = run.feeBps / 10_000
  const slip = SLIPPAGE_BPS / 10_000
  const simStart = 1
  const hi = candles.length - 1
  const bench = benchmark(candles, simStart, hi, capital, fee, slip)
  const account = new Account(capital, fee)
  const equity: EquityPoint[] = []
  const trades: Trade[] = []
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
        const fill = closeFill(bar.open, account.qty, slip)
        const pnl = account.close(fill) - open.entryFee
        const notional = open.quantity * open.entryPrice
        trades.push({
          entry_time: open.entryTime,
          exit_time: bar.time,
          side: open.side,
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
        const fill = openFill(bar.open, target, slip)
        const opened = account.open(target, fill)
        if (opened.quantity > 0) {
          open = {
            entryTime: bar.time,
            entryIndex: index,
            entryPrice: fill,
            entryFee: opened.fee,
            quantity: opened.quantity,
            side: target > 0 ? "long" : "short",
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
      benchmark: bench[index] ?? capital,
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
        side: open.side,
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
  const metrics = measure(equity, trades, capital, exposed, periodsPerYear)
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
      initial_capital: capital,
      allow_short: allowShort,
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
  side: "long" | "short"
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

  open(side: number, fill: number): { quantity: number; fee: number } {
    if (fill <= 0 || this.cash <= 0 || side === 0) return { quantity: 0, fee: 0 }
    const notional = this.cash / (1 + this.fee)
    const feePaid = notional * this.fee
    this.cash -= feePaid
    this.qty = side * (notional / fill)
    this.entry = fill
    return { quantity: Math.abs(this.qty), fee: feePaid }
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
