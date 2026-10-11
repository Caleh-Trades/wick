import { Trash2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatMoney, formatPct } from "@/lib/format"
import {
  exportRunFile,
  listRuns,
  PAGE_SIZE,
  removeRun,
  setRunNote,
  watchBook,
  type KeptListRow,
} from "@/lib/records"
import { cn } from "@/lib/utils"

function moneyTone(value: number): "up" | "down" | "flat" {
  if (value > 0) return "up"
  if (value < 0) return "down"
  return "flat"
}

export function SavedPage({ onRestore }: { onRestore: (ids: { strategyId: string; runId: string }) => void }) {
  const [kept, setKept] = useState<KeptListRow[]>([])
  const [symbol, setSymbol] = useState("")
  const [strategy, setStrategy] = useState("")
  const [page, setPage] = useState(0)

  useEffect(() => {
    let cancel = false
    const load = () => {
      void listRuns().then((rows) => {
        if (!cancel) setKept(rows)
      })
    }
    load()
    const stop = watchBook(load)
    return () => {
      cancel = true
      stop()
    }
  }, [])

  const matched = useMemo(() => {
    const symbolNeedle = symbol.trim().toLowerCase()
    const strategyNeedle = strategy.trim().toLowerCase()
    return kept.filter((row) => {
      if (symbolNeedle && !row.strategy.symbol.toLowerCase().includes(symbolNeedle) && !row.strategy.symbol.replace(/USDT$/, "").toLowerCase().includes(symbolNeedle)) {
        return false
      }
      if (strategyNeedle && !row.strategy.name.toLowerCase().includes(strategyNeedle) && !row.strategy.rule.toLowerCase().includes(strategyNeedle)) {
        return false
      }
      return true
    })
  }, [kept, strategy, symbol])

  const lastPage = Math.max(0, Math.ceil(matched.length / PAGE_SIZE) - 1)
  const pageIndex = Math.min(page, lastPage)
  const rows = matched.slice(pageIndex * PAGE_SIZE, pageIndex * PAGE_SIZE + PAGE_SIZE)
  const fromRow = matched.length === 0 ? 0 : pageIndex * PAGE_SIZE + 1
  const toRow = Math.min(matched.length, (pageIndex + 1) * PAGE_SIZE)

  return (
    <div className="desk-stack lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-4 px-4 py-4 pb-16">
        <div>
          <h2 className="font-mono text-xs tracking-[0.28em] text-[#c56a32] uppercase">Saved</h2>
          <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
            Kept runs. Opening a row restores the slot from the strategy and the run. Candle history is not stored here. This list will move to an account later.
          </p>
        </div>
        <form className="bezel grid grid-cols-2 gap-3 p-3 lg:grid-cols-4" aria-label="Saved filters" onSubmit={(event) => event.preventDefault()}>
          <div className="flex flex-col gap-1">
            <Label htmlFor="saved-symbol">Symbol</Label>
            <Input
              id="saved-symbol"
              value={symbol}
              maxLength={20}
              onChange={(event) => {
                setSymbol(event.target.value)
                setPage(0)
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="saved-strategy">Strategy</Label>
            <Input
              id="saved-strategy"
              value={strategy}
              maxLength={48}
              onChange={(event) => {
                setStrategy(event.target.value)
                setPage(0)
              }}
            />
          </div>
          <div className="col-span-2 flex items-end justify-between gap-2 lg:col-span-2">
            <p className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
              {matched.length === 0 ? "0 runs" : `${fromRow}–${toRow} of ${matched.length}`}
            </p>
            <div className="flex gap-1">
              <Button type="button" size="xs" variant="outline" className="normal-case tracking-normal" disabled={pageIndex <= 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>
                Prev
              </Button>
              <Button type="button" size="xs" variant="outline" className="normal-case tracking-normal" disabled={pageIndex >= lastPage} onClick={() => setPage((current) => Math.min(lastPage, current + 1))}>
                Next
              </Button>
            </div>
          </div>
        </form>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keep a run from the desk. It lands here, not in Working.</p>
        ) : (
          <ul className="flex flex-col gap-2" aria-label="Saved runs">
            {rows.map((row) => (
              <SavedRow key={row.run.id} row={row} onRestore={onRestore} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function SavedRow({ row, onRestore }: { row: KeptListRow; onRestore: (ids: { strategyId: string; runId: string }) => void }) {
  const base = row.strategy.symbol.replace(/USDT$/, "")
  const ids = { strategyId: row.strategy.id, runId: row.run.id }
  const keptAt = row.run.createdAt.slice(0, 10)
  return (
    <li className="bezel flex items-start justify-between gap-3 px-3 py-2">
      <div className="min-w-0">
        <button type="button" className="flex max-w-full flex-wrap items-baseline gap-x-2 gap-y-1 text-left" onClick={() => onRestore(ids)}>
          <span className="text-sm">{row.strategy.name}</span>
          <span className="text-sm text-muted-foreground">{base}</span>
          <span className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">{row.strategy.market === "perp" ? "Perp" : "Spot"}</span>
          <span className={cn("font-mono text-xs tabular-nums", moneyTone(row.run.metrics.total_return_pct) === "up" && "text-up", moneyTone(row.run.metrics.total_return_pct) === "down" && "text-down")}>
            {formatPct(row.run.metrics.total_return_pct)}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">{keptAt}</span>
        </button>
        {row.run.costs ? (
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            Before fees {formatPct(row.run.costs.beforeFees)}
            {" · "}
            Fees {formatMoney(row.run.costs.fees, 2)}
            {" · "}
            After costs {formatPct(row.run.costs.afterCosts)}
          </p>
        ) : null}
        <label className="mt-2 block">
          <span className="sr-only">Note for {row.strategy.name}</span>
          <Input
            aria-label={`Note for ${row.strategy.name}`}
            value={row.run.note}
            maxLength={280}
            placeholder="Note on this run"
            className="h-8 text-xs"
            onChange={(event) => void setRunNote(row.run.id, event.target.value)}
          />
        </label>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button type="button" size="xs" variant="outline" className="normal-case tracking-normal" onClick={() => void exportRunFile(row.run.id)}>
          Export
        </Button>
        <Button type="button" size="xs" variant="outline" className="normal-case tracking-normal" onClick={() => onRestore(ids)}>
          Open
        </Button>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove saved ${row.strategy.name}`} onClick={() => void removeRun(row.run.id)}>
          <Trash2 />
        </Button>
      </div>
    </li>
  )
}
