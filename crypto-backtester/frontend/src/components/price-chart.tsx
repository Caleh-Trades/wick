import { memo, useLayoutEffect, useMemo, useRef, useState } from "react"
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { QuotePrice } from "@/components/quote-price"
import { Button } from "@/components/ui/button"
import { liveMark } from "@/lib/book"
import { cumulativeDelta, standDownBar } from "@/lib/desk"
import { formatAxis, formatPrice, formatStamp } from "@/lib/format"
import { marketSpec } from "@/lib/markets"
import { plotCandles, priceDomain, priceTicks, spotTrades, type PlotBar } from "@/lib/plot"
import { heikinAshi } from "@/lib/signals"
import { RANGES } from "@/lib/runs"
import { useBookView, useFormingCandles } from "@/lib/use-book"
import type { RangeId, TapeCandle, Trade, Venue } from "@/lib/types"

const axisTick = { fill: "#8d6b56", fontSize: 11, fontFamily: "IBM Plex Mono, ui-monospace, monospace" }
const plotGrid = "#e2cdb8"

type PlotBox = { left: number; top: number; width: number; height: number }

export const PriceChart = memo(function PriceChart({
  candles,
  trades,
  interval,
  symbol,
  venue,
  focusTime,
  reading,
  range,
  onRange,
  onClearFocus,
  onEnlarge,
  onRetry,
  pending = true,
  smoothed = false,
}: {
  candles: TapeCandle[]
  trades: Trade[]
  interval: string
  symbol: string | null
  venue: Venue
  focusTime?: string | null
  reading?: string[]
  range?: RangeId
  onRange?: (range: RangeId) => void
  onClearFocus?: () => void
  onEnlarge: () => void
  onRetry?: () => void
  /** True while the tape is still on its way. A failed tape says so instead of waiting. */
  pending?: boolean
  /** Heikin-ashi draws the smoothed candles and does not label them as raw price. */
  smoothed?: boolean
}) {
  const book = useBookView(symbol, venue)
  const [shadeSession, setShadeSession] = useState(false)
  const [showCvd, setShowCvd] = useState(false)
  const cvd = useMemo(() => cumulativeDelta([...book.prints].reverse()), [book.prints])
  const formed = useFormingCandles(candles, interval, symbol, venue)
  const livePrice = liveMark(book)?.price
  const windowed = useMemo(() => windowAround(formed, focusTime), [formed, focusTime])
  const includesTail = windowed.length > 0 && windowed[windowed.length - 1] === formed[formed.length - 1]
  const shown = useMemo(() => {
    const priced = includesTail ? withLivePrice(windowed, livePrice) : windowed
    return smoothed ? heikinAshi(priced) : priced
  }, [includesTail, livePrice, smoothed, windowed])
  const frameRef = useRef<HTMLDivElement>(null)
  const [plot, setPlot] = useState<PlotBox | null>(null)
  const bars = useMemo(() => plotCandles(shown, spotTrades(trades, venue), 280, smoothed), [shown, smoothed, trades, venue])
  const domain = useMemo(() => priceDomain(shown), [shown])
  const ticks = useMemo(() => priceTicks(domain), [domain])
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
      <div data-price-summary="" className="price-chart bezel flex h-full min-h-0 flex-1 flex-col px-3 py-2">
        <div className="flex items-baseline gap-3">
          <h3 className="font-heading text-xl">{smoothed ? "Smoothed" : "Price"}</h3>
          <QuotePrice symbol={symbol} venue={venue} />
        </div>
        {reading && reading.length > 0 ? <p className="font-mono text-[11px] text-muted-foreground">{reading.join(" · ")}</p> : null}
        <ChartTools
          venue={venue}
          focusTime={focusTime}
          range={range}
          shadeSession={shadeSession}
          showCvd={showCvd}
          tapeReady={book.prints.length > 0}
          onShade={() => setShadeSession((current) => !current)}
          onCvd={() => setShowCvd((current) => !current)}
          onRange={onRange}
          onClearFocus={onClearFocus}
          onEnlarge={onEnlarge}
        />
        <p className="mt-6 text-sm text-muted-foreground">
          {pending ? "Waiting for bars." : "The bars didn't load."}
          {!pending && onRetry ? (
            <>
              {" "}
              <button type="button" className="font-semibold tracking-widest text-foreground uppercase underline" onClick={onRetry}>
                Retry
              </button>
            </>
          ) : null}
        </p>
      </div>
    )
  }

  return (
    <div data-price-summary="" className="price-chart bezel flex h-full min-h-0 flex-1 flex-col px-3 py-2">
      <div className="mb-1 flex shrink-0 flex-col gap-1">
        <div className="flex items-baseline gap-3">
          <div>
            <div className="flex items-baseline gap-3">
              <h3 className="font-heading text-xl">{smoothed ? "Smoothed" : "Price"}</h3>
              <QuotePrice symbol={symbol} venue={venue} close={shown.at(-1)?.close} />
            </div>
            {reading && reading.length > 0 ? <p className="font-mono text-[11px] text-muted-foreground">{reading.join(" · ")}</p> : null}
          </div>
        </div>
        <ChartTools
          venue={venue}
          focusTime={focusTime}
          range={range}
          shadeSession={shadeSession}
          showCvd={showCvd}
          tapeReady={book.prints.length > 0}
          onShade={() => setShadeSession((current) => !current)}
          onCvd={() => setShowCvd((current) => !current)}
          onRange={onRange}
          onClearFocus={onClearFocus}
          onEnlarge={onEnlarge}
        />
      </div>
      <div ref={frameRef} className="price-plot relative min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart key={`${symbol ?? ""}-${interval}-${range ?? ""}-${domain[0]}-${domain[1]}`} data={bars} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
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
              ticks={ticks}
              allowDataOverflow
              padding={{ top: 0, bottom: 0 }}
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
        {plot ? <CandleLayer bars={bars} domain={domain} plot={plot} shade={shadeSession} cvd={showCvd && cvd.length > 0 ? cvd : null} /> : null}
      </div>
    </div>
  )
})

