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
assert.deepEqual(vwap, [0, 1, -1])

const prior = buildSignals("prev_day", [
  candle(midnight, 10, 10, 9, 10),
  candle(midnight + 3600, 10, 11, 10, 10),
  candle(midnight + 86_400, 11, 12, 11, 12),
  candle(midnight + 90_000, 8, 8, 7, 7),
], {})
assert.deepEqual(prior, [0, 0, 1, -1])

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
  assert.ok(signals.every((value) => value === -1 || value === 0 || value === 1), rule.id)
  assert.ok(result.trades.every((trade) => trade.side === "long" || trade.side === "short"), rule.id)
  if (rule.id === "buy_hold") assert.ok(result.trades.every((trade) => trade.side === "long"))
  assert.equal(result.assumptions.allow_short, true)
  assert.equal(result.assumptions.slippage_bps, 5)
  assert.equal(result.assumptions.initial_capital, 10_000)
  assert.equal(result.assumptions.fee_bps, 10)
}

const filtered = createRun({ rule: "bollinger", params: { period: 5, mult: 1, rsiOn: 1 }, feeBps: 0, name: "Filtered" })
const faded = backtest(sample, filtered, 365)
assert.ok(faded.trades.every((trade) => trade.side === "long" || trade.side === "short"))

const falling = [10, 10, 10, 9, 8, 6, 4, 3, 3, 4, 5, 6].map((close, index) => candle(midnight + index * 86_400, close, close, close, close))
const shortSignals = buildSignals("sma_cross", falling, { fast: 2, slow: 3 })
assert.ok(shortSignals.includes(-1))
const shortRun = createRun({ rule: "sma_cross", feeBps: 0, params: { fast: 2, slow: 3 }, name: "Short cross" })
const shorted = backtest(falling, shortRun, 365)
const shortTrade = shorted.trades.find((trade) => trade.side === "short" && trade.status === "closed")
assert.ok(shortTrade)
assert.ok((shortTrade?.pnl ?? 0) > 0)
assert.ok(buildSignals("buy_hold", falling, {}).every((value) => value === 1))

const flatRun = createRun({ rule: "sma_cross", feeBps: 0, params: { fast: 2, slow: 3 }, allowShort: false, name: "Flat cross" })
const flattened = backtest(falling, flatRun, 365)
assert.equal(flattened.assumptions.allow_short, false)
assert.equal(flattened.trades.some((trade) => trade.side === "short"), false)

const gapBars = [
  candle(midnight, 9, 10, 8, 9),
  candle(midnight + 3600, 10, 12, 10, 11),
  candle(midnight + 7200, 13, 14, 13, 13.5),
  candle(midnight + 10_800, 13.2, 13.4, 12.2, 12.6),
  candle(midnight + 14_400, 12, 12.2, 9, 10),
]
assert.deepEqual(buildSignals("fair_value_gap", gapBars, { gap: 1 }), [0, 0, 0, 1, 0])

const structure = [
  [10, 10, 9, 10],
  [14, 14, 13, 14],
  [11, 11, 10, 11],
  [15, 15, 14, 15],
  [11, 12, 10.5, 11],
  [11, 12, 10.5, 11],
  [7, 8, 7, 7],
].map(([close, high, low, open], index) => candle(midnight + index * 86_400, open!, high!, low!, close!))
assert.deepEqual(buildSignals("break_structure", structure, { swing: 1 }), [0, 0, 0, 1, 1, 1, 0])
assert.deepEqual(buildSignals("change_character", structure, { swing: 1 }), [0, 0, 0, 1, 1, 1, -1])
assert.ok(buildSignals("break_structure", structure, { swing: 1 }).every((value) => value !== -1))

const smoothed = buildSignals(
  "heikin_ashi",
  [
    candle(midnight, 10, 12, 9, 12),
    candle(midnight + 86_400, 12, 14, 11, 14),
    candle(midnight + 172_800, 14, 14, 8, 8),
  ],
  {},
)
assert.deepEqual(smoothed, [0, 1, 0])

const bricks = Array.from({ length: 8 }, (_, index) => candle(midnight + index * 86_400, 100, 101, 99, 100))
bricks.push(candle(midnight + 8 * 86_400, 100, 120, 100, 120))
const renko = buildSignals("renko", bricks, { atr: 2, mult: 1 })
assert.ok(renko.every((value) => value === 0 || value === 1))
assert.equal(renko.at(-1), 1)

const trigger: TapeCandle[] = []
for (let index = 0; index < 16; index += 1) trigger.push(candle(midnight + index * 3600, 100, 101, 99, 100))
trigger.push(candle(midnight + 16 * 3600, 100, 100.2, 97.8, 98))
trigger.push(candle(midnight + 17 * 3600, 97.9, 100.6, 99.5, 100.5))
trigger.push(candle(midnight + 18 * 3600, 100, 100, 90, 95))
const engulfed = buildSignals("candle_trigger", trigger, { pattern: 0, mult: 1.5 })
assert.equal(engulfed[17], 1)
assert.equal(engulfed[18], 0)

const hammer: TapeCandle[] = []
for (let index = 0; index < 16; index += 1) hammer.push(candle(midnight + index * 3600, 100, 101, 99, 100))
hammer.push(candle(midnight + 16 * 3600, 100, 101.5, 98, 101))
const hammered = buildSignals("candle_trigger", hammer, { pattern: 1, mult: 3 })
assert.equal(hammered[16], 1)
assert.ok(hammered.every((value) => value === 0 || value === 1))

const starRun = createRun({
  rule: "candle_trigger",
  params: { pattern: 2, mult: 1.5 },
  allowShort: false,
  feeBps: 0,
  name: "Star",
})
const starred = backtest(sample, starRun, 365)
assert.equal(starred.trades.some((trade) => trade.side === "short"), false)

const divergenceMoves = [...Array(20).fill(0.2), ...Array(4).fill(8), ...Array(5).fill(-4), ...Array(8).fill(3.2), ...Array(5).fill(-3)]
let divergencePrice = 100
const divergence = divergenceMoves.map((delta, index) => {
  const open = divergencePrice
  divergencePrice += delta
  return candle(midnight + index * 3600, open, Math.max(open, divergencePrice) + 0.2, Math.min(open, divergencePrice) - 0.2, divergencePrice)
})
const divergenceSignals = buildSignals("rsi_divergence", divergence, { period: 14, swing: 3 })
assert.ok(divergenceSignals.includes(-1))

const character = createRun({ rule: "change_character", params: { swing: 1 }, allowShort: false, feeBps: 0, name: "CHoCH flat" })
const characterRun = backtest(structure, character, 365)
assert.equal(characterRun.trades.some((trade) => trade.side === "short"), false)

console.log("strategy library ok")
