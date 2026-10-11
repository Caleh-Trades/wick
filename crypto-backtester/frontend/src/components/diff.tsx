import { useEffect, useState } from "react"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ruleDiff, type DiffSide } from "@/lib/diff"
import { listRuns, watchBook, type KeptListRow } from "@/lib/records"

export function DiffPage() {
  const [kept, setKept] = useState<KeptListRow[]>([])
  const [leftId, setLeftId] = useState<string>("")
  const [rightId, setRightId] = useState<string>("")

  useEffect(() => {
    let cancel = false
    const load = () => {
      void listRuns().then((rows) => {
        if (cancel) return
        setKept(rows)
        setLeftId((current) => (rows.some((row) => row.run.id === current) ? current : (rows[0]?.run.id ?? "")))
        setRightId((current) => (rows.some((row) => row.run.id === current) ? current : (rows[1]?.run.id ?? rows[0]?.run.id ?? "")))
      })
    }
    load()
    const stop = watchBook(load)
    return () => {
      cancel = true
      stop()
    }
  }, [])

  const left = kept.find((row) => row.run.id === leftId) ?? null
  const right = kept.find((row) => row.run.id === rightId) ?? null
  const lines = left && right && left.run.id !== right.run.id ? ruleDiff(sideOf(left), sideOf(right)) : []

  return (
    <div className="desk-stack lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-4 px-4 py-4 pb-16">
        <div>
          <h2 className="font-mono text-xs tracking-[0.28em] text-[#c56a32] uppercase">Rule diff</h2>
          <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
            Two kept runs. Only the params, return, drawdown, win rate, and trade count that differ are listed.
          </p>
        </div>
        {kept.length < 2 ? (
          <p className="text-sm text-muted-foreground">Keep two runs from the desk, then pick them here.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-3">
              <RunPick label="Left" rows={kept} value={leftId} onChange={setLeftId} />
              <RunPick label="Right" rows={kept} value={rightId} onChange={setRightId} />
            </div>
            {left && right && left.run.id === right.run.id ? (
              <p className="text-sm text-muted-foreground">Pick two different runs.</p>
            ) : lines.length === 0 ? (
              <p className="text-sm text-muted-foreground">These runs match on params, return, drawdown, win rate, and trade count.</p>
            ) : (
              <ul className="flex flex-col" aria-label="Differing fields">
                {lines.map((line) => (
                  <li key={line.field} className="grid grid-cols-[8rem_1fr_1fr] gap-3 border-b border-border py-2">
                    <span className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">{line.field}</span>
                    <span className="font-mono text-xs tabular-nums">{line.left}</span>
                    <span className="font-mono text-xs tabular-nums">{line.right}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function sideOf(row: KeptListRow): DiffSide {
  return {
    rule: row.strategy.rule,
    params: row.strategy.params,
    totalReturn: row.run.metrics.total_return_pct,
    maxDrawdown: row.run.metrics.max_drawdown_pct,
    winRate: row.run.metrics.win_rate_pct,
    trades: row.run.metrics.trades,
  }
}

function RunPick({
  label,
  rows,
  value,
  onChange,
}: {
  label: string
  rows: KeptListRow[]
  value: string
  onChange: (id: string) => void
}) {
  return (
    <label className="flex min-w-52 flex-col gap-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
      {label}
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full normal-case">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {rows.map((row) => (
            <SelectItem key={row.run.id} value={row.run.id}>
              {row.strategy.name} · {row.strategy.symbol.replace(/USDT$/, "")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}
