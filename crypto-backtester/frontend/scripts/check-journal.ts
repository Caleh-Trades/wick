import assert from "node:assert/strict"

import { editConcerns } from "../src/lib/bot-edits.ts"
import { alertEntries, logAlert, removeAlert } from "../src/lib/journal.ts"
import {
  PAGE_SIZE,
  dumpBook,
  emptyQuery,
  findRun,
  keepDeskRun,
  listStrategies,
  logBookTrade,
  logTradeOp,
  matchingTrades,
  removeRun,
  removeStrategy,
  replaceBook,
  resetBookForTests,
  saveStrategy,
  searchTrades,
  setRunNote,
  setStrategyNote,
  tradesCsv,
  tradesForRun,
} from "../src/lib/records.ts"
import { armReading, asDeltaAlert, createSlot, deltaCrosses, priceCrosses } from "../src/lib/workspace.ts"
import type { RunMetrics, Trade } from "../src/lib/types.ts"

const slot = createSlot("BTCUSDT", "spot", "1d", "1Y")
assert.equal(slot.deltaAlert, null)
assert.equal(asDeltaAlert(undefined), null)
assert.equal(asDeltaAlert(0), null)
assert.equal(asDeltaAlert(1.5), 1.5)
assert.equal(priceCrosses(82842, { kind: "above", value: 82800 }), true)
assert.equal(priceCrosses(82842, { kind: "below", value: 82800 }), false)
assert.equal(priceCrosses(null, { kind: "above", value: 1 }), false)
assert.equal(deltaCrosses(3, 2), true)
assert.equal(deltaCrosses(-3, 2), true)
assert.equal(deltaCrosses(1, 2), false)
assert.equal(deltaCrosses(4, null), false)
const quiet = armReading({ alert: { kind: "above", value: 83000 }, deltaAlert: null, trade: 82800, delta: 0, heard: true })
assert.equal(quiet.hot, false)
assert.equal(quiet.price, 83000)
const crossed = armReading({ alert: { kind: "above", value: 83000 }, deltaAlert: null, trade: 83100, delta: 0, heard: true })
assert.equal(crossed.hot, true)
assert.equal(crossed.side, "above")
const bought = armReading({ alert: null, deltaAlert: 1.5, trade: 100, delta: 2, heard: true })
assert.equal(bought.hot, true)
assert.equal(bought.side, "buy")
const sold = armReading({ alert: null, deltaAlert: 1.5, trade: 100, delta: -2, heard: true })
assert.equal(sold.side, "sell")
const workspace = { slots: [slot], activeId: slot.id, pinnedId: null, enlarged: false }
assert.equal(editConcerns(workspace, [{ op: "log-trade", symbol: "ETH", side: "sell", price: 1, size: 1 }]), true)

resetBookForTests()

const metrics = (total: number, trades: number, equity: number): RunMetrics => ({
  total_return_pct: total,
  cagr_pct: null,
  max_drawdown_pct: -6,
  sharpe: 0.1,
  win_rate_pct: 40,
  profit_factor: null,
  expectancy: null,
  trades,
  final_equity: equity,
})

const closedTrade = (entry: string, exit: string, pnl: number, ret: number): Trade => ({
  entry_time: entry,
  exit_time: exit,
  side: "long",
  entry_price: 100,
  exit_price: 100,
  quantity: 1,
  pnl,
  return_pct: ret,
  bars_held: 1,
  status: "closed",
  funding_paid: 0,
  fee_paid: 1,
  slippage_paid: 0.2,
})

