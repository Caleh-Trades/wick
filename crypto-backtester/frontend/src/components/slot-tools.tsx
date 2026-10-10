import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { liveMark } from "@/lib/book"
import { formatCompact, formatPrice, formatStamp } from "@/lib/format"
import { logAlert } from "@/lib/journal"
import { marketSpec } from "@/lib/markets"
import { useBookView } from "@/lib/use-book"
import type { FundingRate, Venue } from "@/lib/types"
import { armReading, deltaCrosses, priceCrosses, type AlertKind, type SlotAlert } from "@/lib/workspace"
import { cn } from "@/lib/utils"

const KINDS: { id: AlertKind; label: string }[] = [
  { id: "above", label: "Above" },
  { id: "below", label: "Below" },
  { id: "delta", label: "60s delta" },
]

const latched = new Set<string>()

export function FundingQuote({ rates, stale }: { rates: FundingRate[] | null | undefined; stale: boolean }) {
  const last = latestRate(rates)
  if (!last) {
    return (
      <p className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase" role="status">
        {stale ? "Funding didn't load." : "Funding"}
      </p>
    )
  }

  return (
    <p className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase" role="status">
      Funding {formatFundingRate(last.rate)}
      {" · "}
      {formatStamp(new Date(last.t * 1000).toISOString(), "1m")} UTC
      {stale ? " · stale" : ""}
    </p>
  )
}

function latestRate(rates: FundingRate[] | null | undefined): FundingRate | null {
  if (!rates || rates.length === 0) return null
  let best = rates[0]!
  for (const rate of rates) {
    if (rate.t >= best.t) best = rate
  }
  return Number.isFinite(best.rate) ? best : null
}

export function AlertControl({
  alert,
  deltaAlert,
  symbol,
  venue,
  onChange,
}: {
  alert: SlotAlert | null
  deltaAlert: number | null
  symbol: string | null
  venue: Venue
  onChange: (next: SlotAlert | null) => void
}) {
  const [kind, setKind] = useState<AlertKind>(alert?.kind ?? "above")
  const [draft, setDraft] = useState(alert ? String(alert.value) : "")
  const book = useBookView(symbol, venue)
  const mark = symbol && book.symbol === symbol.toUpperCase() && book.venue === venue ? liveMark(book) : null
  const trade = mark?.source === "trade" ? mark.price : null
  const reading = armReading({
    alert,
    deltaAlert,
    trade,
    delta: book.delta,
    heard: book.heardAt != null,
  })
  const tick = symbol ? marketSpec(symbol, venue)?.tickSize : undefined
  const priceLevel = reading.price != null ? formatPrice(reading.price, tick) : null
  const deltaLevel = reading.delta != null ? `60s ${formatCompact(reading.delta)}` : null
  const watched = (reading.hot ? [priceLevel, deltaLevel] : [reading.priceKind && priceLevel ? `${reading.priceKind} ${priceLevel}` : null, deltaLevel])
    .filter(Boolean)
    .join(" · ")
  const status = reading.hot ? `fired ${reading.side}${watched ? ` · ${watched}` : ""}` : watched ? `idle · ${watched}` : "idle"

  useEffect(() => {
    setKind(alert?.kind ?? "above")
    setDraft(alert ? String(alert.value) : "")
  }, [alert])

  function arm() {
    const value = Number(draft)
    if (!(value > 0)) return
    onChange({ kind, value })
  }

  return (
    <div className="flex flex-nowrap items-center gap-1 overflow-x-auto" role="group" aria-label="Alert">
      {KINDS.map((item) => (
        <Button
          key={item.id}
          type="button"
          size="xs"
          variant={kind === item.id ? "default" : "outline"}
          className="normal-case tracking-normal"
          aria-pressed={kind === item.id}
          onClick={() => setKind(item.id)}
        >
          {item.label}
        </Button>
      ))}
      <Input
        aria-label="Alert threshold"
        inputMode="decimal"
        value={draft}
        className="h-7 w-24 px-1 text-xs"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") arm()
        }}
      />
      <Button type="button" size="xs" variant="outline" className="normal-case tracking-normal" onClick={arm}>
        Arm
      </Button>
      <span className={cn("font-mono text-[10px] tracking-wide whitespace-nowrap normal-case", reading.hot ? "text-foreground" : "text-muted-foreground")} role="status">
        {status}
      </span>
      {alert ? (
        <Button type="button" size="xs" variant="ghost" className="normal-case tracking-normal" onClick={() => onChange(null)}>
          Clear
        </Button>
      ) : null}
    </div>
  )
}

export function AlertWatch({
  symbol,
  venue,
  alert,
  deltaAlert,
}: {
  symbol: string
  venue: Venue
  alert: SlotAlert | null
  deltaAlert: number | null
}) {
  const book = useBookView(symbol || null, venue)
  const mark = book.symbol === symbol.toUpperCase() && book.venue === venue ? liveMark(book) : null
  const trade = mark?.source === "trade" ? mark.price : null

  useEffect(() => {
    if (!symbol) return
    const checks: { key: string; hot: boolean; kind: AlertKind; value: number; threshold: number }[] = []
    if (alert && alert.kind !== "delta") {
      checks.push({
        key: `${venue}:${symbol}:${alert.kind}:${alert.value}`,
        hot: priceCrosses(trade, alert),
        kind: alert.kind,
        value: trade ?? 0,
        threshold: alert.value,
      })
    }
    const thresholds = new Set<number>()
    if (alert?.kind === "delta") thresholds.add(alert.value)
    if (deltaAlert != null && deltaAlert > 0) thresholds.add(deltaAlert)
    for (const threshold of thresholds) {
      checks.push({
        key: `${venue}:${symbol}:delta:${threshold}`,
        hot: book.heardAt != null && deltaCrosses(book.delta, threshold),
        kind: "delta",
        value: book.delta,
        threshold,
      })
    }
    for (const check of checks) {
      if (!check.hot) {
        latched.delete(check.key)
        continue
      }
      if (latched.has(check.key)) continue
      latched.add(check.key)
      logAlert({ symbol, venue, alertKind: check.kind, value: check.value, threshold: check.threshold })
    }
  }, [alert, book.delta, book.heardAt, deltaAlert, symbol, trade, venue])

  return null
}

function formatFundingRate(rate: number): string {
  const pct = rate * 100
  const sign = pct > 0 ? "+" : ""
  return `${sign}${pct.toFixed(4)}%`
}