function ChartTools({
  venue,
  focusTime,
  range,
  shadeSession,
  showCvd,
  tapeReady,
  onShade,
  onCvd,
  onRange,
  onClearFocus,
  onEnlarge,
}: {
  venue: Venue
  focusTime?: string | null
  range?: RangeId
  shadeSession: boolean
  showCvd: boolean
  tapeReady: boolean
  onShade: () => void
  onCvd: () => void
  onRange?: (range: RangeId) => void
  onClearFocus?: () => void
  onEnlarge: () => void
}) {
  return (
    <div className="flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto">
      {range && onRange ? (
        <div className="flex shrink-0 gap-1 lg:flex-wrap" role="group" aria-label="Range">
          {RANGES.map((item) => (
            <Button
              key={item.id}
              type="button"
              size="xs"
              variant={item.id === range ? "default" : "outline"}
              className="normal-case tracking-normal"
              aria-pressed={item.id === range}
              onClick={() => onRange(item.id)}
            >
              {item.label}
            </Button>
          ))}
        </div>
      ) : null}
      <div className="flex items-center gap-3 font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
        <span className="text-up">Long</span>
        {venue === "perp" ? <span className="text-down">Short</span> : null}
        {focusTime ? (
          <Button type="button" size="xs" variant="outline" className="normal-case tracking-normal" onClick={onClearFocus}>
            Full tape
          </Button>
        ) : null}
        <Button type="button" size="xs" variant={shadeSession ? "default" : "outline"} className="normal-case tracking-normal" aria-pressed={shadeSession} onClick={onShade}>
          Session
        </Button>
        {tapeReady ? (
          <Button type="button" size="xs" variant={showCvd ? "default" : "outline"} className="normal-case tracking-normal" aria-pressed={showCvd} onClick={onCvd}>
            CVD
          </Button>
        ) : null}
        <Button type="button" size="xs" variant="outline" className="normal-case tracking-normal" onClick={onEnlarge}>
          Enlarge
        </Button>
      </div>
    </div>
  )
}

function windowAround(candles: TapeCandle[], focusTime: string | null | undefined): TapeCandle[] {
  if (!focusTime) return candles
  const index = candles.findIndex((bar) => bar.time === focusTime)
  if (index < 0) return candles
  return candles.slice(Math.max(0, index - 60), Math.min(candles.length, index + 61))
}

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

function cvdPath(values: number[], width: number, height: number): string {
  if (values.length === 0) return ""
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  return values
    .map((value, index) => {
      const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width
      const y = ((max - value) / span) * (height - 8) + 4
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join("")
}

function CandleLayer({
  bars,
  domain,
  plot,
  shade,
  cvd,
}: {
  bars: PlotBar[]
  domain: [number, number]
  plot: PlotBox
  shade: boolean
  cvd: number[] | null
}) {
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
      {shade
        ? bars.map((bar, index) =>
            standDownBar(bar.time) ? (
              <rect key={bar.time} x={index * slot} y={0} width={slot} height={plot.height} fill="#c56a32" opacity={0.12} />
            ) : null,
          )
        : null}
      {cvd && cvd.length > 0 ? <path d={cvdPath(cvd, plot.width, plot.height)} stroke="#c56a32" strokeWidth={1.25} fill="none" /> : null}
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
      <div className="mb-1 text-[10px] tracking-wide uppercase opacity-70">{formatStamp(String(label), interval)} UTC</div>
      <div>O {formatPrice(bar.open, tick)}</div>
      <div>H {formatPrice(bar.high, tick)}</div>
      <div>L {formatPrice(bar.low, tick)}</div>
      <div>C {formatPrice(bar.close, tick)}</div>
      {bar.entrySide ? <div>{bar.entrySide === "short" ? "Short" : "Long"} entry</div> : null}
      {bar.exitSide ? <div>{bar.exitSide === "short" ? "Short" : "Long"} {bar.liquidated ? "liquidation" : "exit"}</div> : null}
    </div>
  )
}
