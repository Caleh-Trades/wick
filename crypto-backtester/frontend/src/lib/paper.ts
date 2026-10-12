import type { KeptListRow, TradeRecord } from "./records.ts"
import { normalizeRule } from "./runs.ts"
import type { Run } from "./types.ts"

export function runFromKept(row: KeptListRow): Run {
  return {
    id: row.run.id,
    name: row.strategy.name,
    symbol: row.strategy.symbol,
    rule: normalizeRule(row.strategy.rule),
    params: { ...row.strategy.params },
    combo: row.strategy.combo.map((item) => ({ rule: normalizeRule(item.rule), params: { ...item.params } })),
    feeBps: row.strategy.fee,
    slippageBps: row.strategy.slippage,
    capital: row.strategy.capital,
    leverage: row.strategy.leverage,
    riskPct: row.strategy.risk,
    biasTimeframe: null,
    allowShort: row.strategy.allowShort,
    hidden: false,
    locked: row.run.locked === true,
  }
}

/** Dollar profit of the paper fills, divided by the kept run's base balance. */
export function paperReturnPct(trades: TradeRecord[], capital: number): number | null {
  const closed = trades.filter((trade) => trade.source === "paper" && trade.exitTime != null && trade.pnl != null)
  if (closed.length === 0 || !(capital > 0)) return null
  const pnl = closed.reduce((sum, trade) => sum + (trade.pnl ?? 0), 0)
  return (pnl / capital) * 100
}
