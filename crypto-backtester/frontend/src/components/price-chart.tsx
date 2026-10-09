import { memo, useLayoutEffect, useMemo, useRef, useState } from "react"
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { QuotePrice } from "@/components/quote-price"
import { Button } from "@/components/ui/button"
import { formatAxis, formatPrice, formatStamp } from "@/lib/format"
import { marketSpec } from "@/lib/markets"
import { plotCandles, priceDomain, type PlotBar } from "@/lib/plot"
import { useBookView, useFormingCandles } from "@/lib/use-book"
import type { TapeCandle, Trade, Venue } from "@/lib/types"

const axisTick = { fill: "#8d6b56", fontSize: 11, fontFamily: "IBM Plex Mono, ui-monospace, monospace" }
const plotGrid = "#e2cdb8"

type PlotBox = { left: number; top: number; width: number; height: number }

export const PriceChart = memo(function PriceChart({
  candles,
  trades,
  interval,
  symbol,
  venue,
  onEnlarge,
}: {
  candles: TapeCandle[]
  trades: Trade[]
  interval: string
  symbol: string | null
  venue: Venue
  onEnlarge: () => void
}) {
  const book = useBookView(symbol, venue)
  const formed = useFormingCandles(candles, interval, symbol, venue)
  const livePrice = book.last?.price ?? book.quote
  const shown = useMemo(() => withLivePrice(formed, livePrice), [formed, livePrice])
  const frameRef = useRef<HTMLDivElement>(null)
  const [plot, setPlot] = useState<PlotBox | null>(null)
  const bars = useMemo(() => plotCandles(shown, trades, 280), [shown, trades])
  const domain = useMemo(() => priceDomain(shown), [shown])
  const tick = symbol ? marketSpec(symbol, venue)?.tickSize : undefined

  useLayoutEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const measure = () => {
      const grid = frame.querySelector(".recharts-cartesian-grid")
      if (!grid) return
      const host = frame.getBoundingClientRect()
      const box = grid.getBoundingClientRect()
      const next = { left: box.left - host.left, top: box.top - host.top, width: box.width, height: box.height }
      setPlot((prev) => {
        if (prev && prev.left === next.left && prev.top === next.top && prev.width === next.width && prev.height === next.height) return prev
        return next
      })
    }
    measure()
    const frameId = requestAnimationFrame(measure)
    const observer = new ResizeObserver(measure)
    observer.observe(frame)
    return () => {
      cancelAnimationFrame(frameId)
      observer.disconnect()
    }
  }, [bars, domain])

  if (shown.length === 0) {
    return (
      <div data-price-summary="" className="bezel flex h-full min-h-0 flex-col px-3 py-2">
        <div className="flex items-baseline gap-3">
          <h3 className="font-heading text-xl">Price</h3>
          <QuotePrice symbol={symbol} venue={venue} />
        </div>
        <p className="mt-6 text-sm text-muted-foreground">Waiting for bars.</p>
      </div>
    )
  }

  return (
    <div data-price-summary="" className="bezel flex h-full min-h-0 flex-col px-3 py-2">
      <div className="mb-1 flex shrink-0 flex-wrap items-end justify-between gap-2">
        <div className="flex items-baseline gap-3">
          <h3 className="font-heading text-xl">Price</h3>
          <QuotePrice symbol={symbol} venue={venue} close={shown.at(-1)?.close} />
        </div>
        <div className="flex items-center gap-3 font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
          <span className="text-up">Long</span>
          <span className="text-down">Short</span>
          <Button type="button" size="xs" variant="outline" className="normal-case tracking-normal" onClick={onEnlarge}>
            Enlarge
          </Button>
        </div>
      </div>
      <div ref={frameRef} className="price-plot relative min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={bars} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={plotGrid} />
            <XAxis
              dataKey="time"
              tickFormatter={(value) => formatAxis(String(value), interval)}
              minTickGap={32}
              tick={axisTick}
              axisLine={false}
              tickLine={false}
              padding={{ left: 0, right: 0 }}
            />
            <YAxis
              orientation="right"
              domain={domain}
              allowDataOverflow
              tickFormatter={(value) => formatPrice(Number(value), tick)}
              tick={axisTick}
              axisLine={false}
              tickLine={false}
              width={96}
            />
            <Tooltip content={({ active, payload, label }) => <CandleTip active={active} label={label} payload={payload} interval={interval} tick={tick} />} />
            <Line type="linear" dataKey="close" stroke="transparent" dot={false} activeDot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
        {plot ? <CandleLayer bars={bars} domain={domain} plot={plot} /> : null}
      </div>
    </div>
  )
})

