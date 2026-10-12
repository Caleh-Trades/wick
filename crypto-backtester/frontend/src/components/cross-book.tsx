import { useEffect, useRef, useState } from "react"

import { SymbolSetEditor } from "@/components/symbol-set-editor"
import { fetchCandles } from "@/lib/api"
import { isThinSample } from "@/lib/backtest"
import { computeBacktest } from "@/lib/compute"
import { crossBookRun } from "@/lib/cross-book"
import { marketLabel } from "@/lib/desk"
import { formatPct } from "@/lib/format"
import { fingerprint, rangeDays } from "@/lib/runs"
import type { MarketId, RangeId, Run, Timeframe, Venue } from "@/lib/types"

type Row = {
  symbol: MarketId
  totalReturn: number | null
  maxDrawdown: number | null
  trades: number | null
  expectancy: number | null
  error: string | null
}

export function CrossBookPage({
  run,
  venue,
  timeframe,
  range,
  symbols,
  onSymbols,
  closedTrades,
}: {
  run: Run | null
  venue: Venue
  timeframe: Timeframe
  range: RangeId
  symbols: MarketId[]
  onSymbols: (symbols: MarketId[]) => void
  /** Closed trades on the kept or active run. Under ten is a thin sample. */
  closedTrades: number | null
}) {
  const [rows, setRows] = useState<Row[]>([])
  const [pending, setPending] = useState(true)
  const runRef = useRef(run)
  runRef.current = run
  const mark = run ? fingerprint(run) : ""
  const thin = closedTrades != null && isThinSample(closedTrades)
  const symbolKey = symbols.join(",")

  useEffect(() => {
    const current = runRef.current
    if (!current || symbols.length === 0) {
      setRows([])
      setPending(false)
      return
    }
    let cancel = false
    setPending(true)
    const days = rangeDays(range)
    void Promise.all(
      symbols.map(async (symbol) => {
        try {
          const tape = await fetchCandles(symbol, timeframe, { days, range, venue })
          const outcome = await computeBacktest(crossBookRun(current, symbol, venue), tape)
          if (!outcome.ok) return { symbol, totalReturn: null, maxDrawdown: null, trades: null, expectancy: null, error: outcome.error }
          const metrics = outcome.result.metrics
          return {
            symbol,
            totalReturn: metrics.total_return_pct,
            maxDrawdown: metrics.max_drawdown_pct,
            trades: metrics.trades,
            expectancy: metrics.expectancy,
            error: null,
          }
        } catch (reason: unknown) {
          return {
            symbol,
            totalReturn: null,
            maxDrawdown: null,
            trades: null,
            expectancy: null,
            error: reason instanceof Error ? reason.message : "The tape didn't load.",
          }
        }
      }),
    ).then((next) => {
      if (cancel) return
      setRows(next)
      setPending(false)
    })
    return () => {
      cancel = true
    }
  }, [mark, venue, timeframe, range, symbolKey, symbols])

  const names = symbols.map((symbol) => symbol.replace(/USDT$/, "")).join(", ")

  return (
    <div className="desk-stack lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-4 px-4 py-4 pb-16">
        <div>
          <h2 className="font-mono text-xs tracking-[0.28em] text-[#c56a32] uppercase">Cross-book</h2>
          <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
            {run ? run.name : "The active rule"} across the markets below for this window. {marketLabel(venue)}.{" "}
            {venue === "spot" ? "Spot stays long only." : "Perp may short."} Add or remove markets anytime.
          </p>
          {thin ? (
            <p className="mt-2 font-mono text-[10px] text-muted-foreground/70 normal-case" role="status">
              thin sample · {closedTrades} closed {closedTrades === 1 ? "trade" : "trades"}
            </p>
          ) : null}
        </div>
        <SymbolSetEditor label="Cross markets" symbols={symbols} venue={venue} onChange={onSymbols} />
        {!run ? <p className="text-sm text-muted-foreground">Select a run on the desk first.</p> : null}
        {run && pending ? <p className="text-sm text-muted-foreground">Running {names || "the list"}.</p> : null}
        {rows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left" aria-label="Cross-book">
              <thead>
                <tr className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
                  <th className="p-2 text-left">Symbol</th>
                  <th className="p-2 text-right">Return</th>
                  <th className="p-2 text-right">Max DD</th>
                  <th className="p-2 text-right">Trades</th>
                  <th className="p-2 text-right">Expectancy</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.symbol} className="border-t border-border">
                    <th className="p-2 text-left text-sm font-medium">{row.symbol.replace(/USDT$/, "")}</th>
                    {row.error ? (
                      <td className="p-2 text-sm text-down" colSpan={4}>
                        {row.error}
                      </td>
                    ) : (
                      <>
                        <td className="p-2 text-right font-mono text-xs tabular-nums">{formatPct(row.totalReturn)}</td>
                        <td className="p-2 text-right font-mono text-xs tabular-nums">{formatPct(row.maxDrawdown)}</td>
                        <td className="p-2 text-right font-mono text-xs tabular-nums">{row.trades ?? "—"}</td>
                        <td className="p-2 text-right font-mono text-xs tabular-nums">{formatPct(row.expectancy)}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  )
}
