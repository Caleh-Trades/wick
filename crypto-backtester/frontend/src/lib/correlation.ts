const DAY = 86_400

/** One close per UTC day, then the close-to-close return on consecutive days. The newest `days` returns stay. */
export function dailyReturns(candles: Array<{ t: number; close: number }>, days = 30): Map<number, number> {
  const byDay = new Map<number, number>()
  for (const bar of candles) {
    if (!(bar.close > 0) || !(bar.t > 0)) continue
    byDay.set(Math.floor(bar.t / DAY), bar.close)
  }
  const ordered = [...byDay.keys()].sort((left, right) => left - right)
  const returns = new Map<number, number>()
  for (let index = 1; index < ordered.length; index += 1) {
    const day = ordered[index] ?? 0
    const prev = ordered[index - 1] ?? 0
    if (day - prev !== 1) continue
    const prevClose = byDay.get(prev) ?? 0
    const close = byDay.get(day) ?? 0
    if (!(prevClose > 0)) continue
    returns.set(day, close / prevClose - 1)
  }
  const newest = [...returns.keys()].sort((left, right) => right - left).slice(0, days)
  const keep = new Set(newest)
  for (const day of returns.keys()) {
    if (!keep.has(day)) returns.delete(day)
  }
  return returns
}

export function pairedReturns(left: Map<number, number>, right: Map<number, number>): Array<[number, number]> {
  const pairs: Array<[number, number]> = []
  for (const [day, value] of left) {
    const other = right.get(day)
    if (other == null) continue
    pairs.push([value, other])
  }
  return pairs
}

/** Pearson correlation. Fewer than five shared days stays empty. */
export function pearson(pairs: Array<[number, number]>): number | null {
  if (pairs.length < 5) return null
  let sumX = 0
  let sumY = 0
  for (const [x, y] of pairs) {
    sumX += x
    sumY += y
  }
  const meanX = sumX / pairs.length
  const meanY = sumY / pairs.length
  let num = 0
  let dx = 0
  let dy = 0
  for (const [x, y] of pairs) {
    const left = x - meanX
    const right = y - meanY
    num += left * right
    dx += left * left
    dy += right * right
  }
  if (!(dx > 0) || !(dy > 0)) return null
  return num / Math.sqrt(dx * dy)
}
