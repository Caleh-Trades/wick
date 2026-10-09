import assert from "node:assert/strict"

import { applyFeed, createBook, parseCoinbase, projectBook, takerSide } from "../src/lib/book.ts"
import { phraseFor, windowNote } from "../src/lib/runs.ts"

const now = Date.parse("2026-10-09T12:00:00Z")

function level(side: string, price: string, size: string) {
  return { side, price_level: price, new_quantity: size }
}

const book = createBook()
applyFeed(book, {
  kind: "snapshot",
  levels: [
    ...Array.from({ length: 20 }, (_, index) => ({ side: "bid", price: String(100 - index), size: String(index + 1) })),
    ...Array.from({ length: 20 }, (_, index) => ({ side: "offer", price: String(110 + index), size: String(index + 1) })),
  ],
})
applyFeed(book, {
  kind: "trades",
  trades: [
    { id: "1", time: "2026-10-09T11:58:00Z", makerSide: "SELL", price: "110", size: "0.4" },
    { id: "2", time: "2026-10-09T11:59:30Z", makerSide: "BUY", price: "100", size: "0.1" },
    { id: "1", time: "2026-10-09T11:58:00Z", makerSide: "SELL", price: "110", size: "0.4" },
    { id: "old", time: "2026-10-09T11:59:10Z", makerSide: "SELL", price: "110", size: "9" },
  ],
})

let view = projectBook(book, now)
assert.equal(view.bids.length, 15)
assert.equal(view.asks.length, 15)
assert.equal(view.bids[0]?.price, 100)
assert.equal(view.bids[0]?.size, 1)
assert.equal(view.bids[0]?.cum, 1)
assert.equal(view.bids[1]?.cum, 3)
assert.equal(view.asks.at(-1)?.price, 110)
assert.equal(view.asks[0]?.price, 124)
assert.equal(view.spread, 10)
assert.equal(view.mid, 105)
assert.equal(view.prints.length, 3)
assert.equal(view.prints[0]?.side, "sell")
assert.equal(view.prints[0]?.id, "2")
assert.equal(view.prints.at(-1)?.side, "buy")
assert.equal(view.delta, 9 - 0.1)

applyFeed(book, { kind: "delta", levels: [{ side: "bid", price: "100", size: "0" }] })
applyFeed(book, { kind: "delta", levels: [{ side: "offer", price: "110", size: "4" }] })
view = projectBook(book, now)
assert.equal(view.bids[0]?.price, 99)
assert.equal(view.asks.at(-1)?.size, 4)
assert.equal(view.spread, 11)

const fresh = createBook()
applyFeed(fresh, { kind: "delta", levels: [{ side: "bid", price: "50", size: "2" }] })
assert.equal(fresh.ready, false)
assert.equal(projectBook(fresh, now).bids.length, 0)
applyFeed(fresh, { kind: "snapshot", levels: [{ side: "bid", price: "40", size: "1" }, { side: "offer", price: "41", size: "1" }] })
applyFeed(fresh, { kind: "snapshot", levels: [{ side: "bid", price: "70", size: "2" }, { side: "offer", price: "72", size: "2" }] })
const replaced = projectBook(fresh, now)
assert.equal(replaced.bids[0]?.price, 70)
assert.equal(replaced.spread, 2)
assert.equal(replaced.mid, 71)

assert.equal(takerSide("sell"), "buy")
assert.equal(takerSide("BUY"), "sell")
assert.equal(takerSide("offer"), null)

const parsed = parseCoinbase({
  channel: "l2_data",
  events: [{ type: "snapshot", updates: [level("bid", "10", "1"), level("offer", "11", "2")] }],
})
assert.equal(parsed.length, 1)
assert.equal(parsed[0]?.kind, "snapshot")
const trades = parseCoinbase({
  channel: "market_trades",
  events: [
    {
      type: "update",
      trades: [{ trade_id: "9", price: "11", size: "0.2", side: "SELL", time: "2026-10-09T11:59:59Z" }],
    },
  ],
})
assert.equal(trades[0]?.kind, "trades")
const parsedBook = createBook()
for (const message of [...parsed, ...trades]) applyFeed(parsedBook, message)
const parsedView = projectBook(parsedBook, now)
assert.equal(parsedView.prints[0]?.side, "buy")
assert.equal(parsedView.spread, 1)

assert.equal(phraseFor("1m"), "1-minute")
assert.equal(phraseFor("1d"), "daily")
const minuteTape = {
  interval: "1m",
  candles: [
    { t: 1_700_000_000 },
    { t: 1_700_000_000 + 31 * 86_400 },
  ],
}
const note = windowNote("1Y", minuteTape)
assert.ok(note)
assert.match(note, /1-minute/)
assert.doesNotMatch(note, /daily/)
assert.equal(windowNote("1D", minuteTape), null)
assert.equal(
  windowNote("All", {
    interval: "1d",
    candles: [{ t: 1_700_000_000 }, { t: 1_700_000_000 + 400 * 86_400 }],
  }),
  null,
)

console.log("book ok")
