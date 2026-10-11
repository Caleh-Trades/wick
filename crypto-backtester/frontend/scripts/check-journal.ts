import assert from "node:assert/strict"

import { editConcerns } from "../src/lib/bot-edits.ts"
import { crossBookRun } from "../src/lib/cross-book.ts"
import { tapeForSlot } from "../src/lib/workspace.ts"
import { dailyReturns, pairedReturns, pearson } from "../src/lib/correlation.ts"
import { ruleDiff } from "../src/lib/diff.ts"
import { bestOpenReturn, gaveBack, openR } from "../src/lib/open-trade.ts"
import { replayTrades } from "../src/lib/replay.ts"
import { alertEntries, logAlert, removeAlert } from "../src/lib/journal.ts"
import {
  armAllowed,
  cumulativeDelta,
  defaultSession,
  lossStreak,
  pinSymbol,
  rowIsStale,
  slotUnsynced,
  ticketFills,
} from "../src/lib/desk.ts"
import {
  PAGE_SIZE,
  closeJournalTrade,
  dumpBook,
  emptyQuery,
  emptyTicketQuery,
  fillWorkingTicket,
  findRun,
  keepDeskRun,
  listStrategies,
  liveTicket,
  logBookTrade,
  logTradeOp,
  matchingTrades,
  setRunPaper,
  syncPaperTrades,
  promoteWorkingTicket,
  removeRun,
  removeStrategy,
  replaceBook,
  resetBookForTests,
  saveStrategy,
  saveTicket,
  searchTickets,
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
const hidden = await searchTrades(emptyQuery())
assert.equal(hidden.total, 0)
assert.equal(hidden.rows.length, 0)
const own = await logBookTrade({ symbol: "BTC", side: "long", entryPrice: 100, size: 1, exitPrice: 110, note: "my fill" })
assert.ok(own)
assert.equal(own.runId, null)
const visible = await searchTrades(emptyQuery())
assert.equal(visible.total, 1)
assert.equal(visible.rows[0]?.note, "my fill")
assert.equal(visible.rows.some((trade) => trade.runId != null), false)
await setRunNote(quoted.run.id, "still the wick")
const found = await findRun({ symbol: "BTCUSDT", market: "spot", timeframe: "1d", range: "1Y", rule: "sma_cross", params: { fast: 20, slow: 50 } })
assert.equal(found?.run.id, quoted.run.id)
assert.equal(found?.run.note, "still the wick")
assert.equal(await findRun({ symbol: "BTCUSDT", market: "spot", timeframe: "1d", range: "1Y", rule: "sma_cross", params: { fast: 10, slow: 50 } }), null)

const closedOnly = await searchTrades({ ...emptyQuery(), state: "closed" })
assert.equal(closedOnly.total, 1)
assert.equal(closedOnly.rows[0]?.id, own?.id)

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
assert.equal(csv.split("\n")[0], "entry,exit,side,return,pnl,mae,mfe,fee,slippage,size,symbol,note,source")
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

resetBookForTests()
const perp = await logBookTrade({ symbol: "BTC", side: "short", entryPrice: 100, size: 1, venue: "perp", market: "perp" })
const spot = await logBookTrade({ symbol: "BTC", side: "long", entryPrice: 100, size: 1, venue: "spot", market: "spot" })
assert.equal(perp?.market, "perp")
assert.equal(spot?.market, "spot")
const spotLog = await searchTrades({ ...emptyQuery(), market: "spot" })
assert.equal(spotLog.total, 1)
assert.equal(spotLog.rows[0]?.id, spot?.id)
const perpLog = await searchTrades({ ...emptyQuery(), market: "perp" })
assert.equal(perpLog.total, 1)
assert.equal(perpLog.rows[0]?.id, perp?.id)
assert.equal(perpLog.rows[0]?.riskMode, "NORMAL")

const ticket = await saveTicket({
  symbol: "ETH",
  market: "perp",
  side: "long",
  strategy: "ORB",
  entry: 200,
  stop: 190,
  size: 2,
  r: 2,
  riskMode: "PRESS",
  session: "open",
})
assert.ok(ticket)
assert.equal((await liveTicket("ETHUSDT", "perp"))?.id, ticket?.id)
assert.equal(ticketFills("long", 200, 201), false)
assert.equal(ticketFills("long", 200, 199), true)
const filled = await fillWorkingTicket(ticket!.id, 198.5)
assert.ok(filled)
assert.equal(filled?.trade.entryPrice, 198.5)
assert.equal(filled?.trade.stop, 190)
assert.equal(filled?.trade.r, 2)
assert.equal(filled?.trade.exitTime, null)
assert.equal(filled?.trade.market, "perp")
assert.equal(filled?.trade.ticketId, ticket?.id)
assert.equal(filled?.trade.riskMode, "PRESS")
assert.equal(filled?.trade.strategyName, "ORB")
assert.equal((await listStrategies()).some((row) => row.name === "ORB"), false)
const again = await fillWorkingTicket(ticket!.id, 10)
assert.equal(again?.trade.id, filled?.trade.id)
assert.equal(again?.trade.entryPrice, 198.5)
const spotAfterFill = await searchTrades({ ...emptyQuery(), market: "spot" })
assert.equal(spotAfterFill.rows.some((row) => row.id === filled?.trade.id), false)

const planned = await saveTicket({
  symbol: "SOL",
  market: "spot",
  side: "long",
  strategy: "Fade",
  entry: 80,
  stop: 76,
  size: 1,
  r: 1.5,
  riskMode: "DEFENSIVE",
  session: "closed",
})
const promoted = await promoteWorkingTicket(planned!.id)
assert.equal(promoted?.ticket.armed, true)
assert.equal(promoted?.trade.strategyName, "Fade")
assert.equal(promoted?.trade.note, `ticket ${planned?.id}`)
assert.equal(promoted?.trade.ticketId, planned?.id)
assert.equal(promoted?.ticket.tradeId, promoted?.trade.id)
const filledPlan = await fillWorkingTicket(planned!.id, 79)
assert.equal(filledPlan?.trade.id, promoted?.trade.id)
assert.equal(filledPlan?.trade.entryPrice, 79)
assert.equal(filledPlan?.trade.stop, 76)
assert.equal(filledPlan?.trade.note, `ticket ${planned?.id}`)
assert.equal(filledPlan?.trade.exitTime, null)

assert.equal(rowIsStale({ id: promoted!.trade.id, symbol: "SOLUSDT", market: "spot", exitTime: null }, []), true)
assert.equal(
  rowIsStale(
    { id: promoted!.trade.id, symbol: "SOLUSDT", market: "spot", exitTime: null },
    [{ symbol: "SOLUSDT", market: "spot", side: "long", size: 1, entry: 79, tradeId: promoted!.trade.id }],
  ),
  false,
)
assert.equal(slotUnsynced("SOLUSDT", "spot", [{ symbol: "SOLUSDT", market: "spot", side: "long", size: 1, entry: 79, tradeId: "missing" }], []), true)
const closed = await closeJournalTrade(filledPlan!.trade.id, 90)
assert.equal(closed?.exitPrice, 90)
assert.ok((closed?.returnPct ?? 0) > 0)

const defensive = await searchTrades({ ...emptyQuery(), riskMode: "DEFENSIVE" })
assert.ok(defensive.rows.every((row) => row.riskMode === "DEFENSIVE"))
const press = await searchTickets({ ...emptyTicketQuery(), riskMode: "PRESS", session: "open" })
assert.equal(press.total, 1)
assert.equal(press.rows[0]?.strategy, "ORB")

const keptSample = await keepDeskRun({
  name: "Walk",
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
  risk: 1,
  allowShort: false,
  note: "",
  metrics: {
    total_return_pct: 4.1,
    cagr_pct: null,
    max_drawdown_pct: -6,
    sharpe: 0.1,
    win_rate_pct: 40,
    profit_factor: 0.04878048780487805,
    expectancy: -5.2,
    trades: 3,
    final_equity: 10410,
  },
  trades: [],
  sample: {
    inSample: { total_return_pct: 2, max_drawdown_pct: -1, sharpe: 0.2, trades: 2 },
    holdout: { total_return_pct: -0.4, max_drawdown_pct: -2, sharpe: -0.1, trades: 1 },
    windows: [
      { total_return_pct: 1, max_drawdown_pct: -1, sharpe: 0.1, trades: 1 },
      { total_return_pct: 0.5, max_drawdown_pct: -0.5, sharpe: 0.1, trades: 1 },
      { total_return_pct: -0.2, max_drawdown_pct: -0.4, sharpe: null, trades: 1 },
    ],
  },
  costs: { beforeFees: 4.4, fees: 12, slippage: 1.2, afterCosts: 4.1 },
})
assert.equal(keptSample?.run.sample?.windows.length, 3)
assert.equal(keptSample?.run.costs?.afterCosts, 4.1)
assert.equal("candles" in (keptSample?.run ?? {}), false)
assert.equal("walk_forward" in (keptSample?.run ?? {}), false)

const pins = pinSymbol(["BTCUSDT"], "BTCUSDT", "ETHUSDT")
const withSol = pinSymbol(pins.pins, "ETHUSDT", "SOLUSDT")
const swapped = pinSymbol(withSol.pins, "ETHUSDT", "XRPUSDT")
assert.deepEqual(withSol.pins, ["BTCUSDT", "ETHUSDT", "SOLUSDT"])
assert.deepEqual(swapped.pins, ["BTCUSDT", "XRPUSDT", "SOLUSDT"])
assert.equal(swapped.symbol, "XRPUSDT")
assert.equal(pinSymbol(swapped.pins, "XRPUSDT", "BTCUSDT").pins.length, 3)

assert.equal(defaultSession(new Date("2026-10-10T12:00:00Z")), "stand-down")
assert.equal(defaultSession(new Date("2026-10-11T12:00:00Z")), "stand-down")
assert.equal(defaultSession(new Date("2026-10-12T12:00:00Z")), "open")
assert.equal(armAllowed("stand-down"), false)
assert.equal(armAllowed("open"), true)
assert.deepEqual(cumulativeDelta([{ side: "buy", size: 2 }, { side: "sell", size: 0.5 }, { side: "buy", size: 1 }]), [2, 1.5, 2.5])
assert.deepEqual(cumulativeDelta([]), [])

const streakTrades = [
  { runId: null, source: "desk", exitTime: "2026-01-03T00:00:00Z", pnl: -1 },
  { runId: null, source: "desk", exitTime: "2026-01-02T00:00:00Z", pnl: -2 },
  { runId: null, source: "desk", exitTime: "2026-01-01T00:00:00Z", pnl: 5 },
  { runId: "backtest", source: "desk", exitTime: "2026-01-04T00:00:00Z", pnl: -9 },
  { runId: "paper-run", source: "paper", exitTime: "2026-01-05T00:00:00Z", pnl: -9 },
]
assert.equal(lossStreak(streakTrades, null), 2)
assert.equal(lossStreak(streakTrades, "2026-01-03T00:00:00.000Z"), 0)

const fromReturns = (returns: number[]) => {
  const candles: Array<{ t: number; close: number }> = [{ t: 1_700_000_000, close: 100 }]
  let close = 100
  returns.forEach((value, index) => {
    close *= 1 + value
    candles.push({ t: 1_700_000_000 + (index + 1) * 86_400, close })
  })
  return candles
}
const up = fromReturns([0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08])
const down = fromReturns([-0.01, -0.02, -0.03, -0.04, -0.05, -0.06, -0.07, -0.08])
const same = pearson(pairedReturns(dailyReturns(up, 30), dailyReturns(up, 30)))
const opposite = pearson(pairedReturns(dailyReturns(up, 30), dailyReturns(down, 30)))
assert.ok(same != null && same > 0.99)
assert.ok(opposite != null && opposite < -0.99)

const replayed = replayTrades(
  [
    { entry_time: "a", exit_time: "c", side: "long", entry_price: 1, exit_price: 2, quantity: 1, pnl: 1, return_pct: 1, bars_held: 2, status: "closed", funding_paid: 0 },
    { entry_time: "d", exit_time: null, side: "long", entry_price: 2, exit_price: null, quantity: 1, pnl: 0, return_pct: 0, bars_held: 0, status: "open", funding_paid: 0 },
  ],
  "b",
)
assert.equal(replayed.length, 1)
assert.equal(replayed[0]?.status, "open")
assert.equal(replayed[0]?.exit_time, null)

if (keptSample) {
  await setRunPaper(keptSample.run.id, true, "2026-01-01T00:00:00Z")
  await syncPaperTrades({
    runId: keptSample.run.id,
    strategyId: keptSample.strategy.id,
    symbol: keptSample.strategy.symbol,
    market: keptSample.strategy.market,
    since: "2026-01-01T00:00:00Z",
    trades: [
      {
        entry_time: "2026-02-01T00:00:00Z",
        exit_time: "2026-02-02T00:00:00Z",
        side: "long",
        entry_price: 10,
        exit_price: 11,
        quantity: 1,
        pnl: 1,
        return_pct: 10,
        mae: -1,
        mfe: 12,
        bars_held: 1,
        status: "closed",
        funding_paid: 0,
      },
    ],
  })
  const journal = await matchingTrades(emptyQuery())
  assert.equal(journal.some((trade) => trade.source === "paper"), false)
  const paper = (await tradesForRun(keptSample.run.id)).filter((trade) => trade.source === "paper")
  assert.equal(paper.length, 1)
  assert.equal(paper[0]?.mae, -1)
  assert.equal(paper[0]?.mfe, 12)
}

assert.equal(openR("long", 100, 90, 110), 1)
assert.equal(openR("short", 100, 110, 90), 1)
assert.equal(openR("long", 100, 110, 105), null)
assert.equal(gaveBack(3, 10, 40), true)
assert.equal(gaveBack(5, 10, 40), false)
assert.equal(gaveBack(-1, 0, 40), false)
const best = bestOpenReturn("long", 100, 105, [{ time: "2026-01-02T00:00:00Z", high: 120, low: 99 }], "2026-01-01T00:00:00Z")
assert.ok(Math.abs(best - 20) < 1e-9)

const lines = ruleDiff(
  { rule: "sma_cross", params: { fast: 20, slow: 50 }, totalReturn: 4, maxDrawdown: -6, winRate: 40, trades: 3 },
  { rule: "sma_cross", params: { fast: 10, slow: 50 }, totalReturn: 4, maxDrawdown: -8, winRate: 40, trades: 5 },
)
assert.deepEqual(lines.map((line) => line.field), ["Fast", "Drawdown", "Trades"])

const base = {
  id: "run",
  name: "SMA",
  symbol: "BTCUSDT",
  rule: "sma_cross",
  params: {},
  combo: [],
  feeBps: 10,
  slippageBps: 5,
  capital: 10_000,
  leverage: 1,
  riskPct: 1,
  allowShort: true,
  hidden: false,
} as const
assert.equal(crossBookRun(base, "ETHUSDT", "spot").allowShort, false)
assert.equal(crossBookRun(base, "ETHUSDT", "spot").symbol, "ETHUSDT")
assert.equal(crossBookRun(base, "SOLUSDT", "perp").allowShort, true)

const wide = {
  symbol: "ETHUSDT",
  interval: "4h",
  range: "6Y",
  source: "kraken-perp",
  venue: "perp",
  seconds: 14400,
  periodsPerYear: 2190,
  candles: [
    { t: 1_000, time: "a", open: 1, high: 1, low: 1, close: 1 },
    { t: 500_000, time: "b", open: 2, high: 2, low: 2, close: 2 },
  ],
} as const
const sliced = tapeForSlot({ "perp|4h|6Y|ETHUSDT": wide }, { venue: "perp", timeframe: "4h", range: "5D", symbol: "ETHUSDT" })
assert.equal(sliced?.candles.length, 1)
assert.equal(sliced?.candles[0]?.t, 500_000)

console.log("journal ok")
