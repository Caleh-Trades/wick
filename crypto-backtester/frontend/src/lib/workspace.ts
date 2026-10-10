import { clampRisk, clampSlippage, createRun, isRange, isTimeframe, isVenue, loadDesk, MAX_RUNS, normalizeCombo, normalizeRule, type DeskState } from "./runs.ts"
import type { MarketId, RangeId, Run, Timeframe, Venue } from "./types.ts"

export const MAX_SLOTS = 4
const WORKSPACE_KEY = "wick-runs"

export type AlertKind = "above" | "below" | "delta"

export type SlotAlert = {
  kind: AlertKind
  value: number
}

export type Slot = {
  id: string
  symbol: MarketId
  venue: Venue
  timeframe: Timeframe
  range: RangeId
  runs: Run[]
  selectedId: string
  /** Live threshold. A hit appends a journal row and does not send an order. */
  alert: SlotAlert | null
  /** 60-second book delta. A cross appends a journal row and does not send an order. */
  deltaAlert: number | null
}

export type Workspace = {
  slots: Slot[]
  activeId: string
  pinnedId: string | null
  enlarged: boolean
}

export function tapeKey(slot: Pick<Slot, "venue" | "timeframe" | "range" | "symbol">): string {
  return `${slot.venue}|${slot.timeframe}|${slot.range}|${slot.symbol}`
}

export function createSlot(symbol: MarketId, venue: Venue, timeframe: Timeframe, range: RangeId): Slot {
  const run = createRun({ symbol, allowShort: venue === "perp", name: "SMA 20/50" })
  return {
    id: crypto.randomUUID(),
    symbol,
    venue,
    timeframe,
    range,
    runs: [run],
    selectedId: run.id,
    alert: null,
    deltaAlert: null,
  }
}

export function defaultWorkspace(): Workspace {
  const slot = createSlot("BTCUSDT", "spot", "1d", "1Y")
  return { slots: [slot], activeId: slot.id, pinnedId: null, enlarged: false }
}

export function visibleSlots(workspace: Workspace): Slot[] {
  const active = workspace.slots.find((slot) => slot.id === workspace.activeId) ?? workspace.slots[0]
  if (!active) return []
  const pinned = workspace.slots.find((slot) => slot.id === workspace.pinnedId)
  if (!pinned || pinned.id === active.id) return [active]
  return [pinned, active]
}

export function loadWorkspace(): Workspace {
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY)
    if (!raw) return defaultWorkspace()
    const parsed = JSON.parse(raw) as { v?: number; slots?: unknown }
    if (parsed?.v === 2) return sanitizeWorkspace(parsed)
    return fromDesk(loadDesk())
  } catch {
    return defaultWorkspace()
  }
}

export function saveWorkspace(workspace: Workspace): void {
  try {
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ v: 2, ...workspace }))
  } catch {
    /* the desk still works for this visit */
  }
}

export function fromDesk(desk: DeskState): Workspace {
  const groups = new Map<string, Run[]>()
  for (const run of desk.runs) {
    const next = { ...run, allowShort: desk.venue === "perp" ? run.allowShort !== false : false }
    const list = groups.get(next.symbol) ?? []
    list.push(next)
    groups.set(next.symbol, list)
  }
  const slots: Slot[] = [...groups.entries()].slice(0, MAX_SLOTS).map(([symbol, runs]) => ({
    id: crypto.randomUUID(),
    symbol: symbol as MarketId,
    venue: desk.venue,
    timeframe: desk.timeframe,
    range: desk.range,
    runs,
    selectedId: runs.some((run) => run.id === desk.selectedId) ? desk.selectedId : runs[0]!.id,
    alert: null,
    deltaAlert: null,
  }))
  if (slots.length === 0) return defaultWorkspace()
  const active = slots.find((slot) => slot.runs.some((run) => run.id === desk.selectedId)) ?? slots[0]!
  return { slots, activeId: active.id, pinnedId: null, enlarged: desk.enlarged }
}

function sanitizeWorkspace(value: unknown): Workspace {
  if (!value || typeof value !== "object") return defaultWorkspace()
  const raw = value as Partial<Workspace>
  const slots = Array.isArray(raw.slots) ? raw.slots.map(sanitizeSlot).filter((slot) => slot != null).slice(0, MAX_SLOTS) : []
  if (slots.length === 0) return defaultWorkspace()
  const activeId = slots.some((slot) => slot.id === raw.activeId) ? String(raw.activeId) : slots[0]!.id
  const pinnedId = slots.some((slot) => slot.id === raw.pinnedId) ? String(raw.pinnedId) : null
  return { slots, activeId, pinnedId, enlarged: Boolean(raw.enlarged) }
}

