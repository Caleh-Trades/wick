import assert from "node:assert/strict"

import { editConcerns } from "../src/lib/bot-edits.ts"
import { journalEntries, journalStats, keepRun, keptExport, keptRuns, logAlert, logTrade, logTradeOp, removeJournalEntry, removeKeptRun, setKeptNote, tradePnl } from "../src/lib/journal.ts"
import { createSlot } from "../src/lib/workspace.ts"

const slot = createSlot("BTCUSDT", "spot", "1d", "1Y")
const workspace = { slots: [slot], activeId: slot.id, pinnedId: null, enlarged: false }
assert.equal(editConcerns(workspace, [{ op: "log-trade", symbol: "ETH", side: "sell", price: 1, size: 1 }]), true)

const entry = logTrade({ symbol: "BTC", side: "long", price: 100, size: 0.25, note: "breakout", strategy: "sma_cross", exitPrice: 110 })
assert.ok(entry)
assert.equal(entry?.symbol, "BTCUSDT")
assert.equal(entry?.side, "buy")
assert.equal(entry?.venue, "spot")
assert.equal(entry?.strategy, "SMA crossover")
assert.equal(entry?.exitPrice, 110)
assert.equal(tradePnl(entry!), 2.5)
assert.equal(journalEntries()[0]?.note, "breakout")

const short = logTrade({ symbol: "ETH", side: "short", price: 200, size: 1, exitPrice: 180, strategy: "fade the open" })
assert.equal(tradePnl(short!), 20)
assert.equal(short?.strategy, "fade the open")

const open = logTrade({ symbol: "SOL", side: "buy", price: 50, size: 2 })
assert.equal(open?.exitPrice, null)
assert.equal(open?.strategy, "")
assert.equal(tradePnl(open!), null)

const scratched = logTrade({ symbol: "BTC", side: "buy", price: 10, size: 1, exitPrice: -1 })
assert.equal(scratched?.exitPrice, null)

const stats = journalStats(journalEntries())
assert.equal(stats.closed, 2)
assert.equal(stats.open, 2)
assert.equal(stats.pnl, 22.5)
assert.equal(stats.winRate, 100)
assert.equal(stats.profitFactor, Number.POSITIVE_INFINITY)
assert.equal(stats.strategies[0]?.name, "fade the open")
assert.equal(stats.strategies.some((row) => row.name === "No strategy"), false)

assert.equal(logTrade({ symbol: "", side: "buy", price: 1, size: 1 }), null)
assert.equal(
  logTradeOp({ op: "log-trade", symbol: "ETHFI", side: "short", price: 0.68, size: 20, note: "fade", strategy: "supertrend", exit: 0.6 }),
  true,
)
assert.equal(journalEntries()[0]?.side, "sell")
assert.equal(journalEntries()[0]?.symbol, "ETHFIUSDT")
assert.equal(journalEntries()[0]?.strategy, "Supertrend")
assert.equal(tradePnl(journalEntries()[0]!), (0.68 - 0.6) * 20)

const kept = keepRun({
  name: "SMA 20/50",
  symbol: "BTC",
  venue: "spot",
  timeframe: "1d",
  range: "1Y",
  rule: "sma_cross",
  params: { fast: 20, slow: 50 },
  combo: [],
  feeBps: 10,
  capital: 10_000,
  leverage: 1,
  riskPct: 100,
  allowShort: false,
  metrics: {
    total_return_pct: -12.5,
    cagr_pct: -8,
    max_drawdown_pct: -20,
    sharpe: 0.2,
    win_rate_pct: 40,
    profit_factor: 0.8,
    trades: 4,
    final_equity: 8750,
  },
})
assert.equal(kept?.symbol, "BTCUSDT")
assert.equal(kept?.venue, "spot")
assert.equal(kept?.allowShort, false)
assert.equal(keptRuns()[0]?.rule, "sma_cross")
assert.equal(keptRuns()[0]?.metrics.trades, 4)
assert.equal(kept?.note, "")
assert.equal(kept?.fundingPaid, 0)
assert.equal(kept?.inSample, null)
assert.equal(kept?.holdout, null)
assert.deepEqual(kept?.trades, [])
if (kept) {
  setKeptNote(kept.id, "skip the wick")
  assert.equal(keptRuns()[0]?.note, "skip the wick")
  const exported = keptExport(keptRuns()[0]!)
  assert.equal(exported.symbol, "BTCUSDT")
  assert.equal(exported.market, "spot")
  assert.equal(exported.rule, "sma_cross")
  assert.deepEqual(exported.params, { fast: 20, slow: 50 })
  assert.equal(exported.metrics.trades, 4)
  assert.equal(exported.in_sample, null)
  assert.equal(exported.holdout, null)
  assert.deepEqual(exported.trades, [])
  assert.equal(exported.note, "skip the wick")
  assert.equal(exported.funding_paid, 0)
  assert.equal("order" in exported, false)
}
const rich = keepRun({
  name: "Funded",
  symbol: "ETH",
  venue: "perp",
  timeframe: "1h",
  range: "1M",
  rule: "sma_cross",
  params: { fast: 10, slow: 30 },
  combo: [],
  feeBps: 4,
  capital: 10_000,
  leverage: 3,
  riskPct: 100,
  allowShort: true,
  note: "holdout faded",
  fundingPaid: 12.5,
  inSample: { total_return_pct: 4, max_drawdown_pct: -2, sharpe: 0.4, trades: 3 },
  holdout: { total_return_pct: -1, max_drawdown_pct: -6, sharpe: null, trades: 1 },
  trades: [
    {
      entry_time: "2026-01-01T00:00:00Z",
      exit_time: "2026-01-02T00:00:00Z",
      side: "long",
      entry_price: 100,
      exit_price: 110,
      quantity: 1,
      pnl: 9,
      return_pct: 9,
      bars_held: 24,
      status: "closed",
      funding_paid: 12.5,
    },
  ],
  metrics: {
    total_return_pct: 3,
    cagr_pct: 1,
    max_drawdown_pct: -6,
    sharpe: 0.1,
    win_rate_pct: 50,
    profit_factor: 1.1,
    trades: 4,
    final_equity: 10300,
  },
})
assert.equal(rich?.fundingPaid, 12.5)
assert.equal(rich?.inSample?.trades, 3)
assert.equal(rich?.holdout?.sharpe, null)
assert.equal(keptExport(rich!).trades[0]?.funding_paid, 12.5)
assert.equal(keptExport(rich!).market, "perp")
if (rich) removeKeptRun(rich.id)
if (kept) removeKeptRun(kept.id)

const before = journalStats(journalEntries())
const alert = logAlert({ symbol: "BTC", venue: "perp", alertKind: "above", value: 82000.5, threshold: 80000 })
assert.equal(alert?.kind, "alert")
assert.equal(alert?.symbol, "BTCUSDT")
assert.equal(alert?.alertKind, "above")
assert.match(alert?.note ?? "", /82,000\.5/)
const after = journalStats(journalEntries())
assert.equal(after.closed, before.closed)
assert.equal(after.open, before.open)
assert.equal(after.pnl, before.pnl)
if (alert) removeJournalEntry(alert.id)
assert.equal(keptRuns().length, 0)

for (const row of [...journalEntries()]) removeJournalEntry(row.id)
assert.equal(journalEntries().length, 0)

console.log("journal ok")
