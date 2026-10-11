import { barSeconds } from "@/lib/forming"

/** Bars from entry to now for this bar size. */
export function barsOpen(entryTime: string, timeframe: string, nowMs = Date.now()): number {
  const entry = Date.parse(entryTime)
  const seconds = barSeconds(timeframe)
  if (!Number.isFinite(entry) || seconds <= 0) return 0
  const elapsed = Math.max(0, nowMs - entry) / 1000
  return Math.floor(elapsed / seconds)
}

export function timeStopDue(entryTime: string, timeframe: string, maxBars: number | null | undefined, nowMs = Date.now()): boolean {
  if (maxBars == null || !(maxBars > 0)) return false
  return barsOpen(entryTime, timeframe, nowMs) >= maxBars
}

export function clampMaxBars(value: unknown): number | null {
  if (value == null || value === "") return null
  const next = Math.round(Number(value))
  if (!Number.isFinite(next) || next <= 0) return null
  return Math.min(10_000, next)
}
