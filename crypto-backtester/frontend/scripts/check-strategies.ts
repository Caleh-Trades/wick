import assert from "node:assert/strict"

import { backtest } from "../src/lib/backtest.ts"
import { RULES, createRun } from "../src/lib/runs.ts"
import { buildSignals } from "../src/lib/signals.ts"
import type { TapeCandle } from "../src/lib/types.ts"

function candle(t: number, open: number, high: number, low: number, close: number, volume = 1): TapeCandle {
  return {
    t,
    time: new Date(t * 1000).toISOString().replace(".000Z", "Z"),
    open,
    high,
    low,
    close,
    volume,
  }
}

const midnight = Math.floor(1_700_000_000 / 86_400) * 86_400

const momentum = [10, 10, 10, 10, 12, 12].map((close, index) => candle(midnight + index * 86_400, close, close, close, close))
assert.deepEqual(buildSignals("tsmom", momentum, { lookback: 3 }), [0, 0, 0, 0, 0, 1])

const dual = [1, 1, 1, 1, 2, 3, 4, 6].map((close, index) => candle(midnight + index * 86_400, close, close, close, close))
const dualSignals = buildSignals("dual_ma", dual, { fast: 2, slow: 3, filter: 4 })
assert.equal(dualSignals[3], 0)
assert.equal(dualSignals[7], 1)
assert.ok(dualSignals.every((value) => value === 0 || value === 1))

const vwap = buildSignals("vwap", [
  candle(midnight, 10, 10, 10, 10, 1),
  candle(midnight + 3600, 14, 14, 10, 14, 1),
  candle(midnight + 7200, 8, 10, 8, 8, 1),
], {})
assert.deepEqual(vwap, [0, 1, 0])

const prior = buildSignals("prev_day", [
  candle(midnight, 10, 10, 9, 10),
  candle(midnight + 3600, 10, 11, 10, 10),
  candle(midnight + 86_400, 11, 12, 11, 12),
  candle(midnight + 90_000, 8, 8, 7, 7),
], {})
assert.deepEqual(prior, [0, 0, 1, 0])

const range = buildSignals(
  "orb",
  [
    candle(midnight, 9, 10, 8, 9),
    candle(midnight + 3600, 10, 11, 9, 10),
    candle(midnight + 7200, 12, 12, 11, 12),
    candle(midnight + 10_800, 12, 12, 11, 12),
    candle(midnight + 86_400, 12, 12, 11, 12),
  ],
  { bars: 2 },
)
assert.deepEqual(range, [0, 0, 1, 1, 0])

const gapUp = buildSignals(
  "gap_go",
  [
    candle(midnight, 100, 101, 99, 100),
    candle(midnight + 86_400, 103, 104, 102, 103),
    candle(midnight + 90_000, 104, 105, 103, 104),
    candle(midnight + 93_600, 105, 106, 104, 105),
  ],
  { gap: 1 },
)
assert.deepEqual(gapUp, [0, 1, 1, 0])

const gapDown = buildSignals(
  "gap_fade",
  [
    candle(midnight, 100, 101, 99, 100),
    candle(midnight + 86_400, 96, 98, 95, 97),
    candle(midnight + 90_000, 97, 100, 96, 99),
    candle(midnight + 93_600, 99, 102, 98, 101),
  ],
  { gap: 1 },
)
assert.deepEqual(gapDown, [0, 1, 1, 0])

const held = buildSignals(
  "buy_hold",
  [1, 2, 3].map((close, index) => candle(midnight + index * 86_400, close, close, close, close)),
  {},
)
assert.deepEqual(held, [1, 1, 1])

const sample: TapeCandle[] = []
let price = 100
for (let index = 0; index < 80; index += 1) {
  const open = index === 24 ? price * 1.03 : price
  price = Math.max(1, price + Math.sin(index / 2) + (index > 40 ? 0.45 : -0.08))
  const t = midnight + index * 10_800
  sample.push(candle(t, open, Math.max(open, price) + 1, Math.min(open, price) - 1, price, 5 + index))
}

for (const rule of RULES) {
  const run = createRun({ rule: rule.id, feeBps: 10, name: rule.name })
  const result = backtest(sample, run, 365)
  const signals = buildSignals(rule.id, sample, run.params)
  assert.equal(result.strategy.name, rule.name, rule.id)
  assert.equal(signals.length, sample.length, rule.id)
  assert.ok(signals.every((value) => value === 0 || value === 1), rule.id)
  assert.ok(result.trades.every((trade) => trade.side === "long"), rule.id)
  assert.equal(result.assumptions.allow_short, false)
  assert.equal(result.assumptions.fee_bps, 10)
}

const filtered = createRun({ rule: "bollinger", params: { period: 5, mult: 1, rsiOn: 1 }, feeBps: 0, name: "Filtered" })
const faded = backtest(sample, filtered, 365)
assert.ok(faded.trades.every((trade) => trade.side === "long"))

console.log("strategy library ok")
