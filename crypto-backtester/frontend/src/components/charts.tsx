import { memo, useMemo, useState, type ReactNode } from "react"
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
import { formatAxis, formatCompactMoney, formatMoney, formatPct, formatStamp } from "@/lib/format"
import { thinRows } from "@/lib/plot"
import type { BacktestResult } from "@/lib/types"

export type OverlaySeries = {
  id: string
  name: string
  color: string
  equity: { time: string; equity: number }[]
}

const axisTick = { fill: "#9fb0c9", fontSize: 11, fontFamily: "IBM Plex Mono, ui-monospace, monospace" }
const plotGrid = "rgba(159,176,201,0.28)"

export const EquityChart = memo(function EquityChart({
  result,
  overlays,
  selectedId,
  drawToken,
}: {
  result: BacktestResult
  overlays: OverlaySeries[]
  selectedId: string
  drawToken: number
}) {
  const [log, setLog] = useState(false)
  const rows = thinRows(overlayRows(result, overlays), 480)
  const drawdown = thinRows(result.equity, 480)
  const selectedSeries = overlays.find((series) => series.id === selectedId)
  const headline = selectedSeries
    ? (rows.at(-1)?.[selectedId] as number | null | undefined)
    : result.metrics.final_equity
  const canLog = useMemo(() => rowsCanLog(rows, overlays), [rows, overlays])
  const logScale = log && canLog

  return (
    <div className="bezel flex h-full min-h-0 flex-col px-4 py-3 text-foreground sm:px-6">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[0.65rem] font-semibold tracking-[0.18em] text-bench uppercase">Equity</p>
          <p className="font-mono text-2xl text-[#c56a32] tabular-nums">
            {formatMoney(typeof headline === "number" ? headline : result.metrics.final_equity, 0)}
          </p>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] tracking-wide uppercase">
          {overlays.map((series) => (
            <span key={series.id} style={{ color: series.id === selectedId ? "#39e7ff" : series.color }}>
              {series.name}
            </span>
          ))}
          <span style={{ color: "#9fb0c9" }}>Buy and hold</span>
          <Button
            type="button"
            size="xs"
            variant={logScale ? "default" : "outline"}
            className="normal-case tracking-normal"
            aria-pressed={logScale}
            disabled={!canLog}
            onClick={() => setLog((value) => !value)}
          >
            Log
          </Button>
        </div>
      </div>
      <div key={drawToken} className="equity-plot equity-solid min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={plotGrid} />
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
              scale={logScale ? "log" : "auto"}
              domain={
                logScale
                  ? ["auto", "auto"]
                  : [(value: number) => value - Math.abs(value) * 0.06, (value: number) => value + Math.abs(value) * 0.06]
              }
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
            {overlays.map((series) => (
              <Line
                key={series.id}
                className={series.id === selectedId ? "equity-selected" : undefined}
                type="monotone"
                dataKey={series.id}
                stroke={series.id === selectedId ? "#39e7ff" : series.color}
                strokeWidth={series.id === selectedId ? 2 : 1.5}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            ))}
            <Line
              type="monotone"
              dataKey="benchmark"
              stroke="#9fb0c9"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="equity-solid mt-2 h-14 shrink-0">
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
              stroke="#ff5d73"
              strokeWidth={1.5}
              fill="#ff5d73"
              fillOpacity={0.16}
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 font-mono text-[10px] tracking-[0.16em] text-bench uppercase">Drawdown</p>
    </div>
  )
})

function rowsCanLog(rows: Array<Record<string, string | number | null>>, overlays: OverlaySeries[]): boolean {
  if (rows.length === 0) return false
  for (const row of rows) {
    const bench = row.benchmark
    if (typeof bench === "number" && bench <= 0) return false
    for (const series of overlays) {
      const value = row[series.id]
      if (typeof value === "number" && value <= 0) return false
    }
  }
  return true
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
  children,
}: {
  active?: boolean
  label?: string | number
  interval: string
  children: ReactNode
}) {
  if (!active || label == null) return null
  return (
    <div
      className={
        "border border-border bg-[#fffaf4] px-3 py-2 text-xs text-[#3c2a22]"
      }
    >
      <div className="mb-1 font-mono text-[10px] tracking-wide uppercase opacity-70">
        {formatStamp(String(label), interval)} UTC
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
