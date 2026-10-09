import { memo, startTransition, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type TransitionEvent } from "react"
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { X } from "lucide-react"

import { QuotePrice } from "@/components/quote-price"
import { Button } from "@/components/ui/button"
import { formatAxis, formatPct, formatPlainPct, formatPrice, formatStamp, formatStat, tone } from "@/lib/format"
import { barsLabel } from "@/lib/runs"
import { useFormingCandles } from "@/lib/use-book"
import { plotCandles, priceDomain, type PlotBar } from "@/lib/plot"
import type { Metrics, TapeCandle, Trade } from "@/lib/types"
import { cn } from "@/lib/utils"

const MIN_BARS = 20
const axisTick = { fill: "#8d6b56", fontSize: 11, fontFamily: "IBM Plex Mono, ui-monospace, monospace" }

type View = { start: number; end: number }
type PlotBox = { left: number; top: number; width: number; height: number }
type Drag = { kind: "zoom" | "pan"; x0: number; origin: View; x: number }

export const ResearchChart = memo(function ResearchChart({
  candles: fetched,
  trades,
  interval,
  symbol,
  metrics,
  runName,
  onClose,
}: {
  candles: TapeCandle[]
  trades: Trade[]
  interval: string
  symbol: string | null
  metrics: Metrics | null
  runName: string
  onClose: () => void
}) {
  const candles = useFormingCandles(fetched, interval, symbol)
  const closeRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<PlotBox | null>(null)
  const summaryRef = useRef<DOMRect | null>(readSummaryRect())
  const targetRef = useRef(targetBox())
  const closingRef = useRef(false)
  const closeTimer = useRef(0)
  const reduceMotion = useRef(window.matchMedia("(prefers-reduced-motion: reduce)").matches)
  const [grown, setGrown] = useState(reduceMotion.current)
  const [settled, setSettled] = useState(reduceMotion.current)
  const viewRef = useRef<View>({ start: 0, end: Math.max(0, candles.length - 1) })
  const followRef = useRef(true)
  const countRef = useRef(candles.length)
  const originRef = useRef(candles[0]?.t ?? 0)
  const [view, setView] = useState<View>(viewRef.current)
  const [plot, setPlot] = useState<PlotBox | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)

  useEffect(() => () => window.clearTimeout(closeTimer.current), [])

  useEffect(() => {
    if (reduceMotion.current) return
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setGrown(true))
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [])

  useEffect(() => {
    if (grown) closeRef.current?.focus()
  }, [grown])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") beginClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  function beginClose() {
    if (closingRef.current) return
    closingRef.current = true
    if (reduceMotion.current) {
      onClose()
      return
    }
    setSettled(false)
    const source = readSummaryRect()
    if (source) summaryRef.current = source
    window.clearTimeout(closeTimer.current)
    requestAnimationFrame(() => {
      setGrown(false)
      closeTimer.current = window.setTimeout(() => onClose(), 520)
    })
  }

  function onPanelTransitionEnd(event: TransitionEvent<HTMLDivElement>) {
    if (event.target !== panelRef.current || event.propertyName !== "transform") return
    if (closingRef.current) {
      window.clearTimeout(closeTimer.current)
      onClose()
      return
    }
    startTransition(() => setSettled(true))
  }

  function commit(next: View, follow = next.end >= candles.length - 1) {
    viewRef.current = next
    followRef.current = follow
    setView(next)
  }

  useEffect(() => {
    const origin = candles[0]?.t ?? 0
    const count = candles.length
    if (origin !== originRef.current) {
      originRef.current = origin
      countRef.current = count
      commit({ start: 0, end: Math.max(0, count - 1) }, true)
      return
    }
    if (count === countRef.current) return
    const previous = viewRef.current
    const previousCount = countRef.current
    countRef.current = count
    const endMax = Math.max(0, count - 1)
    const span = previous.end - previous.start
    const pinned = followRef.current || previous.end >= previousCount - 1
    if (!pinned) {
      commit(
        {
          start: Math.min(previous.start, endMax),
          end: Math.min(previous.end, endMax),
        },
        false,
      )
      return
    }
    if (span >= previousCount - 1) {
      commit({ start: 0, end: endMax }, true)
      return
    }
    commit({ start: Math.max(0, endMax - span), end: endMax }, true)
  }, [candles])

  const slice = useMemo(
    () => (settled ? candles.slice(view.start, view.end + 1) : []),
    [settled, candles, view.start, view.end],
  )
  const bars = useMemo(() => (settled ? plotCandles(slice, trades, 220) : []), [settled, slice, trades])
  const domain = useMemo(() => (settled ? priceDomain(slice) : ([1, 2] as [number, number])), [settled, slice])
  const windowStart = candles[view.start]
  const windowEnd = candles[view.end]

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
        if (prev && prev.left === next.left && prev.top === next.top && prev.width === next.width && prev.height === next.height) {
          return prev
        }
        plotRef.current = next
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
  }, [bars, domain, settled])

  useEffect(() => {
    if (!grown || closingRef.current) return
    const id = window.setTimeout(() => startTransition(() => setSettled(true)), 540)
    return () => window.clearTimeout(id)
  }, [grown])

  useEffect(() => {
    const node = shellRef.current
    if (!node) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const count = candles.length
      if (count < 2) return
      const current = viewRef.current
      const span = Math.max(1, current.end - current.start)
      const zoomIn = event.deltaY < 0
      let nextSpan = Math.round(span * (zoomIn ? 0.8 : 1.25))
      nextSpan = Math.max(Math.min(MIN_BARS, count) - 1, Math.min(count - 1, nextSpan))
      const rect = clientPlotRect()
      const ratio = rect ? clamp((event.clientX - rect.left) / rect.width, 0, 1) : 0.5
      const anchor = current.start + ratio * span
      let start = Math.round(anchor - ratio * nextSpan)
      let end = start + nextSpan
      if (start < 0) {
        end -= start
        start = 0
      }
      if (end > count - 1) {
        start -= end - (count - 1)
        end = count - 1
      }
      commit({ start: Math.max(0, start), end }, end >= count - 1)
    }
    node.addEventListener("wheel", onWheel, { passive: false })
    return () => node.removeEventListener("wheel", onWheel)
  }, [candles.length, settled])

  function clientPlotRect(): DOMRect | null {
    const frame = frameRef.current
    const box = plotRef.current
    if (!frame || !box) return null
    const host = frame.getBoundingClientRect()
    return new DOMRect(host.left + box.left, host.top + box.top, box.width, box.height)
  }

  function indexAt(clientX: number): number {
    const rect = clientPlotRect()
    const current = viewRef.current
    if (!rect || rect.width <= 0) return current.start
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1)
    return Math.round(current.start + ratio * (current.end - current.start))
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.button !== 1) return
    if (candles.length < 2) return
    const frame = frameRef.current
    if (!frame) return
    const host = frame.getBoundingClientRect()
    const localY = event.clientY - host.top
    const onAxis = plot ? localY > plot.top + plot.height : false
    const kind = event.button === 1 || event.altKey || onAxis ? "pan" : "zoom"
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({ kind, x0: event.clientX, origin: viewRef.current, x: event.clientX })
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drag) return
    if (drag.kind === "zoom") {
      setDrag({ ...drag, x: event.clientX })
      return
    }
    const rect = clientPlotRect()
    if (!rect || rect.width <= 0) return
    const span = drag.origin.end - drag.origin.start
    const shift = Math.round(((event.clientX - drag.x0) / rect.width) * span)
    const count = candles.length
    let start = drag.origin.start - shift
    let end = drag.origin.end - shift
    if (start < 0) {
      end -= start
      start = 0
    }
    if (end > count - 1) {
      start -= end - (count - 1)
      end = count - 1
    }
    commit({ start: Math.max(0, start), end: Math.min(count - 1, end) }, end >= count - 1)
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drag) return
    if (drag.kind === "zoom" && Math.abs(event.clientX - drag.x0) > 8) {
      const left = indexAt(Math.min(drag.x0, event.clientX))
      const right = indexAt(Math.max(drag.x0, event.clientX))
      const count = candles.length
      let start = Math.min(left, right)
      let end = Math.max(left, right)
      if (end - start < MIN_BARS - 1) {
        const mid = (start + end) / 2
        start = Math.round(mid - (MIN_BARS - 1) / 2)
        end = start + MIN_BARS - 1
      }
      if (start < 0) {
        end -= start
        start = 0
      }
      if (end > count - 1) {
        start -= end - (count - 1)
        end = count - 1
      }
      commit({ start: Math.max(0, start), end: Math.min(count - 1, end) }, end >= count - 1)
    }
    setDrag(null)
  }

  const boxLeft = (() => {
    if (!drag || drag.kind !== "zoom" || !plot) return null
    const rect = clientPlotRect()
    if (!rect) return null
    const rawLeft = Math.min(drag.x0, drag.x) - rect.left
    return { left: plot.left + rawLeft, width: Math.abs(drag.x - drag.x0), top: plot.top, height: plot.height }
  })()

  const target = targetRef.current
  const panelStyle = {
    top: target.top,
    left: target.left,
    width: target.width,
    height: target.height,
    transform: placedTransform(summaryRef.current, target, grown),
    transition: "transform 500ms cubic-bezier(0.22, 1, 0.36, 1)",
    pointerEvents: grown ? ("auto" as const) : ("none" as const),
  }

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Enlarged price">
      <div
        className="absolute inset-0 bg-foreground/45 transition-opacity duration-500 ease-out"
        style={{ opacity: grown ? 1 : 0 }}
      />
      <div
        ref={panelRef}
        onTransitionEnd={onPanelTransitionEnd}
        className="bezel plot-solid fixed flex origin-center flex-col overflow-hidden px-4 py-4 text-[#3c2a22] will-change-transform sm:px-6"
        style={panelStyle}
      >
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="flex flex-wrap items-baseline gap-3 text-[0.65rem] font-semibold tracking-[0.18em] text-bench uppercase">
              <span>Price · {runName}</span>
              <QuotePrice symbol={symbol} close={candles.at(-1)?.close} />
            </p>
            <p className="mt-1 font-mono text-[11px] tracking-wide text-bench uppercase">
              {barsLabel(interval, candles.length)}
              {windowStart && windowEnd ? ` · ${formatStamp(windowStart.time, interval)} – ${formatStamp(windowEnd.time, interval)}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="xs"
              variant="outline"
              className="normal-case tracking-normal"
              onClick={() => commit({ start: 0, end: Math.max(0, candles.length - 1) }, true)}
            >
              Reset
            </Button>
            <Button
              ref={closeRef}
              type="button"
              size="icon-xs"
              variant="outline"
              aria-label="Close enlarged chart"
              onClick={beginClose}
            >
              <X />
            </Button>
          </div>
        </div>

        <Stats metrics={metrics} />

        {settled ? (
        <div ref={shellRef} className="mt-3 flex min-h-0 flex-1 flex-col">
          <div
            ref={frameRef}
            className="relative min-h-0 flex-[3] select-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={bars} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#e2cdb8" />
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
                  tickFormatter={(value) => formatPrice(Number(value))}
                  tick={axisTick}
                  axisLine={false}
                  tickLine={false}
                  width={76}
                />
                <Tooltip content={({ active, payload, label }) => <CandleTip active={active} label={label} payload={payload} interval={interval} />} />
                <Line type="linear" dataKey="close" stroke="transparent" dot={false} activeDot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
            {plot ? <CandleLayer bars={bars} domain={domain} plot={plot} /> : null}
            {boxLeft && boxLeft.width > 0 ? (
              <div
                className="pointer-events-none absolute border border-[#c56a32] bg-[#c56a32]/15"
                style={{ left: boxLeft.left, top: boxLeft.top, width: boxLeft.width, height: boxLeft.height }}
              />
            ) : null}
          </div>
          <div className="h-24 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={bars} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <XAxis dataKey="time" hide padding={{ left: 0, right: 0 }} />
                <YAxis
                  orientation="right"
                  tickFormatter={(value) => formatVolume(Number(value))}
                  tick={axisTick}
                  axisLine={false}
                  tickLine={false}
                  width={76}
                />
                <Tooltip
                  content={({ active, payload, label }) =>
                    active ? (
                      <div className="border border-border bg-[#fffaf4] px-3 py-2 font-mono text-xs text-[#3c2a22]">
                        <div className="text-[10px] tracking-wide uppercase opacity-70">{label ? formatStamp(String(label), interval) : ""}</div>
                        <div>Volume {formatVolume(numberFrom(payload, "volume") ?? 0)}</div>
                      </div>
                    ) : null
                  }
                />
                <Bar dataKey="volume" fill="#8d6b56" isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
        ) : (
          <div className="mt-3 min-h-0 flex-1" />
        )}
        <p className="mt-2 font-mono text-[10px] tracking-[0.16em] text-bench uppercase">
          Drag to zoom · wheel zooms · alt-drag or the time axis pans · volume underneath
        </p>
      </div>
    </div>
  )
})

function Stats({ metrics }: { metrics: Metrics | null }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      <Stat label="Return" value={formatPct(metrics?.total_return_pct)} toneName={tone(metrics?.total_return_pct)} />
      <Stat label="Excess" value={formatPct(metrics?.excess_return_pct)} toneName={tone(metrics?.excess_return_pct)} />
      <Stat label="Max DD" value={formatPct(metrics?.max_drawdown_pct)} toneName="down" />
      <Stat label="Sharpe" value={formatStat(metrics?.sharpe)} />
      <Stat label="Win rate" value={formatPlainPct(metrics?.win_rate_pct, 0)} />
    </div>
  )
}

function Stat({ label, value, toneName = "ink" }: { label: string; value: string; toneName?: "up" | "down" | "ink" }) {
  return (
    <div className="border-t border-desk-ink/15 pt-2">
      <div className="text-[0.65rem] font-semibold tracking-[0.16em] text-bench uppercase">{label}</div>
      <div className={cn("font-mono text-lg tabular-nums", toneName === "up" && "text-[#3ee0a2]", toneName === "down" && "text-[#ff5d73]")}>
        {value}
      </div>
    </div>
  )
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
    if (bar.entry != null) marks.push({ x: cx, y: y(bar.entry), fill: "#3ee0a2" })
    if (bar.exit != null) marks.push({ x: cx, y: y(bar.exit), fill: "#ff5d73" })
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
}: {
  active?: boolean
  label?: string | number
  payload?: ReadonlyArray<{ payload?: PlotBar }>
  interval: string
}) {
  const bar = payload?.[0]?.payload
  if (!active || !bar || label == null) return null
  return (
    <div className="border border-border bg-[#fffaf4] px-3 py-2 font-mono text-xs text-[#3c2a22]">
      <div className="mb-1 text-[10px] tracking-wide uppercase opacity-70">{formatStamp(String(label), interval)}</div>
      <div>O {formatPrice(bar.open)}</div>
      <div>H {formatPrice(bar.high)}</div>
      <div>L {formatPrice(bar.low)}</div>
      <div>C {formatPrice(bar.close)}</div>
      <div>Vol {formatVolume(bar.volume)}</div>
    </div>
  )
}

function numberFrom(payload: ReadonlyArray<{ dataKey?: unknown; value?: unknown }> | undefined, key: string): number | null {
  const match = payload?.find((item) => item.dataKey === key)
  const value = match?.value
  const number = typeof value === "number" ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

function formatVolume(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return value.toFixed(0)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

type Frame = { top: number; left: number; width: number; height: number }

function readSummaryRect(): DOMRect | null {
  const node = document.querySelector("[data-price-summary]")
  if (!node) return null
  const rect = node.getBoundingClientRect()
  return rect.width > 8 && rect.height > 8 ? rect : null
}

function targetBox(): Frame {
  const marginX = 16
  const top = window.innerHeight * 0.05
  const width = Math.min(1600, Math.max(280, window.innerWidth - marginX * 2))
  return { top, left: (window.innerWidth - width) / 2, width, height: window.innerHeight * 0.9 }
}

function placedTransform(origin: DOMRect | null, target: Frame, grown: boolean): string {
  if (grown || !origin) return "translate3d(0px, 0px, 0) scale(1, 1)"
  const sx = origin.width / target.width
  const sy = origin.height / target.height
  const tx = origin.left + origin.width / 2 - (target.left + target.width / 2)
  const ty = origin.top + origin.height / 2 - (target.top + target.height / 2)
  return `translate3d(${tx}px, ${ty}px, 0) scale(${sx}, ${sy})`
}
