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
  /** Win rate times average winning return, minus loss rate times average losing return. An open trade stays out. */
  expectancy: number | null
  /** Bars from the worst-drawdown peak until equity reclaims it. Null if it never does. */
  recovery_bars: number | null
  trades: number
  liquidations: number
  exposure_pct: number
  final_equity: number
  /** Commissions charged on entries and exits. Slippage stays in the fills. */
  fees_paid: number
  /** Total return with those commissions added back to ending equity. */
  return_before_fees_pct: number
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
  /** Worst open return, in percent, while the trade was on. Closed trades only. */
  mae?: number
  /** Best open return, in percent, while the trade was on. Closed trades only. */
  mfe?: number
  bars_held: number
  status: "open" | "closed" | "liquidated"
  /** Funding charged while this position was open. Zero on spot. */
  funding_paid: number
  /** Commission on the entry and, once closed, the exit. */
  fee_paid?: number
  /** Dollar slippage on the entry and, once closed, the exit. */
  slippage_paid?: number
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
  | "fair_value_gap"
  | "candle_trigger"
  | "heikin_ashi"
  | "break_structure"
  | "change_character"
  | "supply_demand"
  | "rsi_divergence"
  | "renko"

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
  /** Adverse fill, in basis points, on the entry and the exit. */
  slippageBps: number
  capital: number
  leverage: number
  /** Percent of equity lost if the stop is hit. Position size is this amount divided by the stop distance. */
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
  /** Three equal slices of the same pass. Parameters are not fit again. */
  walk_forward: SampleSlice[]
  equity: EquityPoint[]
  trades: Trade[]
  candles: Candle[]
}
