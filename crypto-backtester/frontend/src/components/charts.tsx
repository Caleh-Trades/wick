import type { ReactNode } from "react"
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { Button } from "@/components/ui/button"
import { formatAxis, formatCompactMoney, formatMoney, formatPct, formatPrice, formatStamp } from "@/lib/format"
import { plotCandles, priceDomain, thinRows } from "@/lib/plot"
import type { BacktestResult, TapeCandle, Trade } from "@/lib/types"

export type OverlaySeries = {
  id: string
  name: string
  color: string
  equity: { time: string; equity: number }[]
}

const axisTick = { fill: "#8a8176", fontSize: 11, fontFamily: "IBM Plex Mono, ui-monospace, monospace" }

export function EquityChart({
  result,
  overlays,
  selectedId,
}: {
  result: BacktestResult
  overlays: OverlaySeries[]
  selectedId: string
}) {
  const rows = thinRows(overlayRows(result, overlays), 900)
  const drawdown = thinRows(result.equity, 900)
  const selectedSeries = overlays.find((series) => series.id === selectedId)
  const fill = selectedSeries?.color ?? "#e4b15a"
  const headline = selectedSeries
    ? (rows.at(-1)?.[selectedId] as number | null | undefined)
    : result.metrics.final_equity
  return (
    <div className="flex h-full min-h-0 flex-col bg-desk px-4 py-4 text-desk-ink sm:px-6 sm:py-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[0.65rem] font-semibold tracking-[0.18em] text-bench uppercase">Equity</p>
          <p className="font-mono text-2xl text-gold tabular-nums">
            {formatMoney(typeof headline === "number" ? headline : result.metrics.final_equity, 0)}
          </p>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] tracking-wide uppercase">
          {overlays.map((series) => (
            <span key={series.id} style={{ color: series.color }}>
              {series.name}
            </span>
          ))}
          <span className="text-bench">Buy and hold</span>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="equity-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={fill} stopOpacity={0.35} />
                <stop offset="100%" stopColor={fill} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="rgba(243,239,230,0.08)" />
            <XAxis
              dataKey="time"
              tickFormatter={(value) => formatAxis(String(value), result.interval)}
              minTickGap={36}
              tick={axisTick}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              orientation="right"
              domain={[(value: number) => value - Math.abs(value) * 0.06, (value: number) => value + Math.abs(value) * 0.06]}
              tickFormatter={(value) => formatCompactMoney(Number(value))}
              tick={axisTick}
              axisLine={false}
              tickLine={false}
              width={64}
            />
            <Tooltip
              content={({ active, payload, label }) => (
                <ChartTip active={active} label={label} interval={result.interval}>
                  {overlays.map((series) => (
                    <TipRow
                      key={series.id}
                      label={series.name}
                      value={moneyOrDash(numberFrom(payload, series.id))}
                    />
                  ))}
                  <TipRow label="Buy and hold" value={moneyOrDash(numberFrom(payload, "benchmark"))} />
                </ChartTip>
              )}
            />
            {overlays.map((series) =>
              series.id === selectedId ? (
                <Area
                  key={series.id}
                  type="monotone"
                  dataKey={series.id}
                  stroke={series.color}
                  strokeWidth={2}
                  fill="url(#equity-fill)"
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ) : (
                <Line
                  key={series.id}
                  type="monotone"
                  dataKey={series.id}
                  stroke={series.color}
                  strokeWidth={1.75}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ),
            )}
            <Line
              type="monotone"
              dataKey="benchmark"
              stroke="#a3988c"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 h-16 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={drawdown} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <XAxis dataKey="time" hide />
            <YAxis
              orientation="right"
              tickFormatter={(value) => formatPct(Number(value), 0)}
              tick={axisTick}
              axisLine={false}
              tickLine={false}
              width={64}
              domain={["dataMin", 0]}
            />
            <Tooltip
              content={({ active, payload, label }) => (
                <ChartTip active={active} label={label} interval={result.interval}>
                  <TipRow label="Drawdown" value={formatPct(numberFrom(payload, "drawdown_pct"))} />
                </ChartTip>
              )}
            />
            <Area
              type="monotone"
              dataKey="drawdown_pct"
              stroke="#c46a5a"
              strokeWidth={1.5}
              fill="#c46a5a"
              fillOpacity={0.28}
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 font-mono text-[10px] tracking-[0.16em] text-bench uppercase">Drawdown from peak equity</p>
    </div>
  )
}

