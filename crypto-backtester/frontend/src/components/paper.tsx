import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { formatMoney, formatPct, formatStamp } from "@/lib/format"
import { paperReturnPct } from "@/lib/paper"
import { listRuns, setRunPaper, tradesForRun, watchBook, type KeptListRow, type TradeRecord } from "@/lib/records"
import type { Venue } from "@/lib/types"
import { cn } from "@/lib/utils"

export function PaperPage({ sinceFor }: { sinceFor: (symbol: string, venue: Venue, timeframe: string) => string }) {
  const [kept, setKept] = useState<KeptListRow[]>([])
  const [trades, setTrades] = useState<TradeRecord[]>([])

  useEffect(() => {
    let cancel = false
    const load = () => {
      void listRuns().then(async (rows) => {
        if (cancel) return
        setKept(rows)
        const lists = await Promise.all(rows.filter((row) => row.run.paper).map((row) => tradesForRun(row.run.id)))
        if (cancel) return
        setTrades(lists.flat().filter((trade) => trade.source === "paper").sort((left, right) => right.entryTime.localeCompare(left.entryTime)))
      })
    }
    load()
    const stop = watchBook(load)
    return () => {
      cancel = true
      stop()
    }
  }, [])

  return (
    <div className="desk-stack lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-4 px-4 py-4 pb-16">
        <div>
          <h2 className="font-mono text-xs tracking-[0.28em] text-[#c56a32] uppercase">Paper</h2>
          <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
            A kept run set to Paper is scored on each new closed candle. These fills stay on this page. They are not journal rows.
          </p>
        </div>
        {kept.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keep a run from the desk, then set it to Paper.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {kept.map((row) => {
              const fills = trades.filter((trade) => trade.runId === row.run.id)
              const paper = paperReturnPct(fills, row.strategy.capital)
              return (
                <li key={row.run.id} className="bezel flex flex-wrap items-baseline justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm">
                      {row.strategy.name}
                      <span className="ml-2 text-muted-foreground">{row.strategy.symbol.replace(/USDT$/, "")}</span>
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                      Backtest {formatPct(row.run.metrics.total_return_pct)}
                      {" · "}
                      Paper {row.run.paper ? formatPct(paper) : "—"}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="xs"
                    variant={row.run.paper ? "default" : "outline"}
                    className="normal-case tracking-normal"
                    aria-pressed={row.run.paper}
                    onClick={() => void setRunPaper(row.run.id, !row.run.paper, sinceFor(row.strategy.symbol, row.strategy.market, row.strategy.timeframe))}
                  >
                    {row.run.paper ? "Paper on" : "Paper"}
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
        <section aria-label="Paper trades">
          <p className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">Paper trades</p>
          {trades.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No paper fills yet. The next closed candle after you turn Paper on is the first one scored.</p>
          ) : (
            <ul className="mt-2 flex flex-col">
              {trades.map((trade) => (
                <li key={trade.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border py-2">
                  <span className="font-mono text-[11px] text-muted-foreground">{formatStamp(trade.entryTime, "1m")}</span>
                  <span className="text-sm">{trade.symbol.replace(/USDT$/, "")}</span>
                  <span className="text-sm">{trade.side === "short" ? "Short" : "Long"}</span>
                  <span className={cn("font-mono text-xs tabular-nums", (trade.returnPct ?? 0) > 0 ? "text-up" : (trade.returnPct ?? 0) < 0 ? "text-down" : "")}>
                    {formatPct(trade.returnPct)}
                  </span>
                  <span className={cn("font-mono text-xs tabular-nums", (trade.pnl ?? 0) > 0 ? "text-up" : (trade.pnl ?? 0) < 0 ? "text-down" : "")}>
                    P&L {trade.pnl == null ? "—" : formatMoney(trade.pnl, 2)}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">Fee {formatMoney(trade.fee, 2)}</span>
                  <span className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">paper</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
