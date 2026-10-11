import { useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { plotCandles, priceDomain, priceTicks, spotTrades, type PlotBar } from "@/lib/plot"
import { replayTrades } from "@/lib/replay"
import { formatPrice } from "@/lib/format"
import type { TapeCandle, Trade, Venue } from "@/lib/types"

const SPEEDS = [1, 4, 10]

export function ReplayPage({
  candles,
  trades,
  venue,
  name,
  pending,
}: {
  candles: TapeCandle[]
  trades: Trade[]
  venue: Venue
  name: string
  pending: boolean
}) {
  const [index, setIndex] = useState(1)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const last = Math.max(0, candles.length - 1)

  useEffect(() => {
    setIndex(1)
    setPlaying(false)
  }, [candles])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      setPlaying(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  useEffect(() => {
    if (!playing) return
    if (index >= last) {
      setPlaying(false)
      return
    }
    const timer = window.setInterval(() => {
      setIndex((current) => {
        if (current >= last) return current
        return current + 1
      })
    }, Math.max(40, Math.round(1000 / speed)))
    return () => window.clearInterval(timer)
  }, [playing, speed, last, index])

  const cursor = Math.min(index, last)
  const through = candles[cursor]
  const shown = useMemo(() => {
    const slice = candles.slice(0, cursor + 1).slice(-180)
    const reached = through ? replayTrades(trades, through.time) : []
    return plotCandles(slice, spotTrades(reached, venue), 180)
  }, [candles, cursor, through, trades, venue])

  function step() {
    setPlaying(false)
    setIndex((current) => Math.min(last, current + 1))
  }

  function play() {
    if (cursor >= last) setIndex(1)
    setPlaying((current) => !current)
  }

  return (
    <div className="desk-stack flex min-h-0 flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-[1100px] min-h-0 flex-1 flex-col gap-4 px-4 py-4">
        <div>
          <h2 className="font-mono text-xs tracking-[0.28em] text-[#c56a32] uppercase">Replay</h2>
          <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
            {name} walks the loaded candles. Entries and exits appear when the cursor reaches them. Esc stops. The desk chart stays where it was.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="xs" className="normal-case tracking-normal" onClick={play} disabled={candles.length < 2}>
            {playing ? "Pause" : "Play"}
          </Button>
          <Button type="button" size="xs" variant="outline" className="normal-case tracking-normal" onClick={step} disabled={candles.length < 2 || cursor >= last}>
            Step
          </Button>
          <div className="flex gap-1" role="group" aria-label="Speed">
            {SPEEDS.map((item) => (
              <Button
                key={item}
                type="button"
                size="xs"
                variant={item === speed ? "default" : "outline"}
                className="normal-case tracking-normal"
                aria-pressed={item === speed}
                onClick={() => setSpeed(item)}
              >
                {item}×
              </Button>
            ))}
          </div>
          <span className="font-mono text-[11px] text-muted-foreground">
            {candles.length === 0 ? "No bars" : `Bar ${cursor + 1} of ${candles.length}`}
          </span>
        </div>
        <div className="bezel min-h-[320px] flex-1 p-3">
          {pending ? (
            <p className="text-sm text-muted-foreground">Waiting for bars.</p>
          ) : shown.length === 0 ? (
            <p className="text-sm text-muted-foreground">The bars didn't load.</p>
          ) : (
            <ReplayChart bars={shown} />
          )}
        </div>
      </div>
    </div>
  )
}

function ReplayChart({ bars }: { bars: PlotBar[] }) {
  const domain = priceDomain(bars)
  const ticks = priceTicks(domain)
  const [lo, hi] = domain
  const span = hi - lo || 1
  const width = 920
  const height = 420
  const slot = width / bars.length
  const y = (price: number) => ((hi - price) / span) * (height - 24) + 8
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full" role="img" aria-label="Replay candles">
      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={0} x2={width} y1={y(tick)} y2={y(tick)} stroke="#e6d7c8" strokeWidth={1} />
          <text x={4} y={y(tick) - 2} fill="#8a7364" fontSize={10}>
            {formatPrice(tick)}
          </text>
        </g>
      ))}
      {bars.map((bar, index) => {
        const up = bar.close >= bar.open
        const color = up ? "#3ee0a2" : "#ff5d73"
        const x = index * slot + slot / 2
        const bodyTop = y(Math.max(bar.open, bar.close))
        const bodyBot = y(Math.min(bar.open, bar.close))
        return (
          <g key={bar.time}>
            <line x1={x} x2={x} y1={y(bar.high)} y2={y(bar.low)} stroke={color} strokeWidth={1} />
            <rect x={x - Math.max(1, slot * 0.3)} y={bodyTop} width={Math.max(2, slot * 0.6)} height={Math.max(1, bodyBot - bodyTop)} fill={color} />
            {bar.entry != null ? <circle cx={x} cy={y(bar.entry)} r={3.5} fill={bar.entrySide === "short" ? "#ff5d73" : "#3ee0a2"} stroke="#f3e6d6" /> : null}
            {bar.exit != null ? <circle cx={x} cy={y(bar.exit)} r={3.5} fill="#c56a32" stroke="#f3e6d6" /> : null}
          </g>
        )
      })}
    </svg>
  )
}