function withLivePrice(candles: TapeCandle[], price: number | null | undefined): TapeCandle[] {
  if (price == null || !(price > 0) || candles.length === 0) return candles
  const last = candles[candles.length - 1]
  if (!last || (price === last.close && price <= last.high && price >= last.low)) return candles
  const next = candles.slice()
  next[next.length - 1] = {
    ...last,
    high: Math.max(last.high, price),
    low: Math.min(last.low, price),
    close: price,
  }
  return next
}

function CandleLayer({ bars, domain, plot }: { bars: PlotBar[]; domain: [number, number]; plot: PlotBox }) {
  const [min, max] = domain
  const span = max - min || 1
  const slot = plot.width / Math.max(bars.length, 1)
  const bodyWidth = Math.max(1.5, Math.min(9, slot * 0.62))
  const y = (value: number) => ((max - value) / span) * plot.height
  let upWicks = ""
  let downWicks = ""
  let upBodies = ""
  let downBodies = ""
  const marks: { x: number; y: number; fill: string }[] = []
  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index]
    if (!bar) continue
    const cx = (index + 0.5) * slot
    const rising = bar.close >= bar.open
    const top = Math.min(y(bar.open), y(bar.close))
    const height = Math.max(1, Math.abs(y(bar.close) - y(bar.open)))
    const wick = `M${cx.toFixed(1)} ${y(bar.high).toFixed(1)}V${y(bar.low).toFixed(1)}`
    const body = `M${(cx - bodyWidth / 2).toFixed(1)} ${top.toFixed(1)}h${bodyWidth.toFixed(1)}v${height.toFixed(1)}h${(-bodyWidth).toFixed(1)}Z`
    if (rising) {
      upWicks += wick
      upBodies += body
    } else {
      downWicks += wick
      downBodies += body
    }
    if (bar.entry != null && bar.entrySide) marks.push({ x: cx, y: y(bar.entry), fill: bar.entrySide === "short" ? "#ff5d73" : "#3ee0a2" })
    if (bar.exit != null && bar.exitSide) marks.push({ x: cx, y: y(bar.exit), fill: bar.exitSide === "short" ? "#ff5d73" : "#3ee0a2" })
  }
  return (
    <svg className="pointer-events-none absolute" style={{ left: plot.left, top: plot.top, width: plot.width, height: plot.height }} aria-hidden="true">
      <path d={upWicks} stroke="#3ee0a2" strokeWidth={1} fill="none" />
      <path d={downWicks} stroke="#ff5d73" strokeWidth={1} fill="none" />
      <path d={upBodies} fill="#3ee0a2" />
      <path d={downBodies} fill="#ff5d73" />
      {marks.map((mark, index) => (
        <circle key={index} cx={mark.x} cy={mark.y} r={3.5} fill={mark.fill} stroke="#f3e6d6" strokeWidth={1} />
      ))}
    </svg>
  )
}

function CandleTip({
  active,
  label,
  payload,
  interval,
  tick,
}: {
  active?: boolean
  label?: string | number
  payload?: ReadonlyArray<{ payload?: PlotBar }>
  interval: string
  tick?: string
}) {
  const bar = payload?.[0]?.payload
  if (!active || !bar || label == null) return null
  return (
    <div className="border border-border bg-[#fffaf4] px-3 py-2 font-mono text-xs text-[#3c2a22]">
      <div className="mb-1 text-[10px] tracking-wide uppercase opacity-70">{formatStamp(String(label), interval)}</div>
      <div>O {formatPrice(bar.open, tick)}</div>
      <div>H {formatPrice(bar.high, tick)}</div>
      <div>L {formatPrice(bar.low, tick)}</div>
      <div>C {formatPrice(bar.close, tick)}</div>
      {bar.entrySide ? <div>{bar.entrySide === "short" ? "Short" : "Long"} entry</div> : null}
      {bar.exitSide ? <div>{bar.exitSide === "short" ? "Short" : "Long"} {bar.liquidated ? "liquidation" : "exit"}</div> : null}
    </div>
  )
}
