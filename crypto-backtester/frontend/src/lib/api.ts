import type { SpotMarket } from "@/lib/markets"
import { fetchPublicTape } from "@/lib/public-tape"
import type { BacktestResult, Draft, FundingRate, MarketId, Meta, RangeId, Tape, TapeCandle, Timeframe, Venue } from "@/lib/types"

const base = (import.meta.env?.VITE_API_URL as string | undefined) ?? ""

export type PremiumQuote = {
  symbol: string
  rate: number
  nextFundingTime: number
  stale: boolean
}

export async function fetchPremium(symbol: string): Promise<PremiumQuote> {
  const body = await request<PremiumQuote>(`/api/premium?symbol=${encodeURIComponent(symbol)}`)
  if (!Number.isFinite(body.rate) || !Number.isFinite(body.nextFundingTime)) {
    throw new Error("Binance did not return a funding rate.")
  }
  return {
    symbol: body.symbol,
    rate: body.rate,
    nextFundingTime: body.nextFundingTime,
    stale: body.stale === true,
  }
}

export async function fetchMarkets(venue: Venue = "spot"): Promise<SpotMarket[]> {
  const body = await request<{ markets: SpotMarket[] }>(`/api/markets?venue=${venue}`)
  return Array.isArray(body.markets) ? body.markets : []
}

export async function fetchMeta(): Promise<Meta> {
  return request<Meta>("/api/meta")
}

export async function fetchCandles(
  symbol: MarketId,
  interval: Timeframe,
  options?: { since?: number; days?: number; range?: RangeId; venue?: Venue },
): Promise<Tape> {
  try {
    return await fetchDeskCandles(symbol, interval, options)
  } catch (reason) {
    try {
      return await fetchPublicTape(symbol, interval, options)
    } catch {
      throw reason instanceof Error ? reason : new Error("The tape didn't load.")
    }
  }
}

async function fetchDeskCandles(
  symbol: MarketId,
  interval: Timeframe,
  options?: { since?: number; days?: number; range?: RangeId; venue?: Venue },
): Promise<Tape> {
  const venue = options?.venue ?? "spot"
  const params = new URLSearchParams({ symbol, interval, venue })
  if (options?.since != null) params.set("since", String(options.since))
  else if (options?.days != null) params.set("days", String(options.days))
  const body = await request<TapePayload>(`/api/candles?${params.toString()}`, undefined, 20_000)
  return {
    symbol,
    interval,
    range: options?.range ?? "All",
    source: body.source,
    venue,
    seconds: body.seconds,
    periodsPerYear: body.periods_per_year,
    candles: body.candles.map(normalizeCandle),
    funding: venue === "perp" ? normalizeFunding(body.funding) : undefined,
    fundingStale: venue === "perp" ? body.funding_stale === true || body.funding == null : false,
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
  funding?: FundingRate[] | null
  funding_stale?: boolean
}

export function mergeFunding(existing: FundingRate[] | null | undefined, incoming: FundingRate[] | null | undefined): FundingRate[] | null {
  if (incoming == null) return existing ?? null
  const byTime = new Map<number, FundingRate>()
  for (const rate of existing ?? []) byTime.set(rate.t, rate)
  for (const rate of incoming) byTime.set(rate.t, rate)
  return [...byTime.values()].sort((left, right) => left.t - right.t)
}

function normalizeFunding(rates: FundingRate[] | null | undefined): FundingRate[] | null {
  if (!Array.isArray(rates)) return null
  return rates
    .filter((rate) => Number.isFinite(rate.t) && Number.isFinite(rate.rate))
    .map((rate) => ({
      t: rate.t,
      rate: rate.rate,
      mark: rate.mark != null && Number.isFinite(rate.mark) ? rate.mark : undefined,
    }))
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
    volume: typeof candle.volume === "number" ? candle.volume : undefined,
  }
}

export function requestFailure(reason: unknown, fallback: string): string {
  if (timedOut(reason)) return "The tape took too long."
  if (reason instanceof Error && reason.message) return reason.message
  return fallback
}

function timedOut(reason: unknown): boolean {
  if (!reason || typeof reason !== "object") return false
  const name = "name" in reason ? String(reason.name) : ""
  const message = "message" in reason ? String(reason.message) : ""
  return name === "TimeoutError" || message === "signal timed out"
}

async function request<T>(path: string, init?: RequestInit, timeoutMs = 90_000): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (reason) {
    if (timedOut(reason)) throw new Error("The tape took too long.")
    throw new Error(
      "The desk can't reach the backtester. Start it with uvicorn on port 8000, then run this again.",
    )
  }

  let text: string
  try {
    text = await response.text()
  } catch (reason) {
    if (timedOut(reason)) throw new Error("The tape took too long.")
    throw new Error(
      "The desk can't reach the backtester. Start it with uvicorn on port 8000, then run this again.",
    )
  }
  let body: { detail?: unknown } | null = null
  if (text) {
    try {
      body = JSON.parse(text) as { detail?: unknown }
    } catch {
      body = null
    }
  }
  if (!response.ok) {
    const fallback = path.startsWith("/api/candles") ? "The tape didn't load." : "The backtest didn't run."
    const detail = detailText(body?.detail)
    throw new Error(detail ?? (text ? `${fallback} (${response.status})` : fallback))
  }
  if (body == null) throw new Error(path.startsWith("/api/candles") ? "The tape didn't load." : "The backtest didn't run.")
  return body as T
}

function detailText(detail: unknown): string | null {
  if (typeof detail === "string" && detail.trim()) return detail
  if (!Array.isArray(detail)) return null
  const parts = detail.flatMap((item) => {
    if (typeof item === "string" && item.trim()) return [item]
    if (item && typeof item === "object" && "msg" in item && typeof item.msg === "string" && item.msg.trim()) return [item.msg]
    return []
  })
  return parts.length > 0 ? parts.join(" ") : null
}
