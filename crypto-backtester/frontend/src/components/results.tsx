import { memo, useState } from "react"
import { Eye, EyeOff, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { holdoutWarn } from "@/lib/backtest"
import { clampRisk, fingerprint, marketById, runColor, strategyLabel } from "@/lib/runs"
import type { BacktestResult, Outcome, Run, SampleSlice, SortKey, Trade, Venue } from "@/lib/types"
import { cn } from "@/lib/utils"

const VIEWS = [
  { id: "equity", label: "Equity" },
  { id: "comparison", label: "Comparison" },
  { id: "trades", label: "Trades" },
] as const

type ResultsView = (typeof VIEWS)[number]["id"]
type SampleLens = "full" | "in_sample" | "holdout"

const LENSES: { id: SampleLens; label: string }[] = [
  { id: "full", label: "Full" },
  { id: "in_sample", label: "In-sample" },
  { id: "holdout", label: "Holdout" },
]

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
  onFocusTrade: (trade: Trade) => void
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
  onFocusTrade,
  drawToken,
}: ResultsProps) {
  const market = marketById(result.symbol, venue)
  const trades = venue === "spot" ? result.trades.filter((trade) => trade.side !== "short") : result.trades
  const closed = trades.filter((trade) => trade.status === "closed").length
  const liquidated = trades.filter((trade) => trade.status === "liquidated").length
  const open = trades.filter((trade) => trade.status === "open").length
  const rows = sortedRows(runs, outcomes, sortKey, sortDir)
  const selectedOutcome = outcomes[selected.id]
  const setupChanged = Boolean(selectedOutcome?.ok && selectedOutcome.fingerprint !== fingerprint(selected))
  const [view, setView] = useState<ResultsView>("equity")
  const [lens, setLens] = useState<SampleLens>("full")

  return (
    <div className="results-stack flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 gap-1 overflow-x-auto lg:hidden" role="tablist" aria-label="Results">
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

      <div className="results-grid grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-3">
        <div className={cn("results-equity equity-strip min-w-0 max-lg:h-full max-lg:min-h-[220px] lg:h-[248px] lg:min-h-[248px] lg:shrink-0", view === "equity" ? "flex flex-col" : "hidden lg:flex lg:flex-col")}>
          <div className="equity-frame min-h-0 flex-1">
            <EquityChart result={result} overlays={overlays} selectedId={selected.id} drawToken={drawToken} />
          </div>
        </div>

        <div className={cn("results-comparison h-full min-h-[180px] min-w-0", view === "comparison" ? "block" : "hidden lg:block")}>
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
            lens={lens}
            onLens={setLens}
          />
        </div>

        <div className={cn("results-trades bezel h-full min-h-[180px] min-w-0 flex-col overflow-hidden p-3", view === "trades" ? "flex" : "hidden lg:flex")}>
        <p className="mb-3 shrink-0 font-mono text-xs text-muted-foreground uppercase">
          {venue === "perp" ? "Kraken perp" : "Binance spot"}
          {" · "}
          {closed} closed{liquidated ? ` · ${liquidated} liquidated` : ""}{open ? ` · ${open} open` : ""}
        </p>
        {trades.length === 0 ? (
          <p className="border-t border-border py-6 text-sm text-muted-foreground">
            No round trips. The rule stayed in cash through this window.
          </p>
        ) : (
          <ul className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto border-t border-border">
            {trades.map((trade) => (
              <li key={`${trade.entry_time}-${trade.side}-${trade.status}`} className="border-b border-border">
                <button type="button" className="w-full py-2 text-left" onClick={() => onFocusTrade(trade)}>
                <div className="flex items-baseline justify-between gap-2">
                  <Badge variant={trade.side === "long" ? "default" : "secondary"}>
                    {trade.side === "short" ? "Short" : "Long"}
                    {trade.status === "open" ? " · open" : trade.status === "liquidated" ? " · liq" : ""}
                  </Badge>
                  <span className={cn("shrink-0 font-mono text-xs tabular-nums", toneClass(trade.return_pct))}>{formatPct(trade.return_pct)}</span>
                </div>
                <p className="mt-1 font-mono text-[11px] leading-relaxed break-words text-muted-foreground">
                  {formatStamp(trade.entry_time, result.interval)} {formatPrice(trade.entry_price, market?.tickSize)}
                </p>
                <p className="font-mono text-[11px] leading-relaxed break-words text-muted-foreground">
                  → {trade.status === "open" || !trade.exit_time ? "Marked" : formatStamp(trade.exit_time, result.interval)}{" "}
                  {trade.exit_price == null ? "—" : formatPrice(trade.exit_price, market?.tickSize)}
                </p>
                <p className="mt-0.5 flex justify-between gap-2 font-mono text-[11px] tabular-nums">
                  <span className={toneClass(trade.pnl)}>{formatMoney(trade.pnl, 2)}</span>
                  <span className="text-muted-foreground">{trade.bars_held} bars</span>
                </p>
                </button>
              </li>
            ))}
          </ul>
        )}
        </div>
      </div>
    </div>
  )
})

