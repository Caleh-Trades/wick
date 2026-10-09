import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatClock, formatDay, formatPrice, sourceLabel } from "@/lib/format"
import { MARKETS, RANGES, TIMEFRAMES, marketById, phraseFor, rangeDays } from "@/lib/runs"
import type { MarketId, RangeId, Tape, Timeframe } from "@/lib/types"

type DeskBarProps = {
  symbol: MarketId | null
  timeframe: Timeframe
  range: RangeId
  tape: Tape | null
  paused: boolean
  stale: boolean
  lastFetchAt: Date | null
  onSymbol: (symbol: MarketId) => void
  onTimeframe: (timeframe: Timeframe) => void
  onRange: (range: RangeId) => void
  onPause: () => void
}

export function DeskBar({
  symbol,
  timeframe,
  range,
  tape,
  paused,
  stale,
  lastFetchAt,
  onSymbol,
  onTimeframe,
  onRange,
  onPause,
}: DeskBarProps) {
  const phrase = phraseFor(tape?.interval ?? timeframe)
  const market = symbol ? marketById(symbol) : undefined
  const last = tape?.candles.at(-1)
  const first = tape?.candles[0]
  const limited = tape ? historyLimited(range, tape) : false

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <CandleMark />
          <h1 className="font-heading text-3xl leading-none">Wick</h1>
        </div>

        {symbol ? (
          <Select value={symbol} onValueChange={(value) => onSymbol(value as MarketId)}>
            <SelectTrigger className="w-40" aria-label="Symbol">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MARKETS.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.base} · {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        <div className="flex gap-1" role="group" aria-label="Timeframe">
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
              <span>{phrase}</span>
              <span>
                {tape.candles.length.toLocaleString("en-US")} {phrase} bars
              </span>
              <span>
                {formatDay(first.time)} – {formatDay(last.time)}
              </span>
              <span className="text-foreground tabular-nums">{formatPrice(last.close)}</span>
              {limited ? <span>History limit</span> : null}
            </>
          ) : (
            <span>Loading {phrase} bars</span>
          )}
          {lastFetchAt ? <span>Updated {formatClock(lastFetchAt)} UTC</span> : null}
          <LiveClock paused={paused} />
          <Button type="button" size="xs" variant="outline" onClick={onPause} aria-pressed={paused}>
            {paused ? "Resume" : "Pause"}
          </Button>
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

function historyLimited(range: RangeId, tape: Tape): boolean {
  const days = rangeDays(range)
  if (days <= 5 || tape.candles.length < 2) return false
  const span = tape.candles[tape.candles.length - 1]!.t - tape.candles[0]!.t
  return span < (days - 2) * 86_400
}

function LiveClock({ paused }: { paused: boolean }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (paused) return
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [paused])
  if (paused) return <span>Paused</span>
  return <span>Live {formatClock(now)} UTC</span>
}

function CandleMark() {
  return (
    <svg viewBox="0 0 32 32" className="size-8 text-foreground" aria-hidden="true">
      <line x1="16" y1="3" x2="16" y2="29" stroke="currentColor" strokeWidth="1.4" />
      <rect x="11" y="9" width="10" height="14" fill="#c9852a" />
    </svg>
  )
}
