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
  status: "open" | "closed"
}

export type Candle = {
  time: string
  open: number
  high: number
  low: number
  close: number
}

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
  }
  metrics: Metrics
  equity: EquityPoint[]
  trades: Trade[]
  candles: Candle[]
}
