import assert from "node:assert/strict"

import { backtest, liquidationPrice } from "../src/lib/backtest.ts"
import { createRun, fingerprint, mergeCandles } from "../src/lib/runs.ts"
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
const doubled = backtest(bars([100, 100, 110, 120, 130]), { ...hold, capital: 20_000 }, 365)
assert.equal(doubled.assumptions.initial_capital, 20_000)
assert.ok(Math.abs(doubled.metrics.final_equity - held.metrics.final_equity * 2) < 1e-6)
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
assert.ok(Math.abs(crossed.metrics.final_equity - 1997.0014992503761) < 1e-6)
const split = Math.floor(crossed.equity.length * 0.7)
assert.ok(split > 0 && split < crossed.equity.length)
const mid = crossed.equity[split - 1]!.equity
const end = crossed.equity[crossed.equity.length - 1]!.equity
assert.ok(Math.abs(crossed.in_sample.total_return_pct - (mid / 10_000 - 1) * 100) < 1e-6)
assert.ok(Math.abs(crossed.holdout.total_return_pct - (end / mid - 1) * 100) < 1e-6)
assert.equal(crossed.in_sample.trades + crossed.holdout.trades, crossed.metrics.trades)
assert.equal(crossed.trades.some((trade) => trade.side === "short"), true)

const costly = createRun({ rule: "buy_hold", feeBps: 100, name: "Costly" })
const dragged = backtest(bars([100, 100, 110, 120, 130]), costly, 365)
assert.ok(Math.abs(dragged.metrics.final_equity - 12864.85470136219) < 1e-6)

const dipped = backtest(bars([100, 100, 150, 75, 90]), hold, 365)
assert.ok(Math.abs(dipped.metrics.max_drawdown_pct - -50) < 1e-9)
assert.ok(dipped.holdout.max_drawdown_pct < dipped.in_sample.max_drawdown_pct)

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

assert.throws(() => backtest(bars([100, 100, 110, 120]), hold, 365, { venue: "perp" }), /Funding history/)

const crashed = backtest(bars([100, 100, 100, 100, 40]), { ...hold, leverage: 3 }, 365, {
  venue: "perp",
  funding: [],
})
const liquidated = crashed.trades.find((trade) => trade.status === "liquidated")
assert.ok(liquidated)
assert.equal(liquidated?.side, "long")
assert.equal(liquidated?.status, "liquidated")
const liq = liquidationPrice(liquidated?.entry_price ?? 0, "long", 3)
assert.ok(Math.abs((liquidated?.exit_price ?? 0) - liq) < 1e-8)
assert.ok(liq < (liquidated?.entry_price ?? 0))
assert.ok(liquidationPrice(100, "short", 3) > 100)

const calm = backtest(bars([100, 100, 110, 120, 130]), { ...hold, leverage: 3 }, 365, { venue: "perp", funding: [] })
const paid = backtest(bars([100, 100, 110, 120, 130]), { ...hold, leverage: 3 }, 365, {
  venue: "perp",
  funding: [{ t: 1_700_000_000 + 2 * 86_400 + 10, rate: 0.01, mark: 100 }],
})
assert.equal(paid.assumptions.leverage, 3)
assert.equal(paid.assumptions.venue, "perp")
assert.ok(paid.metrics.final_equity < calm.metrics.final_equity)
assert.ok((paid.trades[0]?.funding_paid ?? 0) > 0)
assert.equal(calm.trades[0]?.funding_paid ?? 0, 0)
assert.equal(held.trades[0]?.funding_paid ?? 0, 0)
assert.equal(paid.trades[0]?.side, "long")
assert.ok(paid.metrics.exposure_pct > 0)

const wiped = backtest(bars([100, 100, 0]), { ...hold, feeBps: 0, riskPct: 100 }, 365)
const quarter = backtest(bars([100, 100, 0]), { ...hold, feeBps: 0, riskPct: 25 }, 365)
assert.equal(wiped.assumptions.risk_pct, 100)
assert.equal(quarter.assumptions.risk_pct, 25)
assert.ok(Math.abs(wiped.metrics.final_equity) < 1e-6)
assert.ok(Math.abs(quarter.metrics.final_equity - 7_500) < 1e-6)
assert.ok(Math.abs((quarter.trades[0]?.quantity ?? 0) / (wiped.trades[0]?.quantity ?? 1) - 0.25) < 1e-9)

const half = backtest(bars([100, 100, 110, 120, 130]), { ...hold, feeBps: 0, riskPct: 50 }, 365)
const fill = 100.05
assert.ok(Math.abs(half.metrics.final_equity - 10_000 * (0.5 + 0.5 * (130 / fill))) < 1e-6)

const fullPerp = backtest(bars([100, 100, 110, 120, 130]), { ...hold, leverage: 3, riskPct: 100 }, 365, {
  venue: "perp",
  funding: [],
})
const halfPerp = backtest(bars([100, 100, 110, 120, 130]), { ...hold, leverage: 3, riskPct: 50 }, 365, {
  venue: "perp",
  funding: [],
})
assert.ok(Math.abs((halfPerp.trades[0]?.quantity ?? 0) / (fullPerp.trades[0]?.quantity ?? 1) - 0.5) < 1e-9)

const tiny = backtest(bars([100, 100, 110, 120]), { ...hold, riskPct: 0 }, 365)
assert.equal(tiny.assumptions.risk_pct, 0.1)

assert.equal(fingerprint({ ...cross, combo: [] }), fingerprint(cross))
assert.equal(crossed.strategy.name, "SMA crossover")
const duplicateHold = backtest(
  bars([100, 100, 110, 120, 130]),
  { ...hold, combo: [{ rule: "buy_hold", params: {} }] },
  365,
)
assert.ok(Math.abs(duplicateHold.metrics.final_equity - held.metrics.final_equity) < 1e-6)
const agreed = backtest(
  bars([1, 1, 1, 5, 5, 5, 1, 1, 1]),
  { ...cross, combo: [{ rule: "buy_hold", params: {} }] },
  365,
)
assert.equal(agreed.strategy.name, "SMA crossover + Buy and hold")
assert.equal(agreed.trades.some((trade) => trade.side === "short"), false)
assert.equal(agreed.trades.some((trade) => trade.side === "long"), true)
assert.notEqual(fingerprint({ ...cross, combo: [{ rule: "buy_hold", params: {} }] }), fingerprint(cross))

console.log("engine check ok")