const quoted = await keepDeskRun({
  name: "SMA 20/50",
  symbol: "BTC",
  venue: "spot",
  timeframe: "1d",
  range: "1Y",
  rule: "sma_cross",
  params: { fast: 20, slow: 50 },
  combo: [],
  fee: 10,
  slippage: 5,
  capital: 10_000,
  leverage: 1,
  risk: 100,
  allowShort: false,
  note: "skip the wick",
  metrics: metrics(4.1, 3, 10410),
  trades: [
    closedTrade("2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z", -5000, -13.8),
    closedTrade("2026-02-01T00:00:00Z", "2026-02-02T00:00:00Z", -400, -2.6),
    closedTrade("2026-03-01T00:00:00Z", "2026-03-02T00:00:00Z", 10, 0.8),
    {
      entry_time: "2026-04-01T00:00:00Z",
      exit_time: null,
      side: "long",
      entry_price: 100,
      exit_price: null,
      quantity: 1,
      pnl: 9000,
      return_pct: 40,
      bars_held: 1,
      status: "open",
      funding_paid: 0,
    },
  ],
})
assert.ok(quoted)
assert.equal("trades" in quoted.run, false)
assert.equal("candles" in quoted.run, false)
assert.equal("equity" in quoted.run, false)
assert.equal(quoted.strategy.symbol, "BTCUSDT")
assert.equal(quoted.strategy.risk, 5)
assert.equal(quoted.run.strategyId, quoted.strategy.id)
assert.equal(quoted.run.range, "1Y")
assert.equal(quoted.run.note, "skip the wick")
const linked = await tradesForRun(quoted.run.id)
assert.equal(linked.length, 4)
assert.ok(linked.every((trade) => trade.runId === quoted.run.id && trade.strategyId === quoted.strategy.id))
assert.equal(linked.filter((trade) => trade.exitTime == null).length, 1)
const page = await searchTrades(emptyQuery())
assert.equal(page.rows.length, 4)
assert.equal(page.total, 4)
assert.equal(page.closed, 3)
assert.equal(page.open, 1)
const quotedFactor = 0.8 / (13.8 + 2.6)
assert.ok(page.profitFactor != null && Math.abs(page.profitFactor - quotedFactor) < 1e-12)
assert.ok(page.profitFactor < 1)
assert.ok(page.expectancy != null && Math.abs(page.expectancy - -5.2) < 1e-9)
await setRunNote(quoted.run.id, "still the wick")
const found = await findRun({ symbol: "BTCUSDT", market: "spot", timeframe: "1d", range: "1Y", rule: "sma_cross", params: { fast: 20, slow: 50 } })
assert.equal(found?.run.id, quoted.run.id)
assert.equal(found?.run.note, "still the wick")
assert.equal(await findRun({ symbol: "BTCUSDT", market: "spot", timeframe: "1d", range: "1Y", rule: "sma_cross", params: { fast: 10, slow: 50 } }), null)

const closedOnly = await searchTrades({ ...emptyQuery(), state: "closed" })
assert.equal(closedOnly.total, 3)
assert.equal(closedOnly.rows.length, 3)
assert.ok(closedOnly.rows.every((trade) => trade.exitTime != null))
assert.equal(closedOnly.profitFactor, page.profitFactor)
assert.equal(closedOnly.expectancy, page.expectancy)

resetBookForTests()
for (let index = 0; index < 120; index += 1) {
  const logged = await logBookTrade({
    symbol: index % 2 === 0 ? "BTC" : "ETH",
    side: index % 3 === 0 ? "short" : "long",
    entryPrice: 100,
    exitPrice: index % 5 === 0 ? null : 110,
    size: 1,
    entryTime: new Date(Date.UTC(2024, 0, 1, 0, index)).toISOString(),
    source: "desk",
  })
  assert.ok(logged)
}
const first = await searchTrades(emptyQuery(0))
assert.equal(PAGE_SIZE, 50)
assert.equal(first.rows.length, 50)
assert.equal(first.total, 120)
assert.ok(first.rows[0]!.entryTime > first.rows[49]!.entryTime)
const third = await searchTrades({ ...emptyQuery(), page: 2 })
assert.equal(third.rows.length, 20)
assert.equal(third.total, 120)
const btc = await searchTrades({ ...emptyQuery(), symbol: "BTC" })
assert.equal(btc.total, 60)
assert.equal(btc.rows.length, 50)
assert.ok(btc.rows.every((trade) => trade.symbol === "BTCUSDT"))
const shorts = await searchTrades({ ...emptyQuery(), side: "short", state: "open" })
assert.ok(shorts.total > 0)
assert.ok(shorts.rows.every((trade) => trade.side === "short" && trade.exitTime == null))
assert.ok(shorts.rows.length <= PAGE_SIZE)
const csv = tradesCsv(await matchingTrades({ ...emptyQuery(), symbol: "ETH", side: "long", state: "closed" }))
assert.equal(csv.split("\n")[0], "entry,exit,side,return,pnl,fee,slippage,size,symbol,note,source")
assert.ok(csv.includes("ETHUSDT"))
assert.equal(csv.includes("BTCUSDT"), false)

resetBookForTests()
assert.equal(
  await logTradeOp({ op: "log-trade", symbol: "ETHFI", side: "short", price: 0.68, size: 20, note: "fade", strategy: "supertrend", exit: 0.6 }),
  true,
)
const botPage = await searchTrades(emptyQuery())
assert.equal(botPage.total, 1)
assert.equal(botPage.rows.length, 1)
assert.equal(botPage.rows[0]?.source, "bot")
assert.equal(botPage.rows[0]?.symbol, "ETHFIUSDT")
assert.equal(botPage.rows[0]?.side, "short")
assert.equal(botPage.rows[0]?.note, "fade")
assert.equal((await listStrategies()).some((row) => row.rule === "supertrend"), true)

