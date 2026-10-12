import { openR } from "./open-trade.ts"
import type { TradeRecord } from "./records.ts"
import { isJournalTrade } from "./records.ts"

export type WeekStrip = {
  pnl: number | null
  winRate: number | null
  avgR: number | null
  closed: number
}

/** UTC week starting Monday 00:00. */
export function weekStartMs(now = Date.now()): number {
  const date = new Date(now)
  const day = date.getUTCDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + mondayOffset)
}

/** Closed journal fills whose exit falls in this UTC week. Empty week → dashes. */
export function weekStrip(trades: TradeRecord[], now = Date.now()): WeekStrip {
  const start = weekStartMs(now)
  const end = start + 7 * 86_400_000
  const closed = trades.filter((trade) => {
    if (!isJournalTrade(trade) || trade.exitTime == null || trade.pnl == null) return false
    const at = Date.parse(trade.exitTime)
    return Number.isFinite(at) && at >= start && at < end
  })
  if (closed.length === 0) return { pnl: null, winRate: null, avgR: null, closed: 0 }
  const pnl = closed.reduce((sum, trade) => sum + (trade.pnl ?? 0), 0)
  const wins = closed.filter((trade) => (trade.pnl ?? 0) > 0).length
  const rs = closed
    .map((trade) => {
      if (trade.exitPrice == null || trade.stop == null) return null
      return openR(trade.side, trade.entryPrice, trade.stop, trade.exitPrice)
    })
    .filter((value): value is number => value != null && Number.isFinite(value))
  const avgR = rs.length > 0 ? rs.reduce((sum, value) => sum + value, 0) / rs.length : null
  return {
    pnl,
    winRate: (wins / closed.length) * 100,
    avgR,
    closed: closed.length,
  }
}
