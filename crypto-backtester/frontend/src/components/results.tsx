import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react"
import { Eye, EyeOff } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { EquityChart, PriceChart, type OverlaySeries } from "@/components/charts"
import {
  formatFactor,
  formatMoney,
  formatPct,
  formatPlainPct,
  formatPrice,
  formatStamp,
  formatStat,
  tone,
} from "@/lib/format"
import { MARKETS, fingerprint, marketById, runColor } from "@/lib/runs"
import type { BacktestResult, Outcome, Run, SortKey, TapeCandle } from "@/lib/types"
import { cn } from "@/lib/utils"

type ResultsProps = {
  runs: Run[]
  outcomes: Record<string, Outcome>
  selected: Run
  result: BacktestResult
  candles: TapeCandle[]
  overlays: OverlaySeries[]
  sortKey: SortKey | null
  sortDir: "asc" | "desc"
  onEnlarge: () => void
  onSelect: (id: string) => void
  onToggleHidden: (id: string) => void
  onSort: (key: SortKey) => void
}

export function Results({
  runs,
  outcomes,
  selected,
  result,
  candles,
  overlays,
  sortKey,
  sortDir,
  onEnlarge,
  onSelect,
  onToggleHidden,
  onSort,
}: ResultsProps) {
  const market = MARKETS.find((symbol) => symbol.id === result.symbol)
  const metrics = result.metrics
  const split = useSplit()
  const closed = result.trades.filter((trade) => trade.status === "closed").length
  const open = result.trades.length - closed
  const rows = sortedRows(runs, outcomes, sortKey, sortDir)
  const selectedOutcome = outcomes[selected.id]
  const setupChanged = Boolean(selectedOutcome?.ok && selectedOutcome.fingerprint !== fingerprint(selected))

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="max-w-3xl font-heading text-2xl leading-tight text-balance sm:text-3xl">
          {headline(result, market?.name ?? result.symbol)}
        </h2>
        {setupChanged ? (
          <p className="mt-2 text-sm text-muted-foreground">This setup is newer than the last pass. Run it again to refresh.</p>
        ) : null}
      </div>

      <div ref={split.ref} className="flex h-[min(72vh,52rem)] min-h-[28rem] flex-col">
        <div className="min-h-[9rem]" style={{ flex: `${split.share} 1 0%` }}>
          <PriceChart candles={candles} trades={result.trades} interval={result.interval} onEnlarge={onEnlarge} />
        </div>
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize price and equity charts"
          aria-valuemin={22}
          aria-valuemax={75}
          aria-valuenow={Math.round(split.share * 100)}
          tabIndex={0}
          className="relative z-10 flex h-3 shrink-0 cursor-row-resize items-center before:absolute before:inset-x-0 before:top-1/2 before:h-px before:bg-border"
          onPointerDown={split.onPointerDown}
          onPointerMove={split.onPointerMove}
          onPointerUp={split.onPointerUp}
          onKeyDown={split.onKeyDown}
        />
        <div className="min-h-[11rem]" style={{ flex: `${1 - split.share} 1 0%` }}>
          <EquityChart result={result} overlays={overlays} selectedId={selected.id} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-4">
        <Metric label="Total return" value={formatPct(metrics.total_return_pct)} tone={tone(metrics.total_return_pct)} />
        <Metric label="Buy and hold" value={formatPct(metrics.benchmark_return_pct)} tone={tone(metrics.benchmark_return_pct)} />
        <Metric label="Excess return" value={formatPct(metrics.excess_return_pct)} tone={tone(metrics.excess_return_pct)} />
        <Metric label="Max drawdown" value={formatPct(metrics.max_drawdown_pct)} tone={tone(metrics.max_drawdown_pct)} />
        <Metric
          label="Sharpe"
          hint="Annualized return divided by volatility, scaled to this bar size. Crypto is marked on a 365-day year. Click to sort the comparison."
          value={formatStat(metrics.sharpe)}
          active={sortKey === "sharpe"}
          dir={sortDir}
          onSort={() => onSort("sharpe")}
        />
        <Metric
          label="Win rate"
          hint="Closed round trips only. Click to sort the comparison."
          value={formatPlainPct(metrics.win_rate_pct, 0)}
          active={sortKey === "win_rate_pct"}
          dir={sortDir}
          onSort={() => onSort("win_rate_pct")}
        />
        <Metric
          label="Profit factor"
          hint="Gross profit divided by gross loss. Infinite when nothing lost money. Click to sort the comparison."
          value={formatFactor(metrics.profit_factor, metrics.trades, metrics.win_rate_pct)}
          active={sortKey === "profit_factor"}
          dir={sortDir}
          onSort={() => onSort("profit_factor")}
        />
        <Metric label="Final equity" value={formatMoney(metrics.final_equity, 0)} />
      </div>

      <Comparison
        rows={rows}
        selectedId={selected.id}
        sortKey={sortKey}
        sortDir={sortDir}
        onSelect={onSelect}
        onToggleHidden={onToggleHidden}
        onSort={onSort}
      />

      <p className="font-mono text-xs text-muted-foreground">
        In the market {formatPlainPct(metrics.exposure_pct, 0)}
        {" · "}
        CAGR {formatPct(metrics.cagr_pct)}
        {" · "}
        Sortino {formatStat(metrics.sortino)}
        {" · "}
        {metrics.trades} closed {metrics.trades === 1 ? "trade" : "trades"}
        {open ? ` · ${open} still open` : ""}
      </p>

      <div>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-heading text-2xl">Trades</h3>
          <p className="font-mono text-xs text-muted-foreground uppercase">
            {closed} closed{open ? ` · ${open} open` : ""}
          </p>
        </div>
        {result.trades.length === 0 ? (
          <p className="border-t border-border py-6 text-sm text-muted-foreground">
            No round trips. The rule stayed in cash through this window.
          </p>
        ) : (
          <div className="max-h-[28rem] overflow-auto border-t border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Side</TableHead>
                  <TableHead>Entry</TableHead>
                  <TableHead>Exit</TableHead>
                  <TableHead className="text-right">Return</TableHead>
                  <TableHead className="text-right">PnL</TableHead>
                  <TableHead className="text-right">Bars</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.trades.map((trade) => (
                  <TableRow key={`${trade.entry_time}-${trade.side}-${trade.status}`}>
                    <TableCell>
                      <Badge variant={trade.side === "long" ? "default" : "secondary"}>
                        {trade.side}
                        {trade.status === "open" ? " · open" : ""}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      <div>{formatStamp(trade.entry_time, result.interval)}</div>
                      <div className="text-muted-foreground">{formatPrice(trade.entry_price)}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      <div>
                        {trade.status === "open" || !trade.exit_time
                          ? "Marked"
                          : formatStamp(trade.exit_time, result.interval)}
                      </div>
                      <div className="text-muted-foreground">
                        {trade.exit_price == null ? "—" : formatPrice(trade.exit_price)}
                      </div>
                    </TableCell>
                    <TableCell className={cn("text-right font-mono text-xs tabular-nums", toneClass(trade.return_pct))}>
                      {formatPct(trade.return_pct)}
                    </TableCell>
                    <TableCell className={cn("text-right font-mono text-xs tabular-nums", toneClass(trade.pnl))}>
                      {formatMoney(trade.pnl, 2)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">{trade.bars_held}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  )
}

function useSplit(initial = 0.42) {
  const [share, setShare] = useState(initial)
  const ref = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  function move(clientY: number) {
    const stack = ref.current
    if (!stack) return
    const rect = stack.getBoundingClientRect()
    if (rect.height <= 0) return
    setShare(Math.min(0.75, Math.max(0.22, (clientY - rect.top) / rect.height)))
  }

  return {
    share,
    ref,
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      dragging.current = true
      event.currentTarget.setPointerCapture(event.pointerId)
      move(event.clientY)
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      if (!dragging.current) return
      move(event.clientY)
    },
    onPointerUp() {
      dragging.current = false
    },
    onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
      if (event.key === "ArrowUp") setShare((value) => Math.max(0.22, value - 0.04))
      if (event.key === "ArrowDown") setShare((value) => Math.min(0.75, value + 0.04))
    },
  }
}

function Comparison({
  rows,
  selectedId,
  sortKey,
  sortDir,
  onSelect,
  onToggleHidden,
  onSort,
}: {
  rows: ComparisonRow[]
  selectedId: string
  sortKey: SortKey | null
  sortDir: "asc" | "desc"
  onSelect: (id: string) => void
  onToggleHidden: (id: string) => void
  onSort: (key: SortKey) => void
}) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-heading text-2xl">Comparison</h3>
        <p className="font-mono text-xs text-muted-foreground uppercase">Same tape, each rule</p>
      </div>
      <div className="overflow-auto border-t border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Return</TableHead>
              <TableHead className="text-right">Excess</TableHead>
              <TableHead className="text-right">Max DD</TableHead>
              <SortHead label="CAGR" sortKey="cagr_pct" active={sortKey} dir={sortDir} onSort={onSort} />
              <SortHead label="Sharpe" sortKey="sharpe" active={sortKey} dir={sortDir} onSort={onSort} />
              <SortHead label="Win rate" sortKey="win_rate_pct" active={sortKey} dir={sortDir} onSort={onSort} />
              <SortHead label="Profit factor" sortKey="profit_factor" active={sortKey} dir={sortDir} onSort={onSort} />
              <SortHead label="Trades" sortKey="trades" active={sortKey} dir={sortDir} onSort={onSort} />
              <TableHead className="w-10">
                <span className="sr-only">Chart</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.run.id}
                data-state={row.run.id === selectedId ? "selected" : undefined}
                className={cn("cursor-pointer", row.run.hidden && "opacity-60")}
                onClick={() => onSelect(row.run.id)}
              >
                <TableCell>
                  <span className="flex items-center gap-2">
                    <span className="size-2 shrink-0" style={{ backgroundColor: runColor(row.index) }} />
                    <span>
                      <span className="block">{row.run.name}</span>
                      <span className="font-mono text-[10px] text-muted-foreground uppercase">
                        {marketById(row.run.symbol)?.base ?? row.run.symbol}
                        {row.run.hidden ? " · hidden" : ""}
                      </span>
                    </span>
                  </span>
                </TableCell>
                {row.outcome?.ok ? (
                  <>
                    <TableCell className={cn("text-right font-mono text-xs tabular-nums", toneClass(row.outcome.result.metrics.total_return_pct))}>
                      {formatPct(row.outcome.result.metrics.total_return_pct)}
                    </TableCell>
                    <TableCell className={cn("text-right font-mono text-xs tabular-nums", toneClass(row.outcome.result.metrics.excess_return_pct))}>
                      {formatPct(row.outcome.result.metrics.excess_return_pct)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-down tabular-nums">
                      {formatPct(row.outcome.result.metrics.max_drawdown_pct)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {formatPct(row.outcome.result.metrics.cagr_pct)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {formatStat(row.outcome.result.metrics.sharpe)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {formatPlainPct(row.outcome.result.metrics.win_rate_pct, 0)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {formatFactor(
                        row.outcome.result.metrics.profit_factor,
                        row.outcome.result.metrics.trades,
                        row.outcome.result.metrics.win_rate_pct,
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {row.outcome.result.metrics.trades}
                    </TableCell>
                  </>
                ) : (
                  <TableCell colSpan={8} className="text-sm text-muted-foreground">
                    {row.outcome?.ok === false ? row.outcome.error : "Not run yet."}
                  </TableCell>
                )}
                <TableCell>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={row.run.hidden ? `Show ${row.run.name}` : `Hide ${row.run.name}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      onToggleHidden(row.run.id)
                    }}
                  >
                    {row.run.hidden ? <EyeOff /> : <Eye />}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function SortHead({
  label,
  sortKey,
  active,
  dir,
  onSort,
}: {
  label: string
  sortKey: SortKey
  active: SortKey | null
  dir: "asc" | "desc"
  onSort: (key: SortKey) => void
}) {
  const on = active === sortKey
  return (
    <TableHead className="text-right">
      <button type="button" className="uppercase" onClick={() => onSort(sortKey)} aria-pressed={on}>
        {label}
        {on ? (dir === "desc" ? " ↓" : " ↑") : ""}
      </button>
    </TableHead>
  )
}

type ComparisonRow = { run: Run; index: number; outcome: Outcome | undefined }

function sortedRows(runs: Run[], outcomes: Record<string, Outcome>, key: SortKey | null, dir: "asc" | "desc"): ComparisonRow[] {
  const rows = runs.map((run, index) => ({ run, index, outcome: outcomes[run.id] }))
  if (!key) return rows
  return [...rows].sort((left, right) => {
    const av = sortValue(left, key)
    const bv = sortValue(right, key)
    if (av == null && bv == null) return left.index - right.index
    if (av == null) return 1
    if (bv == null) return -1
    const delta = dir === "desc" ? bv - av : av - bv
    if (delta !== 0) return delta
    return left.index - right.index
  })
}

function sortValue(row: ComparisonRow, key: SortKey): number | null {
  if (!row.outcome?.ok) return null
  const metrics = row.outcome.result.metrics
  if (key === "profit_factor") {
    if (metrics.profit_factor != null) return metrics.profit_factor
    if (metrics.trades > 0 && metrics.win_rate_pct != null && metrics.win_rate_pct >= 99.5) return Number.POSITIVE_INFINITY
    return null
  }
  if (key === "sharpe") return metrics.sharpe
  if (key === "win_rate_pct") return metrics.win_rate_pct
  if (key === "cagr_pct") return metrics.cagr_pct
  return metrics.trades
}

function headline(result: BacktestResult, asset: string): string {
  const name = result.strategy.name
  const total = formatPct(result.metrics.total_return_pct)
  const excess = result.metrics.excess_return_pct
  if (result.strategy.id === "buy_hold") {
    return `${asset} bought and held finished ${total}.`
  }
  if (excess > 0.05) {
    return `On ${asset}, ${name} finished ${total}, ahead of buy and hold by ${formatPct(excess)}.`
  }
  if (excess < -0.05) {
    return `On ${asset}, ${name} finished ${total}, trailing buy and hold by ${formatPct(Math.abs(excess)).replace("+", "")}.`
  }
  return `On ${asset}, ${name} finished ${total}, about even with buy and hold.`
}

function Metric({
  label,
  value,
  tone: toneName = "ink",
  hint,
  active = false,
  dir = "desc",
  onSort,
}: {
  label: string
  value: string
  tone?: "up" | "down" | "ink"
  hint?: string
  active?: boolean
  dir?: "asc" | "desc"
  onSort?: () => void
}) {
  const labelNode = (
    <div className="text-[0.65rem] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
      {label}
      {active ? (dir === "desc" ? " ↓" : " ↑") : ""}
    </div>
  )
  return (
    <div className="border-t border-border pt-3">
      {onSort ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="text-left" onClick={onSort} aria-pressed={active}>
              {labelNode}
            </button>
          </TooltipTrigger>
          {hint ? <TooltipContent side="top">{hint}</TooltipContent> : null}
        </Tooltip>
      ) : hint ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="text-left">
              {labelNode}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">{hint}</TooltipContent>
        </Tooltip>
      ) : (
        labelNode
      )}
      <div
        className={cn(
          "mt-1 font-mono text-xl tabular-nums",
          toneName === "up" && "text-up",
          toneName === "down" && "text-down",
        )}
      >
        {value}
      </div>
    </div>
  )
}

function toneClass(value: number): string {
  if (value > 0.005) return "text-up"
  if (value < -0.005) return "text-down"
  return ""
}
