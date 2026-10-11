import type { RunParams, Timeframe, Venue } from "@/lib/types"
import { isTimeframe, isVenue, normalizeRule } from "@/lib/runs"

export type ShareSpec = {
  symbol: string
  market: Venue
  timeframe: Timeframe
  rule: string
  params: RunParams
}

/** Compact share URL. Opening it restores a slot. No account. */
export function shareRunSearch(spec: ShareSpec): string {
  const params = new URLSearchParams()
  params.set("share", "1")
  params.set("symbol", spec.symbol)
  params.set("market", spec.market)
  params.set("tf", spec.timeframe)
  params.set("rule", normalizeRule(spec.rule))
  const packed = Object.entries(spec.params)
    .filter(([, value]) => Number.isFinite(value))
    .map(([key, value]) => `${key}:${value}`)
    .join(",")
  if (packed) params.set("params", packed)
  return `?${params.toString()}`
}

export function shareRunUrl(spec: ShareSpec, origin = typeof window !== "undefined" ? window.location.origin : ""): string {
  const path = typeof window !== "undefined" ? window.location.pathname : "/"
  return `${origin}${path}${shareRunSearch(spec)}`
}

export function parseShareRun(search: string): ShareSpec | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
  if (params.get("share") !== "1") return null
  const symbol = (params.get("symbol") ?? "").trim().toUpperCase()
  if (!symbol.endsWith("USDT")) return null
  const marketRaw = params.get("market") ?? "spot"
  const market = isVenue(marketRaw) ? marketRaw : null
  const tf = params.get("tf") ?? ""
  const timeframe = isTimeframe(tf) ? tf : null
  const rule = params.get("rule")
  if (!market || !timeframe || !rule) return null
  const packed = params.get("params") ?? ""
  const runParams: RunParams = {}
  if (packed) {
    for (const part of packed.split(",")) {
      const [key, raw] = part.split(":")
      if (!key) continue
      const value = Number(raw)
      if (Number.isFinite(value)) runParams[key] = value
    }
  }
  return { symbol, market, timeframe, rule: normalizeRule(rule), params: runParams }
}

export async function copyShareRun(spec: ShareSpec): Promise<string> {
  const url = shareRunUrl(spec)
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(url)
  }
  return url
}
