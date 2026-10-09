import assert from "node:assert/strict"

import { projectLadder, rollingFlow, stepDecimals, streamNames, takerSide, type Print } from "../src/lib/book.ts"
import { formatBookSize, formatCompact, formatPrice } from "../src/lib/format.ts"
import { mergeForming } from "../src/lib/forming.ts"
import { priceDomain, spotTrades } from "../src/lib/plot.ts"
import { barsLabel, rangeDays, windowNote } from "../src/lib/runs.ts"
import type { TapeCandle } from "../src/lib/types.ts"

const now = Date.parse("2026-10-09T12:00:00Z")

const first = projectLadder(
  [
    ["100", "1"],
    ["99", "2"],
  ],
  [
    ["110", "1"],
    ["111", "3"],
  ],
  new Map(),
)
assert.equal(first.crossed, false)
assert.equal(first.bids[0]?.price, 100)
assert.equal(first.bids[0]?.total, 1)
assert.equal(first.bids[1]?.total, 3)
assert.equal(first.asks[0]?.price, 111)
assert.equal(first.asks.at(-1)?.price, 110)
assert.equal(first.asks[0]?.total, 4)
assert.equal(first.asks.at(-1)?.total, 1)
assert.equal(first.asks.at(-1)?.notional, 110)
assert.equal(first.asks[0]?.notional, 333)
assert.equal(formatBookSize(2.5), "2.5000")
assert.equal(formatBookSize(2.506), "2.5060")
assert.notEqual(formatBookSize(12.56), formatBookSize(12.564))
assert.equal(formatBookSize(0.006), "0.0060")
assert.equal(formatBookSize(1234.5), "1,234.5000")
assert.equal(formatBookSize(1500.001), "1,500.0010")
assert.notEqual(formatBookSize(1500), formatBookSize(1500.001))
assert.equal(first.bids[0]?.notional, 100)
assert.equal(first.spread, 10)
assert.equal(first.mid, 105)
assert.equal(first.bids[0]?.changed, false)

const sized = new Map<string, number>([
  ["bid:100", 1],
  ["ask:110", 1],
])
const moved = projectLadder(
  [
    ["100", "2"],
    ["99", "2"],
  ],
  [
    ["110", "1"],
    ["111", "3"],
  ],
  sized,
)
assert.equal(moved.bids[0]?.changed, true)
assert.equal(moved.asks.at(-1)?.changed, false)

const crossed = projectLadder([["110", "1"]], [["100", "1"]], new Map())
assert.equal(crossed.crossed, true)
assert.equal(crossed.bids.length, 0)
assert.equal(crossed.asks.length, 0)

const empty = projectLadder([], [["100", "1"]], new Map())
assert.equal(empty.crossed, true)
assert.equal(empty.asks.length, 0)

assert.deepEqual(streamNames("ETHUSDT"), ["ethusdt@depth20@100ms", "ethusdt@trade", "ethusdt@ticker"])
assert.deepEqual(streamNames("ETHUSDT", "perp"), ["ethusdt@depth20@100ms", "ethusdt@aggTrade", "ethusdt@ticker"])
assert.equal(formatPrice(0.00000391, "0.00000001"), "0.00000391")
assert.equal(formatCompact(1_500), "1.50K")
assert.equal(formatCompact(2_500_000), "2.50M")
assert.equal(formatCompact(3_000_000_000), "3.00B")
const [axisLow, axisHigh] = priceDomain([{ low: 60_000, high: 64_000 }])
const pad = (64_000 - 60_000) * 0.04
assert.ok(Math.abs(axisLow - (60_000 - pad)) < 1e-6)
assert.ok(Math.abs(axisHigh - (64_000 + pad)) < 1e-6)
assert.ok(axisLow > 50_000)
const nearPrice = priceDomain([{ low: 80_000, high: 86_000 }])
assert.ok(nearPrice[0] > 79_000)
assert.ok(nearPrice[0] < 80_000)
assert.ok(nearPrice[1] < 87_000)
assert.deepEqual(
  spotTrades(
    [
      { side: "long" },
      { side: "short" },
    ],
    "spot",
  ).map((trade) => trade.side),
  ["long"],
)
assert.equal(spotTrades([{ side: "short" as const }], "perp").length, 1)
assert.equal(takerSide(true), "sell")
assert.equal(takerSide(false), "buy")

const prints: Print[] = [
  { id: "old", t: now - 70_000, side: "buy", price: 1, size: 9 },
  { id: "buy", t: now - 1_000, side: "buy", price: 2, size: 2 },
  { id: "sell", t: now - 2_000, side: "sell", price: 2, size: 0.5 },
]
const flow = rollingFlow(prints, now)
assert.equal(flow.buy, 2)
assert.equal(flow.sell, 0.5)
assert.equal(flow.delta, 1.5)

assert.equal(stepDecimals("0.01000000"), 2)
assert.equal(stepDecimals("0.00001000"), 5)
assert.equal(stepDecimals("1.00000000"), 0)

const bar: TapeCandle = {
  t: Math.floor(now / 1000 / 60) * 60,
  time: "2026-10-09T12:00:00Z",
  open: 100,
  high: 101,
  low: 99,
  close: 100,
  volume: 1,
}
const updated = mergeForming([bar], [{ id: "p", t: now + 1_000, side: "buy", price: 104, size: 0.2 }], 60, now)
assert.equal(updated.length, 1)
assert.equal(updated[0]?.close, 104)
assert.equal(updated[0]?.high, 104)
assert.equal(updated[0]?.volume, 1.2)
const nextBar = mergeForming(
  updated,
  [{ id: "n", t: now + 70_000, side: "sell", price: 90, size: 1 }],
  60,
  now,
)
assert.equal(nextBar.length, 2)
assert.equal(nextBar[1]?.open, 90)
assert.equal(mergeForming([bar], prints, 60, now + 10_000)[0], bar)
assert.equal(mergeForming([bar], [], 60, now)[0], bar)

for (const interval of ["1m", "5m", "1h"]) {
  const label = barsLabel(interval, 1435)
  assert.match(label, new RegExp(`1,435 ${interval} bars`))
  assert.doesNotMatch(label, /daily/)
}
assert.equal(barsLabel("1d", 100), "100 1D bars")

const minuteTape = {
  interval: "1m",
  candles: [{ t: 1_700_000_000 }, { t: 1_700_000_000 + 31 * 86_400 }],
}
const note = windowNote("1Y", minuteTape)
assert.ok(note)
assert.match(note!, /1-minute/)
assert.doesNotMatch(note!, /daily/)
assert.equal(windowNote("1D", minuteTape), null)
assert.equal(rangeDays("1Y"), 366)
assert.equal(rangeDays("2Y"), 732)
assert.equal(rangeDays("4Y"), 1464)
assert.equal(rangeDays("6Y"), 2196)
for (const range of ["2Y", "4Y", "6Y"] as const) {
  const limited = windowNote(range, minuteTape)
  assert.ok(limited)
  assert.match(limited!, /Deepest window/)
  assert.match(limited!, /1-minute/)
}
const sixYearDaily = {
  interval: "1d",
  candles: [{ t: 1_700_000_000 }, { t: 1_700_000_000 + 2196 * 86_400 }],
}
assert.equal(windowNote("6Y", sixYearDaily), null)
const shortDaily = windowNote("6Y", {
  interval: "1d",
  candles: [{ t: 1_700_000_000 }, { t: 1_700_000_000 + 400 * 86_400 }],
})
assert.ok(shortDaily)
assert.match(shortDaily!, /daily/)

console.log("book ok")