export function RunStrip({
  result,
  sortKey,
  sortDir,
  onSort,
  onKeep,
}: {
  result: BacktestResult
  sortKey: SortKey | null
  sortDir: "asc" | "desc"
  onSort: (key: SortKey) => void
  onKeep: () => void
}) {
  const metrics = result.metrics
  const trades = result.assumptions.venue === "spot" ? result.trades.filter((trade) => trade.side !== "short") : result.trades
  const liquidated = trades.filter((trade) => trade.status === "liquidated").length
  const open = trades.filter((trade) => trade.status === "open").length
  return (
    <div className="shrink-0 px-3 pt-2">
      <div className="bezel flex flex-nowrap items-end gap-x-4 overflow-x-auto px-3 py-1.5" aria-label="Run summary">
        <Metric label="Total return" value={formatPct(metrics.total_return_pct)} tone={tone(metrics.total_return_pct)} dense />
        <Metric label="Buy and hold" value={formatPct(metrics.benchmark_return_pct)} tone={tone(metrics.benchmark_return_pct)} dense />
        <Metric label="Excess return" value={formatPct(metrics.excess_return_pct)} tone={tone(metrics.excess_return_pct)} dense />
        <Metric label="Max drawdown" value={formatPct(metrics.max_drawdown_pct)} tone={tone(metrics.max_drawdown_pct)} dense />
        <Metric
          label="Sharpe"
          hint="Annualized return divided by volatility, scaled to this bar size. Crypto is marked on a 365-day year. Click to sort the comparison."
          value={formatStat(metrics.sharpe)}
          active={sortKey === "sharpe"}
          dir={sortDir}
          onSort={() => onSort("sharpe")}
          dense
        />
        <Metric
          label="Win rate"
          hint="Exits and liquidations. Click to sort the comparison."
          value={formatPlainPct(metrics.win_rate_pct, 0)}
          active={sortKey === "win_rate_pct"}
          dir={sortDir}
          onSort={() => onSort("win_rate_pct")}
          dense
        />
        <Metric
          label="Profit factor"
          hint="Gross wins divided by gross losses, including the open trade. An em dash when nothing lost money. Click to sort the comparison."
          value={formatFactor(metrics.profit_factor)}
          active={sortKey === "profit_factor"}
          dir={sortDir}
          onSort={() => onSort("profit_factor")}
          dense
        />
        <Metric
          label="Expectancy"
          hint="Average win times win rate, minus average loss times loss rate."
          value={formatPct(metrics.expectancy)}
          tone={tone(metrics.expectancy)}
          dense
        />
        <Metric label="Recovery" hint="Bars from the worst-drawdown peak until equity reclaims it." value={recoveryLabel(metrics.recovery_bars)} dense />
        <Metric label="Final equity" value={formatMoney(metrics.final_equity, 0)} dense />
        {result.assumptions.venue === "perp" ? (
          <Metric
            label="Funding paid"
            value={formatMoney(result.trades.reduce((sum, trade) => sum + trade.funding_paid, 0), 2)}
            dense
          />
        ) : null}
      </div>
      <div className="mt-1 flex items-center gap-3">
        <p className="min-w-0 flex-1 truncate font-mono text-[10px] whitespace-nowrap text-muted-foreground">
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
          {" · "}
          In-sample {sliceText(result.in_sample)}
          {" · "}
          Holdout {sliceText(result.holdout)}
          {(result.walk_forward ?? []).length > 0 ? " · " : ""}
          {(result.walk_forward ?? []).map((slice, index) => (
            <span key={index}>
              {index > 0 ? " · " : ""}
              Window {index + 1} {sliceText(slice)}
            </span>
          ))}
        </p>
        <Button type="button" size="xs" variant="outline" className="shrink-0 normal-case tracking-normal" onClick={onKeep}>
          Keep this run
        </Button>
      </div>
      {holdoutWarn(result.metrics, result.holdout) ? (
        <p className="mt-1 text-xs text-down">Holdout Sharpe is negative while the full sample is positive.</p>
      ) : null}
    </div>
  )
}

