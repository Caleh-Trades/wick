import { memo, useState } from "react"
import { Eye, EyeOff, Trash2 } from "lucide-react"

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
import { EquityChart, type OverlaySeries } from "@/components/charts"
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
import { clampRisk, fingerprint, marketById, ruleName, runColor } from "@/lib/runs"
import type { BacktestResult, Outcome, Run, SortKey, Venue } from "@/lib/types"
import { cn } from "@/lib/utils"

const VIEWS = [
  { id: "equity", label: "Equity" },
  { id: "comparison", label: "Comparison" },
  { id: "trades", label: "Trades" },
] as const

type ResultsView = (typeof VIEWS)[number]["id"]

type ResultsProps = {
  runs: Run[]
  outcomes: Record<string, Outcome>
  selected: Run
  result: BacktestResult
  venue: Venue
  overlays: OverlaySeries[]
  sortKey: SortKey | null
  sortDir: "asc" | "desc"
  onSelect: (id: string) => void
  onToggleHidden: (id: string) => void
  onRemove: (id: string) => void
  onSort: (key: SortKey) => void
  drawToken: number
}

export const Results = memo(function Results({
  runs,
  outcomes,
  selected,
  result,
  venue,
  overlays,
  sortKey,
  sortDir,
  onSelect,
  onToggleHidden,
  onRemove,
  onSort,
  drawToken,
}: ResultsProps) {
  const market = marketById(result.symbol, venue)
  const metrics = result.metrics
  const trades = venue === "spot" ? result.trades.filter((trade) => trade.side !== "short") : result.trades
  const closed = trades.filter((trade) => trade.status === "closed").length
  const liquidated = trades.filter((trade) => trade.status === "liquidated").length
  const open = trades.filter((trade) => trade.status === "open").length
  const rows = sortedRows(runs, outcomes, sortKey, sortDir)
  const selectedOutcome = outcomes[selected.id]
  const setupChanged = Boolean(selectedOutcome?.ok && selectedOutcome.fingerprint !== fingerprint(selected))
  const [view, setView] = useState<ResultsView>("equity")

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 gap-1 overflow-x-auto xl:hidden" role="tablist" aria-label="Results">
        {VIEWS.map((item) => (
          <Button
            key={item.id}
            type="button"
            size="xs"
            variant={view === item.id ? "default" : "outline"}
            className="normal-case tracking-normal"
            role="tab"
            aria-selected={view === item.id}
            onClick={() => setView(item.id)}
          >
            {item.label}
          </Button>
        ))}
      </div>
      {setupChanged ? (
        <p className="shrink-0 text-sm text-muted-foreground">This setup is newer than the last pass. Run it again to refresh.</p>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className={cn("h-full min-h-0", view === "equity" ? "flex flex-col" : "hidden xl:flex xl:flex-col")}>
          <div className="min-h-0 flex-1">
            <EquityChart result={result} overlays={overlays} selectedId={selected.id} drawToken={drawToken} />
          </div>
        </div>

        <div className={cn("h-full min-h-0", view === "comparison" ? "block" : "hidden xl:block")}>
          <Comparison
            rows={rows}
            venue={venue}
            selectedId={selected.id}
            sortKey={sortKey}
            sortDir={sortDir}
            onSelect={onSelect}
            onToggleHidden={onToggleHidden}
            onRemove={onRemove}
            onSort={onSort}
          />
        </div>

        <div className={cn("bezel h-full min-h-0 flex-col overflow-hidden p-4", view === "trades" ? "flex" : "hidden xl:flex")}>
        <p className="mb-3 shrink-0 font-mono text-xs text-muted-foreground uppercase">
          {venue === "perp" ? "Binance perp" : "Binance spot"}
          {" · "}
          {closed} closed{liquidated ? ` · ${liquidated} liquidated` : ""}{open ? ` · ${open} open` : ""}
        </p>
        {trades.length === 0 ? (
          <p className="border-t border-border py-6 text-sm text-muted-foreground">
            No round trips. The rule stayed in cash through this window.
          </p>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto border-t border-border">
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
                {trades.map((trade) => (
                  <TableRow key={`${trade.entry_time}-${trade.side}-${trade.status}`}>
                    <TableCell>
                      <Badge variant={trade.side === "long" ? "default" : "secondary"}>
                        {trade.side === "short" ? "Short" : "Long"}
                        {trade.status === "open" ? " · open" : trade.status === "liquidated" ? " · liquidated" : ""}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      <div>{formatStamp(trade.entry_time, result.interval)}</div>
                      <div className="text-muted-foreground">{formatPrice(trade.entry_price, market?.tickSize)}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      <div>
                        {trade.status === "open" || !trade.exit_time
                          ? "Marked"
                          : formatStamp(trade.exit_time, result.interval)}
                      </div>
                      <div className="text-muted-foreground">
                        {trade.exit_price == null ? "—" : formatPrice(trade.exit_price, market?.tickSize)}
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

      <div className={cn("shrink-0", view === "equity" ? "block" : "hidden xl:block")}>
        <div className="bezel grid grid-cols-2 gap-x-6 gap-y-5 p-4 md:grid-cols-4 xl:grid-cols-8">
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
            hint="Exits and liquidations. Click to sort the comparison."
            value={formatPlainPct(metrics.win_rate_pct, 0)}
            active={sortKey === "win_rate_pct"}
            dir={sortDir}
            onSort={() => onSort("win_rate_pct")}
          />
          <Metric
            label="Profit factor"
            hint="Gross profit divided by gross loss. Infinite when nothing lost money. Click to sort the comparison."
            value={formatFactor(metrics.profit_factor, metrics.trades + metrics.liquidations, metrics.win_rate_pct)}
            active={sortKey === "profit_factor"}
            dir={sortDir}
            onSort={() => onSort("profit_factor")}
          />
          <Metric label="Final equity" value={formatMoney(metrics.final_equity, 0)} />
        </div>
        <p className="mt-2 font-mono text-xs text-muted-foreground">
          In the market {formatPlainPct(metrics.exposure_pct, 0)}
          {" · "}
          CAGR {formatPct(metrics.cagr_pct)}
          {" · "}
          Sortino {formatStat(metrics.sortino)}
          {" · "}
          {metrics.trades} closed {metrics.trades === 1 ? "trade" : "trades"}
          {liquidated ? ` · ${liquidated} liquidated` : ""}
          {open ? ` · ${open} still open` : ""}
          {result.assumptions.venue === "perp" ? ` · ${result.assumptions.leverage}×` : ""}
          {" · "}
          Risk {riskLabel(result.assumptions.risk_pct)}
          {result.assumptions.funding_stale ? " · Funding stale" : ""}
        </p>
      </div>
    </div>
  )
})

function Comparison({
  rows,
  venue,
  selectedId,
  sortKey,
  sortDir,
  onSelect,
  onToggleHidden,
  onRemove,
  onSort,
}: {
  rows: ComparisonRow[]
  venue: Venue
  selectedId: string
  sortKey: SortKey | null
  sortDir: "asc" | "desc"
  onSelect: (id: string) => void
  onToggleHidden: (id: string) => void
  onRemove: (id: string) => void
  onSort: (key: SortKey) => void
}) {
  return (
    <div className="bezel flex h-full min-h-0 flex-col p-4">
      <p className="mb-3 shrink-0 font-mono text-xs text-muted-foreground uppercase">Same tape, each rule</p>
      <div className="min-h-0 flex-1 overflow-auto border-t border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Rule</TableHead>
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
                        {marketById(row.run.symbol, venue)?.base ?? row.run.symbol}
                        {` · ${riskLabel(row.run.riskPct)} risk`}
                        {row.run.hidden ? " · hidden" : ""}
                      </span>
                    </span>
                  </span>
                </TableCell>
                <TableCell className="text-xs">{ruleName(row.run.rule)}</TableCell>
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
                  <div className="flex items-center justify-end gap-1">
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
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Remove ${row.run.name}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        onRemove(row.run.id)
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </div>
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

function riskLabel(value: number): string {
  const risk = clampRisk(value)
  const digits = Math.abs(risk - Math.round(risk)) < 0.05 ? 0 : 1
  return formatPlainPct(risk, digits)
}

function toneClass(value: number): string {
  if (value > 0.005) return "text-up"
  if (value < -0.005) return "text-down"
  return ""
}
