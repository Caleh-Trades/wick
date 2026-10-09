import { createRun, isRange, isTimeframe, isVenue, loadDesk, MAX_RUNS, type DeskState } from "./runs.ts"
import type { MarketId, RangeId, Run, Timeframe, Venue } from "./types.ts"

export const MAX_SLOTS = 4
const WORKSPACE_KEY = "wick-runs"

export type Slot = {
  id: string
  symbol: MarketId
  venue: Venue
  timeframe: Timeframe
  range: RangeId
  runs: Run[]
  selectedId: string
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
    .map((run) => ({ ...run, symbol, allowShort: venue === "perp" ? run.allowShort !== false : false }))
  if (cleaned.length === 0) return createSlot(symbol, venue, timeframe, range)
  const selectedId = cleaned.some((run) => run.id === raw.selectedId) ? String(raw.selectedId) : cleaned[0]!.id
  return { id: raw.id, symbol, venue, timeframe, range, runs: cleaned, selectedId }
}
