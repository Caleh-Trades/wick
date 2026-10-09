import { useEffect, useState } from "react"

import { SymbolSelect } from "@/components/symbol-select"
import { Button } from "@/components/ui/button"
import { formatClock, formatDay, formatPrice, sourceLabel } from "@/lib/format"
import { RANGES, TIMEFRAMES, barsLabel, marketById, windowNote } from "@/lib/runs"
import type { MarketId, RangeId, Tape, Timeframe } from "@/lib/types"

type DeskBarProps = {
  symbol: MarketId | null
  timeframe: Timeframe
  range: RangeId
  tape: Tape | null
  stale: boolean
  lastFetchAt: Date | null
  onSymbol: (symbol: MarketId) => void
  onTimeframe: (timeframe: Timeframe) => void
  onRange: (range: RangeId) => void
}

export function DeskBar({
  symbol,
  timeframe,
  range,
  tape,
  stale,
  lastFetchAt,
  onSymbol,
  onTimeframe,
  onRange,
}: DeskBarProps) {
  const frame = TIMEFRAMES.find((item) => item.id === timeframe)
  const market = symbol ? marketById(symbol) : undefined
  const last = tape?.candles.at(-1)
  const first = tape?.candles[0]
  const limited = tape ? windowNote(range, tape) : null

  return (
    <header className="bezel sticky top-0 z-30">
      <div className="scan-track" aria-hidden="true">
        <span className="scan-line" />
      </div>
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <CandleMark />
          <h1 className="font-mono text-sm tracking-[0.32em] text-[#f0a36a] uppercase">Wick</h1>
        </div>

        {symbol ? (
          <SymbolSelect value={symbol} className="w-44" onChange={(value) => onSymbol(value)} />
        ) : null}

        <div className="flex shrink-0 gap-1 overflow-x-auto" role="group" aria-label="Timeframe">
          {TIMEFRAMES.map((item) => (
            <Button
              key={item.id}
              type="button"
              size="xs"
              variant={item.id === timeframe ? "default" : "outline"}
              className="normal-case tracking-normal"
              aria-pressed={item.id === timeframe}
              onClick={() => onTimeframe(item.id)}
            >
              {item.label}
            </Button>
          ))}
        </div>

        <div className="flex gap-1" role="group" aria-label="Range">
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

        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
          {tape && last && first ? (
            <>
              <span>{market?.base ?? tape.symbol}</span>
              <span>{sourceLabel(tape.source)}</span>
              <span>{barsLabel(timeframe, tape.candles.length)}</span>
              <span>
                {formatDay(first.time)} – {formatDay(last.time)}
              </span>
              <span className="text-foreground tabular-nums">{formatPrice(last.close)}</span>
              {limited ? <span>{limited}</span> : null}
            </>
          ) : (
            <span>Loading {frame?.label ?? timeframe} bars</span>
          )}
          {lastFetchAt ? <span>Updated {formatClock(lastFetchAt)} UTC</span> : null}
          <LiveClock />
        </div>
      </div>
      {stale ? (
        <p className="mx-auto max-w-[1440px] px-4 pb-3 text-sm text-down" role="status">
          Last poll failed.
          {lastFetchAt ? ` Showing the tape from ${formatClock(lastFetchAt)} UTC.` : " Showing the last good tape."}
        </p>
      ) : null}
    </header>
  )
}

function LiveClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="live-dot" />
      Live {formatClock(now)} UTC
    </span>
  )
}

function CandleMark() {
  return (
    <svg viewBox="0 0 32 32" className="size-6 text-[#f0a36a]" aria-hidden="true">
      <line x1="16" y1="4" x2="16" y2="28" stroke="currentColor" strokeWidth="1" />
      <rect x="12" y="10" width="8" height="12" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}
