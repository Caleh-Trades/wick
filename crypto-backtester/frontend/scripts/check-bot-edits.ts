import assert from "node:assert/strict"

import { applyBotEdits, editConcerns } from "../src/lib/bot-edits.ts"
import { createSlot } from "../src/lib/workspace.ts"

const slot = createSlot("BTCUSDT", "spot", "1d", "1Y")
const workspace = { slots: [slot], activeId: slot.id, pinnedId: null, enlarged: false }
const next = applyBotEdits(workspace, [
  { op: "patch-run", riskPct: 25, combo: [{ rule: "buy_hold", params: {} }] },
  { op: "set-slot", timeframe: "1h", range: "3M" },
  { op: "add-run", name: "Hold", rule: "buy_hold" },
])
const patched = next.slots[0]!
assert.equal(patched.timeframe, "1h")
assert.equal(patched.range, "3M")
assert.equal(patched.runs[0]?.riskPct, 25)
assert.equal(patched.runs[0]?.combo[0]?.rule, "buy_hold")
assert.equal(patched.runs[0]?.allowShort, false)
assert.equal(patched.runs.length, 2)
assert.equal(patched.runs[1]?.rule, "buy_hold")
assert.equal(workspace.slots[0]?.runs[0]?.riskPct, 100)
assert.equal(applyBotEdits(workspace, [{ op: "rewrite-app" }]), workspace)
const missed = applyBotEdits(workspace, [{ op: "patch-run", slot: "ETHUSDT", riskPct: 5 }])
assert.equal(missed, workspace)
assert.equal(editConcerns(workspace, [{ op: "patch-run", slot: "ETHUSDT", riskPct: 5 }]), false)
assert.equal(editConcerns(workspace, [{ op: "patch-run", riskPct: 5 }]), true)

console.log("bot edits ok")
