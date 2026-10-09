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

import { formatAxis, formatCompactMoney, formatMoney, formatPct, formatPrice, formatStamp } from "@/lib/format"
import type { BacktestResult } from "@/lib/types"

const axisTick = { fill: "#8a8176", fontSize: 11, fontFamily: "IBM Plex Mono, ui-monospace, monospace" }

export function EquityChart({ result }: { result: BacktestResult }) {
  return (
    <div className="bg-desk px-4 py-5 text-desk-ink sm:px-6 sm:py-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[0.65rem] font-semibold tracking-[0.18em] text-bench uppercase">Equity</p>
          <p className="font-mono text-2xl text-gold tabular-nums">{formatMoney(result.metrics.final_equity, 0)}</p>
        </div>
        <div className="flex gap-4 font-mono text-[11px] tracking-wide uppercase">
          <span className="text-gold">Strategy</span>
          <span className="text-bench">Buy and hold</span>
        </div>
      </div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={result.equity} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="equity-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#e4b15a" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#e4b15a" stopOpacity={0} />
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
                  <TipRow label="Strategy" value={formatMoney(numberFrom(payload, "equity"), 0)} />
                  <TipRow label="Buy and hold" value={formatMoney(numberFrom(payload, "benchmark"), 0)} />
                </ChartTip>
              )}
            />
            <Area
              type="monotone"
              dataKey="equity"
              stroke="#e4b15a"
              strokeWidth={2}
              fill="url(#equity-fill)"
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="benchmark"
              stroke="#a3988c"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 h-20">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={result.equity} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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

export function PriceChart({ result }: { result: BacktestResult }) {
  const rows = priceRows(result)
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <h3 className="font-heading text-2xl">Price</h3>
        <div className="flex gap-4 font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
          <span>Close</span>
          <span className="text-up">Entry</span>
          <span className="text-down">Exit</span>
        </div>
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="rgba(28,25,22,0.08)" />
            <XAxis
              dataKey="time"
              tickFormatter={(value) => formatAxis(String(value), result.interval)}
              minTickGap={36}
              tick={{ ...axisTick, fill: "#6e675d" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              orientation="right"
              domain={["auto", "auto"]}
              tickFormatter={(value) => formatPrice(Number(value))}
              tick={{ ...axisTick, fill: "#6e675d" }}
              axisLine={false}
              tickLine={false}
              width={72}
            />
            <Tooltip
              content={({ active, payload, label }) => (
                <ChartTip active={active} label={label} interval={result.interval} light>
                  <TipRow label="Close" value={formatPrice(numberFrom(payload, "close"))} />
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

function priceRows(result: BacktestResult) {
  const entries = new Map<string, number>()
  const exits = new Map<string, number>()
  for (const trade of result.trades) {
    entries.set(trade.entry_time, trade.entry_price)
    if (trade.exit_time && trade.status === "closed" && trade.exit_price != null) {
      exits.set(trade.exit_time, trade.exit_price)
    }
  }
  return result.candles.map((candle) => ({
    time: candle.time,
    close: candle.close,
    entry: entries.get(candle.time) ?? null,
    exit: exits.get(candle.time) ?? null,
  }))
}

function numberFrom(
  payload: ReadonlyArray<{ dataKey?: unknown; value?: unknown }> | undefined,
  key: string,
): number {
  const match = payload?.find((item) => item.dataKey === key)
  const value = match?.value
  return typeof value === "number" ? value : Number(value ?? 0)
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
