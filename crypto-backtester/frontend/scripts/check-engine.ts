import assert from "node:assert/strict"

import { backtest, liquidationPrice, monteCarloEquity, profitFactor, tradeExpectancy } from "../src/lib/backtest.ts"
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
assert.ok(Math.abs(held.metrics.benchmark_return_pct - 29.93503248375813) < 1e-6)
assert.ok(held.metrics.total_return_pct > 0 && held.metrics.total_return_pct < held.metrics.benchmark_return_pct)
assert.ok(Math.abs((held.trades[0]?.entry_price ?? 0) - 100.05) < 1e-9)
assert.equal(held.trades[0]?.status, "open")
const holdFill = 100.05
const holdQty = (10_000 * 0.01) / (holdFill * 0.02)
assert.ok(Math.abs((held.trades[0]?.quantity ?? 0) - holdQty) < 1e-6)
assert.equal(held.assumptions.risk_pct, 1)
assert.equal(held.assumptions.slippage_bps, 5)

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
assert.ok(crossed.metrics.final_equity > 0 && crossed.metrics.final_equity < 10_000)
const split = Math.floor(crossed.equity.length * 0.7)
assert.ok(split > 0 && split < crossed.equity.length)
const mid = crossed.equity[split - 1]!.equity
const end = crossed.equity[crossed.equity.length - 1]!.equity
assert.ok(Math.abs(crossed.in_sample.total_return_pct - (mid / 10_000 - 1) * 100) < 1e-6)
assert.ok(Math.abs(crossed.holdout.total_return_pct - (end / mid - 1) * 100) < 1e-6)
assert.equal(crossed.in_sample.trades + crossed.holdout.trades, crossed.metrics.trades)
assert.equal(crossed.walk_forward.length, 3)
assert.equal(
  crossed.walk_forward.reduce((sum, slice) => sum + slice.trades, 0),
  crossed.metrics.trades,
)
assert.ok(held.metrics.expectancy != null && held.metrics.expectancy > 0)
assert.equal(held.metrics.expectancy, tradeExpectancy(held.trades))
assert.ok(crossed.metrics.expectancy != null)
assert.equal(crossed.metrics.expectancy, tradeExpectancy(crossed.trades))
assert.equal(crossed.trades.some((trade) => trade.side === "short"), true)

const costly = createRun({ rule: "buy_hold", feeBps: 100, name: "Costly" })
const dragged = backtest(bars([100, 100, 110, 120, 130]), costly, 365)
assert.ok(dragged.metrics.final_equity < held.metrics.final_equity)
assert.ok((dragged.trades[0]?.fee_paid ?? 0) > 0)
assert.ok(dragged.metrics.fees_paid > 0)
assert.ok(dragged.metrics.return_before_fees_pct > dragged.metrics.total_return_pct)
assert.ok(Math.abs(held.metrics.fees_paid) < 1e-9)
assert.ok(Math.abs(held.metrics.return_before_fees_pct - held.metrics.total_return_pct) < 1e-9)
assert.ok((held.trades[0]?.slippage_paid ?? 0) > 0)

const dipped = backtest(bars([100, 100, 150, 75, 90]), hold, 365)
const dippedTrade = dipped.trades[0]
assert.ok(dippedTrade)
const dippedQty = dippedTrade.quantity
const dippedEntry = dippedTrade.entry_price
const peakEquity = 10_000 + dippedQty * (150 - dippedEntry)
const troughEquity = 10_000 + dippedQty * (75 - dippedEntry)
const expectedDrawdown = ((troughEquity - peakEquity) / peakEquity) * 100
assert.ok(Math.abs(dipped.metrics.max_drawdown_pct - expectedDrawdown) < 1e-6)
assert.ok(dipped.metrics.max_drawdown_pct < -29 && dipped.metrics.max_drawdown_pct > -31)
assert.equal(dipped.metrics.recovery_bars, null)
const recovered = backtest(bars([100, 100, 150, 120, 160]), hold, 365)
assert.equal(recovered.metrics.recovery_bars, 2)
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

