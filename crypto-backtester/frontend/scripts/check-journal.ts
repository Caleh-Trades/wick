import assert from "node:assert/strict"

import { editConcerns } from "../src/lib/bot-edits.ts"
import { journalEntries, journalStats, logTrade, logTradeOp, removeJournalEntry, tradePnl } from "../src/lib/journal.ts"
import { createSlot } from "../src/lib/workspace.ts"

const slot = createSlot("BTCUSDT", "spot", "1d", "1Y")
const workspace = { slots: [slot], activeId: slot.id, pinnedId: null, enlarged: false }
assert.equal(editConcerns(workspace, [{ op: "log-trade", symbol: "ETH", side: "sell", price: 1, size: 1 }]), true)

const entry = logTrade({ symbol: "BTC", side: "long", price: 100, size: 0.25, note: "breakout", strategy: "sma_cross", exitPrice: 110 })
assert.ok(entry)
assert.equal(entry?.symbol, "BTCUSDT")
assert.equal(entry?.side, "buy")
assert.equal(entry?.strategy, "SMA crossover")
assert.equal(entry?.exitPrice, 110)
assert.equal(tradePnl(entry!), 2.5)
assert.equal(journalEntries()[0]?.note, "breakout")

const short = logTrade({ symbol: "ETH", side: "short", price: 200, size: 1, exitPrice: 180, strategy: "fade the open" })
assert.equal(tradePnl(short!), 20)
assert.equal(short?.strategy, "fade the open")

const open = logTrade({ symbol: "SOL", side: "buy", price: 50, size: 2 })
assert.equal(open?.exitPrice, null)
assert.equal(open?.strategy, "")
assert.equal(tradePnl(open!), null)

const scratched = logTrade({ symbol: "BTC", side: "buy", price: 10, size: 1, exitPrice: -1 })
assert.equal(scratched?.exitPrice, null)

const stats = journalStats(journalEntries())
assert.equal(stats.closed, 2)
assert.equal(stats.open, 2)
assert.equal(stats.pnl, 22.5)
assert.equal(stats.winRate, 100)
assert.equal(stats.profitFactor, Number.POSITIVE_INFINITY)
assert.equal(stats.strategies[0]?.name, "fade the open")
assert.equal(stats.strategies.some((row) => row.name === "No strategy"), false)

assert.equal(logTrade({ symbol: "", side: "buy", price: 1, size: 1 }), null)
assert.equal(
  logTradeOp({ op: "log-trade", symbol: "ETHFI", side: "short", price: 0.68, size: 20, note: "fade", strategy: "supertrend", exit: 0.6 }),
  true,
)
assert.equal(journalEntries()[0]?.side, "sell")
assert.equal(journalEntries()[0]?.symbol, "ETHFIUSDT")
assert.equal(journalEntries()[0]?.strategy, "Supertrend")
assert.equal(tradePnl(journalEntries()[0]!), (0.68 - 0.6) * 20)

for (const row of [...journalEntries()]) removeJournalEntry(row.id)
assert.equal(journalEntries().length, 0)

console.log("journal ok")
