import type { Venue } from "./types.ts"

export type RiskMode = "DEFENSIVE" | "NORMAL" | "PRESS"
export type SessionLight = "open" | "closed" | "stand-down"

export const RISK_MODES: RiskMode[] = ["DEFENSIVE", "NORMAL", "PRESS"]
export const SESSION_LIGHTS: SessionLight[] = ["open", "closed", "stand-down"]
export const PIN_CAP = 3

export type BookPosition = {
  symbol: string
  market: Venue
  side: "long" | "short"
  size: number
  entry: number
  tradeId: string
}

export type ArmGate = {
  ticketId: string
  symbol: string
  market: Venue
  side: "long" | "short"
  entry: number
  stop: number
  size: number
  r: number
}

/** The words on the journal form. A perp slot never reads as spot. */
export function marketLabel(venue: Venue): string {
  return venue === "perp" ? "KRAKEN PERP" : "BINANCE SPOT"
}

/** Saturday and Sunday are stand-down until the desk sets the light itself. */
export function defaultSession(now = new Date()): SessionLight {
  const day = now.getUTCDay()
  return day === 0 || day === 6 ? "stand-down" : "open"
}

export function resolveSession(chosen: SessionLight | null | undefined, now = new Date()): SessionLight {
  return chosen ?? defaultSession(now)
}

export function nextSession(current: SessionLight): SessionLight {
  const index = SESSION_LIGHTS.indexOf(current)
  return SESSION_LIGHTS[(index + 1) % SESSION_LIGHTS.length] ?? "open"
}

export function isRiskMode(value: unknown): value is RiskMode {
  return value === "DEFENSIVE" || value === "NORMAL" || value === "PRESS"
}

export function isSessionLight(value: unknown): value is SessionLight {
  return value === "open" || value === "closed" || value === "stand-down"
}

export function asRiskMode(value: unknown): RiskMode {
  return isRiskMode(value) ? value : "NORMAL"
}

/** Arm is a gate. Stand-down does not take the level. */
export function armAllowed(session: SessionLight): boolean {
  return session !== "stand-down"
}

export const DEFAULT_LOSS_LIMIT = 3

export function clampLossLimit(value: unknown): number {
  const limit = Math.round(Number(value))
  if (!Number.isFinite(limit)) return DEFAULT_LOSS_LIMIT
  return Math.min(20, Math.max(1, limit))
}

/** Closed journal losses in a row, newest exit first. A win breaks the run. An ack ignores that loss and anything older. */
export function lossStreak(
  trades: Array<{ runId?: string | null; source?: string; exitTime: string | null; pnl: number | null }>,
  ack: string | null,
): number {
  const ackMs = ack ? Date.parse(ack) : Number.NaN
  const closed = trades
    .filter((trade) => trade.runId == null && trade.source !== "paper" && trade.exitTime != null && trade.pnl != null && trade.pnl !== 0)
    .sort((left, right) => Date.parse(right.exitTime ?? "") - Date.parse(left.exitTime ?? ""))
  let count = 0
  for (const trade of closed) {
    if (Number.isFinite(ackMs) && Date.parse(trade.exitTime ?? "") <= ackMs) break
    if ((trade.pnl ?? 0) > 0) break
    count += 1
  }
  return count
}

export function pinsOf(slot: { symbol: string; pins?: string[] | null }): string[] {
  const listed = Array.isArray(slot.pins) ? slot.pins.filter((item) => typeof item === "string" && item.endsWith("USDT")) : []
  const unique = [...new Set(listed)]
  if (unique.length === 0) return [slot.symbol]
  if (unique.includes(slot.symbol)) return unique.slice(0, PIN_CAP)
  return [slot.symbol, ...unique].slice(0, PIN_CAP)
}

/**
 * Switch the active symbol inside a pin set of three.
 * A symbol already pinned only becomes active. A new one is added until the cap.
 * Past the cap, only the active symbol is replaced. The other two stay.
 */
export function pinSymbol(pins: string[], active: string, next: string): { pins: string[]; symbol: string } {
  const set = pinsOf({ symbol: active, pins })
  if (!next.endsWith("USDT")) return { pins: set, symbol: active }
  if (set.includes(next)) return { pins: set, symbol: next }
  if (set.length < PIN_CAP) return { pins: [...set, next], symbol: next }
  return { pins: set.map((item) => (item === active ? next : item)), symbol: next }
}

/** A long working ticket fills when the last trade is at or through the entry. A short fills at or above it. */
export function ticketFills(side: "long" | "short", entry: number, price: number | null): boolean {
  if (price == null || !(price > 0) || !(entry > 0)) return false
  return side === "long" ? price <= entry : price >= entry
}

export function positionFor(positions: BookPosition[], symbol: string, market: Venue): BookPosition | null {
  return positions.find((item) => item.symbol === symbol && item.market === market) ?? null
}

export function upsertPosition(positions: BookPosition[], next: BookPosition): BookPosition[] {
  return [...positions.filter((item) => item.symbol !== next.symbol || item.market !== next.market), next]
}

export function dropPosition(positions: BookPosition[], tradeId: string): BookPosition[] {
  return positions.filter((item) => item.tradeId !== tradeId)
}

/** An open journal row is stale when the book is flat, or the book names a different trade. */
export function rowIsStale(
  trade: { id: string; symbol: string; market: Venue; exitTime: string | null },
  positions: BookPosition[],
): boolean {
  if (trade.exitTime != null) return false
  const position = positionFor(positions, trade.symbol, trade.market)
  return position == null || position.tradeId !== trade.id
}

/** The slot is unsynced when the book holds a position the journal does not have open. */
export function slotUnsynced(
  symbol: string,
  market: Venue,
  positions: BookPosition[],
  openTrades: { id: string; exitTime: string | null }[],
): boolean {
  const position = positionFor(positions, symbol, market)
  if (!position) return false
  return !openTrades.some((trade) => trade.id === position.tradeId && trade.exitTime == null)
}

/** Buy volume minus sell volume, running from the oldest print. */
export function cumulativeDelta(prints: { side: "buy" | "sell"; size: number }[]): number[] {
  let total = 0
  const line: number[] = []
  for (const print of prints) {
    if (!(print.size > 0)) continue
    total += print.side === "buy" ? print.size : -print.size
    line.push(total)
  }
  return line
}

/** Weekend bars are the stand-down session on the chart. */
export function standDownBar(time: string): boolean {
  const date = new Date(time)
  if (Number.isNaN(date.getTime())) return false
  const day = date.getUTCDay()
  return day === 0 || day === 6
}
