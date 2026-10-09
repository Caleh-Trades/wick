import type { BacktestResult, Draft, MarketId, Meta, Tape, TapeCandle, Timeframe } from "@/lib/types"

const base = (import.meta.env.VITE_API_URL as string | undefined) ?? ""

export async function fetchMeta(): Promise<Meta> {
  return request<Meta>("/api/meta")
}

export async function fetchCandles(symbol: MarketId, interval: Timeframe, since?: number): Promise<Tape> {
  const params = new URLSearchParams({ symbol, interval })
  if (since != null) params.set("since", String(since))
  const body = await request<TapePayload>(`/api/candles?${params.toString()}`)
  return {
    symbol,
    interval,
    source: body.source,
    seconds: body.seconds,
    periodsPerYear: body.periods_per_year,
    candles: body.candles.map(normalizeCandle),
  }
}

export async function runBacktest(draft: Draft): Promise<BacktestResult> {
  return request<BacktestResult>("/api/backtest", {
    method: "POST",
    body: JSON.stringify({
      symbol: draft.symbol,
      interval: draft.interval,
      strategy: draft.strategy,
      params: draft.params,
      start: draft.start || null,
      end: draft.end || null,
      initial_capital: draft.initial_capital,
      fee_bps: draft.fee_bps,
      slippage_bps: draft.slippage_bps,
      allow_short: draft.allow_short,
    }),
  })
}

type TapePayload = {
  source: string
  seconds: number
  periods_per_year: number
  candles: Array<TapeCandle & { t?: number }>
}

function normalizeCandle(candle: TapeCandle & { t?: number }): TapeCandle {
  const t = candle.t ?? Math.floor(Date.parse(candle.time) / 1000)
  return {
    t,
    time: candle.time,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(90_000),
    })
  } catch {
    throw new Error(
      "The desk can't reach the backtester. Start it with uvicorn on port 8000, then run this again.",
    )
  }

  const text = await response.text()
  const body = text ? (JSON.parse(text) as { detail?: unknown }) : null
  if (!response.ok) {
    const fallback = path.startsWith("/api/candles") ? "The tape didn't load." : "The backtest didn't run."
    const detail = body && typeof body.detail === "string" ? body.detail : fallback
    throw new Error(detail)
  }
  return body as T
}