const before = (await searchTrades(emptyQuery())).total
const alert = logAlert({ symbol: "BTC", venue: "perp", alertKind: "above", value: 82000.5, threshold: 80000 })
assert.equal(alert?.kind, "alert")
assert.equal(alert?.symbol, "BTCUSDT")
assert.match(alert?.note ?? "", /82,000\.5/)
assert.equal((await searchTrades(emptyQuery())).total, before)
assert.equal(alertEntries()[0]?.id, alert?.id)
if (alert) removeAlert(alert.id)
assert.equal(alertEntries().some((entry) => entry.id === alert?.id), false)

resetBookForTests()
await replaceBook({
  kept: [
    {
      id: "old-kept",
      name: "Funded",
      symbol: "ETH",
      venue: "perp",
      timeframe: "1h",
      range: "1M",
      rule: "sma_cross",
      params: { fast: 10, slow: 30 },
      feeBps: 4,
      slippageBps: 2,
      capital: 10_000,
      leverage: 3,
      riskPct: 1,
      allowShort: true,
      note: "holdout faded",
      candles: [{ t: 1, close: 100 }],
      trades: [closedTrade("2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z", 9, 9)],
      metrics: metrics(3, 1, 10300),
    },
  ],
  journal: [{ id: "row", kind: "trade", symbol: "SOL", side: "buy", price: 50, size: 2, note: "open idea" }],
})
const migrated = await dumpBook()
assert.equal(migrated.runs.length, 1)
assert.equal("candles" in migrated.runs[0]!, false)
assert.equal("trades" in migrated.runs[0]!, false)
assert.equal(migrated.runs[0]?.note, "holdout faded")
assert.equal(migrated.trades.filter((trade) => trade.runId === migrated.runs[0]?.id).length, 1)
assert.equal(migrated.trades.some((trade) => trade.symbol === "SOLUSDT" && trade.exitTime == null), true)
assert.equal(migrated.strategies.find((row) => row.symbol === "ETHUSDT")?.market, "perp")
assert.equal(migrated.strategies.find((row) => row.symbol === "ETHUSDT")?.leverage, 3)

const stacked = await saveStrategy({
  name: "Stack",
  symbol: "BTC",
  market: "spot",
  timeframe: "1d",
  range: "1Y",
  rule: "sma_cross",
  params: { fast: 20, slow: 50 },
  combo: [
    { rule: "ema_cross", params: {} },
    { rule: "donchian", params: {} },
    { rule: "macd", params: {} },
    { rule: "supertrend", params: {} },
    { rule: "sma_cross", params: {} },
  ],
  fee: 10,
  slippage: 5,
  risk: 1,
  note: "holds the 1h trend",
})
assert.deepEqual(
  stacked?.combo.map((item) => item.rule),
  ["ema_cross", "donchian", "macd", "supertrend"],
)
assert.equal(stacked?.allowShort, false)
await setStrategyNote(stacked!.id, "still holding")
assert.equal((await listStrategies()).find((row) => row.id === stacked?.id)?.note, "still holding")
assert.equal(await removeStrategy(stacked!.id), true)

const working = await saveStrategy({
  name: "ETHFI trend",
  symbol: "ETHFI",
  market: "spot",
  timeframe: "1h",
  range: "3M",
  rule: "supertrend",
  params: { atr: 10, mult: 3 },
  combo: [{ rule: "ema_cross", params: { fast: 12, slow: 26 } }, { rule: "supertrend", params: {} }],
  fee: 8,
  slippage: 2,
  capital: 25_000,
  leverage: 5,
  risk: 1,
  allowShort: true,
  note: "holds the 1h trend",
})
assert.equal(working?.symbol, "ETHFIUSDT")
assert.equal(working?.market, "spot")
assert.equal(working?.allowShort, false)
assert.equal(working?.leverage, 1)
assert.equal(working?.params.atr, 10)
assert.deepEqual(working?.combo.map((item) => item.rule), ["ema_cross"])
assert.equal(await saveStrategy({ ...working!, symbol: "", rule: "sma_cross" }), null)
assert.equal(await saveStrategy({ ...working!, timeframe: "2h" }), null)

await replaceBook({
  strategies: [{ id: "work-2", name: "Fade", symbol: "SOL", market: "perp", timeframe: "15m", range: "1M", rule: "rsi_reversion", params: { period: 14 }, note: "oversold bounce" }],
  runs: [],
  trades: [],
})
const replaced = await listStrategies()
assert.equal(replaced.length, 1)
assert.equal(replaced[0]?.symbol, "SOLUSDT")
assert.equal(replaced[0]?.market, "perp")
assert.equal(replaced[0]?.allowShort, true)
assert.equal(replaced[0]?.leverage, 3)
await replaceBook({ strategies: "nope", runs: [], trades: [] })
assert.equal((await listStrategies()).length, 0)

if (quoted) await removeRun(quoted.run.id)

console.log("journal ok")
