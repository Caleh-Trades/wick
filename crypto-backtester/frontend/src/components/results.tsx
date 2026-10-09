import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { EquityChart, PriceChart } from "@/components/charts"
import {
  formatDay,
  formatFactor,
  formatMoney,
  formatPct,
  formatPlainPct,
  formatPrice,
  formatStamp,
  formatStat,
  sourceLabel,
  tone,
} from "@/lib/format"
import type { BacktestResult, Meta } from "@/lib/types"
import { cn } from "@/lib/utils"

export function Results({ result, meta }: { result: BacktestResult; meta: Meta }) {
  const market = meta.symbols.find((symbol) => symbol.id === result.symbol)
  const interval = meta.intervals.find((item) => item.id === result.interval)
  const metrics = result.metrics
  const closed = result.trades.filter((trade) => trade.status === "closed").length
  const open = result.trades.length - closed

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="max-w-3xl font-heading text-3xl leading-tight text-balance sm:text-4xl">
          {headline(result, market?.name ?? result.symbol)}
        </h2>
        <p className="mt-3 font-mono text-xs tracking-wide text-muted-foreground uppercase">
          {result.window.bars.toLocaleString("en-US")} {interval?.label.toLowerCase() ?? result.interval} bars
          {" · "}
          {formatDay(result.window.start)} – {formatDay(result.window.end)}
          {" · "}
          {sourceLabel(result.source)}
        </p>
      </div>

      <EquityChart result={result} />

      <div className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-4">
        <Metric label="Total return" value={formatPct(metrics.total_return_pct)} tone={tone(metrics.total_return_pct)} />
        <Metric label="Buy and hold" value={formatPct(metrics.benchmark_return_pct)} tone={tone(metrics.benchmark_return_pct)} />
        <Metric label="Excess return" value={formatPct(metrics.excess_return_pct)} tone={tone(metrics.excess_return_pct)} />
        <Metric label="Max drawdown" value={formatPct(metrics.max_drawdown_pct)} tone={tone(metrics.max_drawdown_pct)} />
        <Metric
          label="Sharpe"
          hint="Annualized return divided by volatility. Crypto is marked on a 365-day year."
          value={formatStat(metrics.sharpe)}
        />
        <Metric label="Win rate" hint="Closed round trips only." value={formatPlainPct(metrics.win_rate_pct, 0)} />
        <Metric
          label="Profit factor"
          hint="Gross profit divided by gross loss. Infinite when nothing lost money."
          value={formatFactor(metrics.profit_factor, metrics.trades, metrics.win_rate_pct)}
        />
        <Metric label="Final equity" value={formatMoney(metrics.final_equity, 0)} />
      </div>

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

      <PriceChart result={result} />

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
}: {
  label: string
  value: string
  tone?: "up" | "down" | "ink"
  hint?: string
}) {
  const labelNode = (
    <div className="text-[0.65rem] font-semibold tracking-[0.16em] text-muted-foreground uppercase">{label}</div>
  )
  return (
    <div className="border-t border-border pt-3">
      {hint ? (
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