function recoveryLabel(bars: number | null | undefined): string {
  if (bars == null) return "Not recovered"
  return bars === 1 ? "1 bar" : `${bars} bars`
}

function sliceText(slice: SampleSlice | undefined): string {
  if (!slice) return "—"
  return `${formatPct(slice.total_return_pct)} · DD ${formatPct(slice.max_drawdown_pct)} · ${formatStat(slice.sharpe)} · ${slice.trades}`
}

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
  lens,
  onLens,
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
  lens: SampleLens
  onLens: (lens: SampleLens) => void
}) {
  const sliced = lens !== "full"
  return (
    <div className="bezel flex h-full min-h-0 min-w-0 flex-col overflow-hidden p-3">
      <div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-xs text-muted-foreground uppercase">Same tape, each rule</p>
        <div className="flex gap-1" role="group" aria-label="Sample window">
          {LENSES.map((item) => (
            <Button
              key={item.id}
              type="button"
              size="xs"
              variant={lens === item.id ? "default" : "outline"}
              className="normal-case tracking-normal"
              aria-pressed={lens === item.id}
              onClick={() => onLens(item.id)}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </div>
      <div className="mb-2 flex shrink-0 flex-wrap gap-x-2 gap-y-1">
        <SortText label="CAGR" sortKey="cagr_pct" active={sortKey} dir={sortDir} onSort={onSort} />
        <SortText label="Sharpe" sortKey="sharpe" active={sortKey} dir={sortDir} onSort={onSort} />
        <SortText label="Win" sortKey="win_rate_pct" active={sortKey} dir={sortDir} onSort={onSort} />
        <SortText label="PF" sortKey="profit_factor" active={sortKey} dir={sortDir} onSort={onSort} />
        <SortText label="Trades" sortKey="trades" active={sortKey} dir={sortDir} onSort={onSort} />
      </div>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto border-t border-border">
        <table className="w-full table-fixed border-collapse text-left">
          <caption className="sr-only">Runs on this tape</caption>
          <thead className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
            <tr className="border-b border-border">
              <th className="w-[34%] py-1 pr-2 font-medium">Run</th>
              <th className="py-1 pr-2 text-right font-medium">Return</th>
              {sliced ? <th className="py-1 pr-2 text-right font-medium">DD</th> : null}
              <th className="py-1 pr-2 text-right font-medium">Sharpe</th>
              {sliced ? null : <th className="py-1 pr-2 text-right font-medium">Win</th>}
              {sliced ? null : <th className="w-12 py-1 pr-2 text-right font-medium">PF</th>}
              <th className="w-12 py-1 text-right font-medium">Trades</th>
              <th className="w-14 py-1 font-medium"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const fitted = row.outcome?.ok && row.outcome.result.assumptions.venue === venue ? row.outcome.result : null
              const metrics = fitted?.metrics ?? null
              const slice = fitted ? sliceOf(fitted, lens) : null
              const returned = sliced ? slice?.total_return_pct : metrics?.total_return_pct
              const sharpe = sliced ? slice?.sharpe : metrics?.sharpe
              const trades = sliced ? slice?.trades : metrics?.trades
              const base = marketById(row.run.symbol, venue)?.base ?? row.run.symbol
              return (
                <tr key={row.run.id} className={cn("border-b border-border align-top", row.run.hidden && "opacity-60")}>
                  <td className="py-2 pr-2">
                    <button type="button" className="flex w-full items-start gap-2 text-left" onClick={() => onSelect(row.run.id)}>
                      <span className="mt-1 size-2 shrink-0" style={{ backgroundColor: runColor(row.index) }} />
                      <span className="min-w-0">
                        <span className={cn("block truncate text-sm", row.run.id === selectedId && "text-[#c56a32]")}>{row.run.name}</span>
                        <span className="block font-mono text-[10px] leading-relaxed break-words text-muted-foreground uppercase">
                          {base} · {strategyLabel(row.run)}
                          {row.run.hidden ? " · hidden" : ""}
                        </span>
                      </span>
                    </button>
                  </td>
                  <td className={cn("py-2 pr-2 text-right font-mono text-[11px] tabular-nums", returned == null ? "text-muted-foreground" : toneClass(returned))}>
                    {returned == null ? "—" : formatPct(returned)}
                  </td>
                  {sliced ? (
                    <td className={cn("py-2 pr-2 text-right font-mono text-[11px] tabular-nums", slice ? toneClass(slice.max_drawdown_pct) : "text-muted-foreground")}>
                      {slice ? formatPct(slice.max_drawdown_pct) : "—"}
                    </td>
                  ) : null}
                  <td className="py-2 pr-2 text-right font-mono text-[11px] tabular-nums">{fitted ? formatStat(sharpe) : "—"}</td>
                  {sliced ? null : (
                    <td className="py-2 pr-2 text-right font-mono text-[11px] tabular-nums">{metrics ? formatPlainPct(metrics.win_rate_pct, 0) : "—"}</td>
                  )}
                  {sliced ? null : (
                    <td className="py-2 pr-2 text-right font-mono text-[11px] tabular-nums">{metrics ? formatFactor(metrics.profit_factor) : "—"}</td>
                  )}
                  <td className="py-2 text-right font-mono text-[11px] tabular-nums">{trades == null ? "—" : trades}</td>
                  <td className="py-1 text-right">
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={row.run.hidden ? `Show ${row.run.name}` : `Hide ${row.run.name}`}
                        onClick={() => onToggleHidden(row.run.id)}
                      >
                        {row.run.hidden ? <EyeOff /> : <Eye />}
                      </Button>
                      <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove ${row.run.name}`} onClick={() => onRemove(row.run.id)}>
                        <Trash2 />
                      </Button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function sliceOf(result: BacktestResult, lens: SampleLens): SampleSlice | null {
  if (lens === "full") return null
  return (lens === "in_sample" ? result.in_sample : result.holdout) ?? null
}

function SortText({
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
    <button type="button" className="font-mono text-[10px] uppercase" onClick={() => onSort(sortKey)} aria-pressed={on}>
      {label}
      {on ? (dir === "desc" ? " ↓" : " ↑") : ""}
    </button>
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
  dense = false,
}: {
  label: string
  value: string
  tone?: "up" | "down" | "ink"
  hint?: string
  active?: boolean
  dir?: "asc" | "desc"
  onSort?: () => void
  dense?: boolean
}) {
  const labelNode = (
    <div className="text-[0.6rem] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
      {label}
      {active ? (dir === "desc" ? " ↓" : " ↑") : ""}
    </div>
  )
  return (
    <div className={dense ? "shrink-0 py-0.5" : "border-t border-border pt-3"}>
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
          "font-mono tabular-nums",
          dense ? "text-sm" : "mt-1 text-xl",
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
