const KEY = "wick-panes"

export const CHART_MIN = 0.26
export const CHART_MAX = 0.7
export const SLOTS_MIN = 112
export const SLOTS_MAX = 280

export type PaneSizes = {
  book: number
  /** Share of the column given to the price chart. The rest is equity, comparison, and trades. */
  chart: number
  /** Width of the slot list on the left. */
  slots: number
}

const DEFAULTS: PaneSizes = { book: 320, chart: 0.46, slots: 200 }

export function loadPanes(): PaneSizes {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "") as Partial<PaneSizes> & { v?: number }
    const book = clamp(parsed.book, 160, 520, DEFAULTS.book)
    const slots = clamp(parsed.slots, SLOTS_MIN, SLOTS_MAX, DEFAULTS.slots)
    if (parsed.v !== 6) return { book, chart: DEFAULTS.chart, slots }
    return {
      book,
      chart: clamp(parsed.chart, CHART_MIN, CHART_MAX, DEFAULTS.chart),
      slots,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function clampSlots(value: number): number {
  return clamp(value, SLOTS_MIN, SLOTS_MAX, DEFAULTS.slots)
}

export function clampChart(value: number): number {
  return clamp(value, CHART_MIN, CHART_MAX, DEFAULTS.chart)
}

export function savePanes(sizes: PaneSizes): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: 6, ...sizes }))
  } catch {
    /* the drag still applies for this visit */
  }
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}
