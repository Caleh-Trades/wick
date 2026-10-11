import {
  asRiskMode,
  clampGiveBack,
  clampLossLimit,
  DEFAULT_GIVE_BACK,
  DEFAULT_LOSS_LIMIT,
  isSessionLight,
  pinsOf,
  type ArmGate,
  type BookPosition,
  type RiskMode,
  type SessionLight,
} from "./desk.ts"
import { clampRisk, clampSlippage, createRun, isRange, isTimeframe, isVenue, loadDesk, MAX_RUNS, normalizeCombo, normalizeRule, rangeDays, type DeskState } from "./runs.ts"
import type { MarketId, RangeId, Run, Tape, Timeframe, Venue } from "./types.ts"

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
  /** Up to three symbols. Changing the active one leaves the others subscribed. */
  pins: MarketId[]
  /** Levels copied onto this slot by Promote. */
  armGate: ArmGate | null
}

export type Workspace = {
  slots: Slot[]
  activeId: string
  pinnedId: string | null
  enlarged: boolean
  /** Stamped onto journal rows and working tickets. */
  riskMode: RiskMode
  /** Null uses the weekend default. Stand-down blocks Arm. */
  session: SessionLight | null
  /** Closed journal losses in a row before the session stands down. */
  lossLimit: number
  /** Share of the best open profit. Below it, the open row is marked give-back. */
  giveBack: number
  /** Latched by the loss halt. Clearing is the only way back. */
  lossHalt: boolean
  /** Exit time of the loss the halt was cleared through. Older losses do not count. */
  lossHaltAck: string | null
  /** One open position per symbol and market. Flat is the absence of a row. */
  positions: BookPosition[]
}

export function tapeKey(slot: Pick<Slot, "venue" | "timeframe" | "range" | "symbol">): string {
  return `${slot.venue}|${slot.timeframe}|${slot.range}|${slot.symbol}`
}

/** Exact tape, or a wider loaded window of the same pair and bar size, cut to this range. */
export function tapeForSlot(tapes: Record<string, Tape>, slot: Pick<Slot, "venue" | "timeframe" | "range" | "symbol">): Tape | null {
  const exact = tapes[tapeKey(slot)]
  if (exact && exact.candles.length > 0) return exact
  const prefix = `${slot.venue}|${slot.timeframe}|`
  const suffix = `|${slot.symbol}`
  let best: Tape | null = null
  for (const [key, tape] of Object.entries(tapes)) {
    if (!key.startsWith(prefix) || !key.endsWith(suffix) || tape.candles.length === 0) continue
    if (!best || tape.candles.length > best.candles.length) best = tape
  }
  if (!best) return exact ?? null
  const days = rangeDays(slot.range)
  if (!days) return best
  const last = best.candles[best.candles.length - 1]?.t ?? 0
  const candles = best.candles.filter((candle) => candle.t >= last - days * 86_400)
  if (candles.length === 0) return exact ?? null
  return { ...best, range: slot.range, candles }
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
    pins: [symbol],
    armGate: null,
  }
}

export function defaultWorkspace(): Workspace {
  const slot = createSlot("BTCUSDT", "spot", "1d", "1Y")
  return {
    slots: [slot],
    activeId: slot.id,
    pinnedId: null,
    enlarged: false,
    riskMode: "NORMAL",
    session: null,
    lossLimit: DEFAULT_LOSS_LIMIT,
    giveBack: DEFAULT_GIVE_BACK,
    lossHalt: false,
    lossHaltAck: null,
    positions: [],
  }
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
    pins: [symbol as MarketId],
    armGate: null,
  }))
  if (slots.length === 0) return defaultWorkspace()
  const active = slots.find((slot) => slot.runs.some((run) => run.id === desk.selectedId)) ?? slots[0]!
  return {
    slots,
    activeId: active.id,
    pinnedId: null,
    enlarged: desk.enlarged,
    riskMode: "NORMAL",
    session: null,
    lossLimit: DEFAULT_LOSS_LIMIT,
    giveBack: DEFAULT_GIVE_BACK,
    lossHalt: false,
    lossHaltAck: null,
    positions: [],
  }
}

function sanitizeWorkspace(value: unknown): Workspace {
  if (!value || typeof value !== "object") return defaultWorkspace()
  const raw = value as Partial<Workspace>
  const slots = Array.isArray(raw.slots) ? raw.slots.map(sanitizeSlot).filter((slot) => slot != null).slice(0, MAX_SLOTS) : []
  if (slots.length === 0) return defaultWorkspace()
  const activeId = slots.some((slot) => slot.id === raw.activeId) ? String(raw.activeId) : slots[0]!.id
  const pinnedId = slots.some((slot) => slot.id === raw.pinnedId) ? String(raw.pinnedId) : null
  return {
    slots,
    activeId,
    pinnedId,
    enlarged: Boolean(raw.enlarged),
    riskMode: asRiskMode(raw.riskMode),
    session: isSessionLight(raw.session) ? raw.session : null,
    lossLimit: clampLossLimit(raw.lossLimit),
    giveBack: clampGiveBack(raw.giveBack),
    lossHalt: raw.lossHalt === true,
    lossHaltAck: typeof raw.lossHaltAck === "string" && raw.lossHaltAck ? raw.lossHaltAck : null,
    positions: Array.isArray(raw.positions) ? raw.positions.map(asPosition).filter((item) => item != null) : [],
  }
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
    pins: pinsOf({ symbol, pins: raw.pins }) as MarketId[],
    armGate: asArm(raw.armGate, venue),
  }
}

function asPosition(value: unknown): BookPosition | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Partial<BookPosition>
  const symbol = typeof raw.symbol === "string" && raw.symbol.endsWith("USDT") ? raw.symbol : ""
  const side = raw.side === "long" || raw.side === "short" ? raw.side : null
  const market = isVenue(raw.market) ? raw.market : null
  if (!symbol || !side || !market || !(Number(raw.size) > 0) || !(Number(raw.entry) > 0) || typeof raw.tradeId !== "string" || !raw.tradeId) return null
  const stop = raw.stop != null && Number(raw.stop) > 0 ? Number(raw.stop) : null
  return { symbol, market, side, size: Number(raw.size), entry: Number(raw.entry), stop, tradeId: raw.tradeId }
}

function asArm(value: unknown, venue: Venue): ArmGate | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Partial<ArmGate>
  const symbol = typeof raw.symbol === "string" && raw.symbol.endsWith("USDT") ? raw.symbol : ""
  const side = raw.side === "long" || raw.side === "short" ? raw.side : null
  if (!symbol || !side || typeof raw.ticketId !== "string" || !(Number(raw.entry) > 0) || !(Number(raw.stop) > 0) || !(Number(raw.size) > 0) || !(Number(raw.r) > 0)) {
    return null
  }
  return {
    ticketId: raw.ticketId,
    symbol,
    market: isVenue(raw.market) ? raw.market : venue,
    side,
    entry: Number(raw.entry),
    stop: Number(raw.stop),
    size: Number(raw.size),
    r: Number(raw.r),
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