export function PriceChart({
  candles,
  trades,
  interval,
  onEnlarge,
}: {
  candles: TapeCandle[]
  trades: Trade[]
  interval: string
  onEnlarge: () => void
}) {
  const rows = plotCandles(candles, trades, 700)
  const domain = priceDomain(candles)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex shrink-0 flex-wrap items-end justify-between gap-3">
        <h3 className="font-heading text-2xl">Price</h3>
        <div className="flex items-center gap-4 font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
          <span>Close</span>
          <span className="text-up">Entry</span>
          <span className="text-down">Exit</span>
          <Button type="button" size="xs" variant="outline" className="normal-case tracking-normal" onClick={onEnlarge}>
            Enlarge
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="rgba(28,25,22,0.08)" />
            <XAxis
              dataKey="time"
              tickFormatter={(value) => formatAxis(String(value), interval)}
              minTickGap={36}
              tick={{ ...axisTick, fill: "#6e675d" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              orientation="right"
              domain={domain}
              allowDataOverflow
              tickFormatter={(value) => formatPrice(Number(value))}
              tick={{ ...axisTick, fill: "#6e675d" }}
              axisLine={false}
              tickLine={false}
              width={72}
            />
            <Tooltip
              content={({ active, payload, label }) => (
                <ChartTip active={active} label={label} interval={interval} light>
                  <TipRow label="Close" value={priceOrDash(numberFrom(payload, "close"))} />
                </ChartTip>
              )}
            />
            <Line
              type="monotone"
              dataKey="close"
              stroke="#1c1916"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              dataKey="entry"
              stroke="none"
              dot={{ r: 3.5, fill: "#1b6b43", stroke: "#f7f3eb", strokeWidth: 1 }}
              isAnimationActive={false}
              connectNulls={false}
            />
            <Line
              dataKey="exit"
              stroke="none"
              dot={{ r: 3.5, fill: "#a33b32", stroke: "#f7f3eb", strokeWidth: 1 }}
              isAnimationActive={false}
              connectNulls={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function overlayRows(result: BacktestResult, overlays: OverlaySeries[]) {
  const times = new Set<string>()
  for (const point of result.equity) times.add(point.time)
  for (const series of overlays) {
    for (const point of series.equity) times.add(point.time)
  }
  const bench = new Map(result.equity.map((point) => [point.time, point.benchmark]))
  const seriesMaps = overlays.map((series) => ({
    id: series.id,
    values: new Map(series.equity.map((point) => [point.time, point.equity])),
  }))
  return [...times].sort().map((time) => {
    const row: Record<string, string | number | null> = {
      time,
      benchmark: bench.get(time) ?? null,
    }
    for (const series of seriesMaps) row[series.id] = series.values.get(time) ?? null
    return row
  })
}

function moneyOrDash(value: number | null): string {
  return value == null ? "—" : formatMoney(value, 0)
}

function priceOrDash(value: number | null): string {
  return value == null ? "—" : formatPrice(value)
}

function numberFrom(
  payload: ReadonlyArray<{ dataKey?: unknown; value?: unknown }> | undefined,
  key: string,
): number | null {
  const match = payload?.find((item) => item.dataKey === key)
  const value = match?.value
  if (value == null || value === "") return null
  const number = typeof value === "number" ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

function ChartTip({
  active,
  label,
  interval,
  light = false,
  children,
}: {
  active?: boolean
  label?: string | number
  interval: string
  light?: boolean
  children: ReactNode
}) {
  if (!active || label == null) return null
  return (
    <div
      className={
        light
          ? "border border-border bg-popover px-3 py-2 text-xs shadow-sm"
          : "bg-desk-ink px-3 py-2 text-xs text-desk"
      }
    >
      <div className="mb-1 font-mono text-[10px] tracking-wide uppercase opacity-70">
        {formatStamp(String(label), interval)}
      </div>
      <div className="space-y-0.5 font-mono">{children}</div>
    </div>
  )
}

function TipRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}
