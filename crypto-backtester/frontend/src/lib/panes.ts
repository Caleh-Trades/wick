const KEY = "wick-panes"

export const CHART_MIN = 0.3
export const CHART_MAX = 0.55

export type PaneSizes = {
  book: number
  /** Share of the column given to the price chart. The rest is equity, comparison, and trades. */
  chart: number
}

const DEFAULTS: PaneSizes = { book: 320, chart: 0.46 }

export function loadPanes(): PaneSizes {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "") as Partial<PaneSizes> & { v?: number }
    const book = clamp(parsed.book, 160, 520, DEFAULTS.book)
    if (parsed.v !== 4) return { book, chart: DEFAULTS.chart }
    return {
      book,
      chart: clamp(parsed.chart, CHART_MIN, CHART_MAX, DEFAULTS.chart),
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function clampChart(value: number): number {
  return clamp(value, CHART_MIN, CHART_MAX, DEFAULTS.chart)
}

export function savePanes(sizes: PaneSizes): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: 4, ...sizes }))
  } catch {
    /* the drag still applies for this visit */
  }
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}
