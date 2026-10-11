/** Second target price from entry, stop, and an R multiple. */
export function scaleOutPrice(side: "long" | "short", entry: number, stop: number, rMultiple: number): number | null {
  if (!(entry > 0) || !(stop > 0) || !(rMultiple > 0)) return null
  const risk = side === "long" ? entry - stop : stop - entry
  if (!(risk > 0)) return null
  return side === "long" ? entry + rMultiple * risk : entry - rMultiple * risk
}

/** True when the mark has reached the scale-out target. */
export function scaleOutHit(side: "long" | "short", entry: number, stop: number, rMultiple: number, mark: number): boolean {
  const target = scaleOutPrice(side, entry, stop, rMultiple)
  if (target == null || !(mark > 0)) return false
  return side === "long" ? mark >= target : mark <= target
}

export function scaleOutSize(size: number, percent: number): number {
  if (!(size > 0) || !(percent > 0) || !(percent < 100)) return 0
  return Math.round(size * (percent / 100) * 1e8) / 1e8
}

export function clampScaleOutR(value: unknown, fallback = 2): number {
  const next = Number(value)
  if (!Number.isFinite(next) || next <= 0) return fallback
  return Math.min(20, Math.max(0.1, next))
}

export function clampScaleOutPct(value: unknown, fallback = 50): number {
  const next = Math.round(Number(value))
  if (!Number.isFinite(next)) return fallback
  return Math.min(99, Math.max(1, next))
}