function sanitizeSlot(value: unknown): Slot | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Partial<Slot>
  if (typeof raw.id !== "string" || !raw.id) return null
  const symbol = typeof raw.symbol === "string" && raw.symbol.endsWith("USDT") ? (raw.symbol as MarketId) : "BTCUSDT"
  const venue = isVenue(raw.venue) ? raw.venue : "spot"
  const timeframe = isTimeframe(raw.timeframe) ? raw.timeframe : "1d"
  const range = isRange(raw.range) ? raw.range : "1Y"
  const runs = Array.isArray(raw.runs) ? raw.runs : []
  const cleaned = runs
    .filter((run): run is Run => Boolean(run) && typeof run === "object" && typeof (run as Run).id === "string")
    .slice(0, MAX_RUNS)
    .map((run) => ({
      ...run,
      symbol,
      allowShort: venue === "perp" ? run.allowShort !== false : false,
      riskPct: clampRisk(run.riskPct),
      slippageBps: clampSlippage(run.slippageBps),
      combo: normalizeCombo(run.combo, normalizeRule(String(run.rule ?? "sma_cross"))),
    }))
  if (cleaned.length === 0) return createSlot(symbol, venue, timeframe, range)
  const selectedId = cleaned.some((run) => run.id === raw.selectedId) ? String(raw.selectedId) : cleaned[0]!.id
  return {
    id: raw.id,
    symbol,
    venue,
    timeframe,
    range,
    runs: cleaned,
    selectedId,
    alert: asAlert(raw.alert),
    deltaAlert: asDeltaAlert(raw.deltaAlert),
  }
}

function asAlert(value: unknown): SlotAlert | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Partial<SlotAlert>
  const kind = raw.kind === "above" || raw.kind === "below" || raw.kind === "delta" ? raw.kind : null
  const number = Number(raw.value)
  if (!kind || !(number > 0)) return null
  return { kind, value: number }
}

export function asDeltaAlert(value: unknown): number | null {
  const number = Number(value)
  if (!Number.isFinite(number) || !(number > 0)) return null
  return number
}

/** True once the last trade is through a price level. A missing trade stays quiet. */
export function priceCrosses(price: number | null, alert: SlotAlert | null): boolean {
  if (!alert || alert.kind === "delta" || price == null || !(price > 0)) return false
  return alert.kind === "above" ? price >= alert.value : price <= alert.value
}

/** True once the 60-second buy-minus-sell is at least the armed size. */
export function deltaCrosses(delta: number, threshold: number | null): boolean {
  if (threshold == null || !(threshold > 0) || !Number.isFinite(delta)) return false
  return Math.abs(delta) >= threshold
}

export type ArmReading = {
  hot: boolean
  side: "above" | "below" | "buy" | "sell" | null
  price: number | null
  priceKind: "above" | "below" | null
  delta: number | null
}

/** Idle until the last trade or the 60s delta crosses the armed level. The side is above, below, buy, or sell. */
export function armReading(input: {
  alert: SlotAlert | null
  deltaAlert: number | null
  trade: number | null
  delta: number
  heard: boolean
}): ArmReading {
  const priceAlert =
    input.alert && (input.alert.kind === "above" || input.alert.kind === "below")
      ? { kind: input.alert.kind, value: input.alert.value }
      : null
  const chartDelta = input.alert?.kind === "delta" ? input.alert.value : null
  const deltaThreshold = input.deltaAlert ?? chartDelta
  const priceHot = priceCrosses(input.trade, priceAlert)
  const deltaHot = input.heard && deltaCrosses(input.delta, deltaThreshold)
  let side: ArmReading["side"] = null
  if (priceHot && priceAlert) side = priceAlert.kind
  else if (deltaHot) side = input.delta > 0 ? "buy" : "sell"
  return {
    hot: priceHot || deltaHot,
    side,
    price: priceAlert?.value ?? null,
    priceKind: priceAlert?.kind ?? null,
    delta: deltaThreshold != null && deltaThreshold > 0 ? deltaThreshold : null,
  }
}
