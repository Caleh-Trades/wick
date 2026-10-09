import assert from "node:assert/strict"

import { editConcerns } from "../src/lib/bot-edits.ts"
import { journalEntries, logTrade, logTradeOp, removeJournalEntry } from "../src/lib/journal.ts"
import { createSlot } from "../src/lib/workspace.ts"

const slot = createSlot("BTCUSDT", "spot", "1d", "1Y")
const workspace = { slots: [slot], activeId: slot.id, pinnedId: null, enlarged: false }
assert.equal(editConcerns(workspace, [{ op: "log-trade", symbol: "ETH", side: "sell", price: 1, size: 1 }]), true)

const entry = logTrade({ symbol: "BTC", side: "long", price: 100, size: 0.25, note: "breakout" })
assert.ok(entry)
assert.equal(entry?.symbol, "BTCUSDT")
assert.equal(entry?.side, "buy")
assert.equal(journalEntries()[0]?.note, "breakout")
assert.equal(logTrade({ symbol: "", side: "buy", price: 1, size: 1 }), null)
assert.equal(logTradeOp({ op: "log-trade", symbol: "ETHFI", side: "short", price: 0.68, size: 20, note: "fade" }), true)
assert.equal(journalEntries()[0]?.side, "sell")
assert.equal(journalEntries()[0]?.symbol, "ETHFIUSDT")
if (entry) removeJournalEntry(entry.id)
removeJournalEntry(journalEntries()[0]?.id ?? "")

console.log("journal ok")