const fullRisk = backtest(bars([100, 100, 0]), { ...hold, feeBps: 0, riskPct: 5 }, 365)
const onePct = backtest(bars([100, 100, 0]), { ...hold, feeBps: 0, riskPct: 1 }, 365)
assert.equal(fullRisk.assumptions.risk_pct, 5)
assert.equal(onePct.assumptions.risk_pct, 1)
assert.ok(Math.abs(fullRisk.metrics.final_equity) < 1e-6)
assert.ok(onePct.metrics.final_equity > 4_000 && onePct.metrics.final_equity < 6_000)
assert.ok(Math.abs((onePct.trades[0]?.quantity ?? 0) / (fullRisk.trades[0]?.quantity ?? 1) - 0.5) < 1e-6)

const twoPct = backtest(bars([100, 100, 110, 120, 130]), { ...hold, feeBps: 0, riskPct: 2 }, 365)
assert.ok(Math.abs((held.trades[0]?.quantity ?? 0) / (twoPct.trades[0]?.quantity ?? 1) - 0.5) < 1e-6)

const widePerp = backtest(bars([100, 100, 110, 120, 130]), { ...hold, leverage: 3, riskPct: 2 }, 365, {
  venue: "perp",
  funding: [],
})
const tightPerp = backtest(bars([100, 100, 110, 120, 130]), { ...hold, leverage: 3, riskPct: 1 }, 365, {
  venue: "perp",
  funding: [],
})
assert.ok(Math.abs((tightPerp.trades[0]?.quantity ?? 0) / (widePerp.trades[0]?.quantity ?? 1) - 0.5) < 1e-6)

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
const stacked = createRun({
  rule: "sma_cross",
  combo: [
    { rule: "ema_cross", params: {} },
    { rule: "donchian", params: {} },
    { rule: "macd", params: {} },
    { rule: "supertrend", params: {} },
    { rule: "sma_cross", params: {} },
  ],
})
assert.deepEqual(
  stacked.combo.map((item) => item.rule),
  ["ema_cross", "donchian", "macd", "supertrend"],
)

assert.equal(profitFactor([{ pnl: 10 }, { pnl: 4 }]), null)
assert.equal(profitFactor([]), null)
const expectancyTrades = [
  { pnl: -1382.79, return_pct: -13.8279 },
  { pnl: -227.72, return_pct: -2.2772 },
  { pnl: 71.2, return_pct: 0.712 },
  { pnl: 2249.15, return_pct: 22.4915 },
]
const withOpen = tradeExpectancy(expectancyTrades)
const closedExpectancy = tradeExpectancy(expectancyTrades.slice(0, 3))
const avgWin = (0.712 + 22.4915) / 2
const avgLoss = (13.8279 + 2.2772) / 2
assert.ok(withOpen != null && Math.abs(withOpen - (0.5 * avgWin - 0.5 * avgLoss)) < 1e-9)
assert.ok(withOpen > 0)
assert.ok(closedExpectancy != null && closedExpectancy < -5 && closedExpectancy > -5.3)
const openWinner = profitFactor(expectancyTrades)
assert.ok(openWinner != null && openWinner > 1)
assert.ok(Math.abs(openWinner - (71.2 + 2249.15) / (1382.79 + 227.72)) < 1e-9)
const closedOnly = profitFactor([{ pnl: -1382.79 }, { pnl: -227.72 }, { pnl: 71.2 }])
assert.ok(closedOnly != null && closedOnly < 0.05)

assert.equal(monteCarloEquity([], 10_000), null)
assert.equal(monteCarloEquity([0, 0], 10_000), 10_000)
assert.ok(Math.abs((monteCarloEquity([10], 10_000) ?? 0) - 11_000) < 1e-6)
const mixed = monteCarloEquity([50, -50], 10_000)
assert.ok(mixed != null && mixed > 0 && mixed < 7_500)
assert.equal(monteCarloEquity([50, -50], 10_000), mixed)

console.log("engine check ok")
