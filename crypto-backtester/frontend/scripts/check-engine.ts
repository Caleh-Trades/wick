import assert from "node:assert/strict"

import { backtest } from "../src/lib/backtest.ts"
import { createRun, mergeCandles } from "../src/lib/runs.ts"
import type { TapeCandle } from "../src/lib/types.ts"

function bars(prices: number[]): TapeCandle[] {
  return prices.map((price, index) => {
    const t = 1_700_000_000 + index * 86_400
    return {
      t,
      time: new Date(t * 1000).toISOString().replace(".000Z", "Z"),
      open: price,
      high: price,
      low: price,
      close: price,
    }
  })
}

const hold = createRun({ rule: "buy_hold", feeBps: 0, name: "Hold" })
const held = backtest(bars([100, 100, 110, 120, 130]), hold, 365)
assert.ok(Math.abs(held.metrics.total_return_pct - 29.93503248375813) < 1e-9)
for (const point of held.equity) assert.ok(Math.abs(point.equity - point.benchmark) < 1e-9)
assert.ok(Math.abs((held.trades[0]?.entry_price ?? 0) - 100.05) < 1e-9)
assert.equal(held.trades[0]?.status, "open")

const cross = createRun({
  rule: "sma_cross",
  feeBps: 0,
  params: { fast: 2, slow: 3, rsi: 14 },
  name: "SMA 2/3",
})
const crossed = backtest(bars([1, 1, 1, 5, 5, 5, 1, 1, 1]), cross, 365)
const closed = crossed.trades.filter((trade) => trade.status === "closed")
assert.equal(closed.length, 1)
assert.ok(Math.abs((closed[0]?.entry_price ?? 0) - 5.0025) < 1e-9)
assert.ok(Math.abs((closed[0]?.exit_price ?? 0) - 0.9995) < 1e-9)
assert.ok(Math.abs(crossed.metrics.final_equity - 1998.000999500251) < 1e-6)

const costly = createRun({ rule: "buy_hold", feeBps: 100, name: "Costly" })
const dragged = backtest(bars([100, 100, 110, 120, 130]), costly, 365)
assert.ok(Math.abs(dragged.metrics.final_equity - 12864.85470136219) < 1e-6)

const dipped = backtest(bars([100, 100, 150, 75, 90]), hold, 365)
assert.ok(Math.abs(dipped.metrics.max_drawdown_pct - -50) < 1e-9)

assert.throws(() => backtest(bars([1, 2, 3, 4, 5]), { ...cross, params: { fast: 50, slow: 20, rsi: 14 } }, 365), /fast period/)

const merged = mergeCandles(
  [
    { t: 1, time: "a", open: 1, high: 1, low: 1, close: 1 },
    { t: 2, time: "b", open: 2, high: 2, low: 2, close: 2 },
  ],
  [
    { t: 2, time: "b", open: 2, high: 3, low: 2, close: 9 },
    { t: 3, time: "c", open: 3, high: 3, low: 3, close: 3 },
  ],
)
assert.deepEqual(
  merged.map((candle) => [candle.t, candle.close]),
  [
    [1, 1],
    [2, 9],
    [3, 3],
  ],
)

console.log("engine check ok")
