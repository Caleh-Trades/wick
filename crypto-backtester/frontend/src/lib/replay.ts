import type { Trade } from "./types.ts"

/** Entries and exits the cursor has reached. A trade still open at this bar keeps the entry only. */
export function replayTrades(trades: Trade[], throughTime: string): Trade[] {
  const shown: Trade[] = []
  for (const trade of trades) {
    if (trade.entry_time > throughTime) continue
    const exited = trade.exit_time != null && trade.exit_time <= throughTime && trade.status !== "open"
    if (exited) {
      shown.push(trade)
      continue
    }
    shown.push({ ...trade, status: "open", exit_time: null, exit_price: null })
  }
  return shown
}
