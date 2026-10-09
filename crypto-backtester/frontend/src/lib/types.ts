export type ParamSpec = {
  key: string
  label: string
  min: number
  max: number
  step: number
  default: number
  integer: boolean
}

export type StrategySpec = {
  id: string
  name: string
  summary: string
  params: ParamSpec[]
}

export type SymbolSpec = {
  id: string
  base: string
  quote: string
  name: string
}

export type IntervalSpec = {
  id: string
  label: string
  detail: string
}

export type Meta = {
  symbols: SymbolSpec[]
  intervals: IntervalSpec[]
  strategies: StrategySpec[]
  defaults: {
    symbol: string
    interval: string
    strategy: string
    initial_capital: number
    fee_bps: number
    slippage_bps: number
    allow_short: boolean
  }
}

export type Draft = {
  symbol: string
  interval: string
  strategy: string
  params: Record<string, number>
  start: string
  end: string
  initial_capital: number
  fee_bps: number
  slippage_bps: number
  allow_short: boolean
}

export type Metrics = {
  total_return_pct: number
  benchmark_return_pct: number
  excess_return_pct: number
  cagr_pct: number | null
  max_drawdown_pct: number
  sharpe: number | null
  sortino: number | null
  win_rate_pct: number | null
  profit_factor: number | null
  trades: number
  liquidations: number
  exposure_pct: number
  final_equity: number
  avg_trade_pct: number | null
  best_trade_pct: number | null
  worst_trade_pct: number | null
}

export type EquityPoint = {
  time: string
  equity: number
  benchmark: number
  drawdown_pct: number
  price: number
}

export type Trade = {
  entry_time: string
  exit_time: string | null
  side: "long" | "short"
  entry_price: number
  exit_price: number | null
  quantity: number
  pnl: number
  return_pct: number
  bars_held: number
  status: "open" | "closed" | "liquidated"
  /** Funding charged while this position was open. Zero on spot. */
  funding_paid: number
}

/** One window of a single pass. Parameters are not fit again on the holdout. */
export type SampleSlice = {
  total_return_pct: number
  max_drawdown_pct: number
  sharpe: number | null
  trades: number
}

export type Candle = {
  time: string
  open: number
  high: number
  low: number
  close: number
}

export type TapeCandle = Candle & { t: number; volume?: number }

export type RangeId = "1D" | "5D" | "1M" | "3M" | "1Y" | "2Y" | "4Y" | "6Y" | "All"

export type Venue = "spot" | "perp"

export type FundingRate = {
  t: number
  rate: number
  mark?: number
}

export type Timeframe = "1m" | "3m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d"

export type RuleId =
  | "buy_hold"
  | "sma_cross"
  | "ema_cross"
  | "donchian"
  | "tsmom"
  | "bollinger"
  | "bb_break"
  | "rsi_reversion"
  | "macd"
  | "keltner"
  | "supertrend"
  | "orb"
  | "prev_day"
  | "gap_fade"
  | "gap_go"
  | "vwap"
  | "chandelier"
  | "dual_ma"

export type MarketId = string

export type RunParams = Record<string, number>

export type ComboRule = {
  rule: RuleId
  params: RunParams
}

export type Run = {
  id: string
  name: string
  symbol: MarketId
  rule: RuleId
  params: RunParams
  /** Extra strategies that must agree with `rule` before a position opens. */
  combo: ComboRule[]
  feeBps: number
  capital: number
  leverage: number
  /** Percent of equity lost if this trade is wiped out. 100 uses the whole balance. */
  riskPct: number
  allowShort: boolean
  hidden: boolean
}

export type Tape = {
  symbol: MarketId
  interval: Timeframe
  range: RangeId
  source: string
  venue: Venue
  seconds: number
  periodsPerYear: number
  candles: TapeCandle[]
  funding?: FundingRate[] | null
  fundingStale?: boolean
}

export type SortKey = "sharpe" | "win_rate_pct" | "profit_factor" | "cagr_pct" | "trades"

export type Outcome =
  | { ok: true; result: BacktestResult; fingerprint: string }
  | { ok: false; error: string; fingerprint: string }

export type BacktestResult = {
  symbol: string
  interval: string
  strategy: { id: string; name: string }
  params: Record<string, number>
  source: string
  window: { start: string; end: string; bars: number }
  assumptions: {
    fill: string
    fee_bps: number
    slippage_bps: number
    initial_capital: number
    allow_short: boolean
    venue: Venue
    leverage: number
    risk_pct: number
    maintenance_margin: number
    funding_stale: boolean
  }
  metrics: Metrics
  /** First 70% of simulated bars, measured from the starting balance. */
  in_sample: SampleSlice
  /** Last 30% of simulated bars, measured from equity at the split. */
  holdout: SampleSlice
  equity: EquityPoint[]
  trades: Trade[]
  candles: Candle[]
}
