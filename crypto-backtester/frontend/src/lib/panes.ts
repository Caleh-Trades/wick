const KEY = "wick-panes"

export const CHART_MIN = 0.26
export const CHART_MAX = 0.42

export type PaneSizes = {
  book: number
  /** Share of the column given to the price chart. The rest is equity and the log. */
  chart: number
}

const DEFAULTS: PaneSizes = { book: 320, chart: 0.32 }

export function loadPanes(): PaneSizes {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "") as Partial<PaneSizes> & { v?: number }
    const book = clamp(parsed.book, 160, 520, DEFAULTS.book)
    if (parsed.v !== 3) return { book, chart: DEFAULTS.chart }
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
    localStorage.setItem(KEY, JSON.stringify({ v: 3, ...sizes }))
  } catch {
    /* the drag still applies for this visit */
  }
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}
