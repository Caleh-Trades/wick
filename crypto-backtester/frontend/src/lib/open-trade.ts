import { markReturn } from "./backtest.ts"

/** Open profit in risk units. Long risk is entry minus stop. Short risk is stop minus entry. */
export function openR(side: "long" | "short", entry: number, stop: number, mark: number): number | null {
  if (!(entry > 0) || !(mark > 0) || !(stop > 0)) return null
  const risk = side === "long" ? entry - stop : stop - entry
  if (!(risk > 0)) return null
  const move = side === "long" ? mark - entry : entry - mark
  return move / risk
}

export function formatR(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—"
  const sign = value > 0 ? "+" : ""
  return `${sign}${value.toFixed(1)}R`
}

/** Best open return, in percent, from the mark and the bars since the fill. */
export function bestOpenReturn(
  side: "long" | "short",
  entry: number,
  mark: number,
  bars: Array<{ time: string; high: number; low: number }>,
  since: string,
): number {
  let best = markReturn(side, entry, mark)
  const sinceMs = Date.parse(since)
  for (const bar of bars) {
    if (Number.isFinite(sinceMs)) {
      const at = Date.parse(bar.time)
      if (Number.isFinite(at) && at < sinceMs) continue
    }
    best = Math.max(best, markReturn(side, entry, bar.high), markReturn(side, entry, bar.low))
  }
  return best
}

/** Current open profit is under the kept share of the best open profit. A flat or never-green trade stays quiet. */
export function gaveBack(current: number, best: number, percent: number): boolean {
  if (!(best > 0) || !(percent > 0)) return false
  return current < (percent / 100) * best
}
