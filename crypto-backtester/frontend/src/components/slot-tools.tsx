import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatStamp } from "@/lib/format"
import { logAlert } from "@/lib/journal"
import { useBookView } from "@/lib/use-book"
import type { FundingRate, Venue } from "@/lib/types"
import type { AlertKind, SlotAlert } from "@/lib/workspace"

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

export function AlertControl({ alert, onChange }: { alert: SlotAlert | null; onChange: (next: SlotAlert | null) => void }) {
  const [kind, setKind] = useState<AlertKind>(alert?.kind ?? "above")
  const [draft, setDraft] = useState(alert ? String(alert.value) : "")

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
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Alert">
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
      {alert ? (
        <Button type="button" size="xs" variant="ghost" className="normal-case tracking-normal" onClick={() => onChange(null)}>
          Clear
        </Button>
      ) : null}
    </div>
  )
}

export function AlertWatch({ symbol, venue, alert }: { symbol: string; venue: Venue; alert: SlotAlert | null }) {
  const book = useBookView(symbol || null, venue)

  useEffect(() => {
    if (!alert || !symbol) return
    const key = `${venue}:${symbol}:${alert.kind}:${alert.value}`
    const price = book.last?.price ?? book.quote
    let hot = false
    let value = 0
    if (alert.kind === "delta") {
      if (book.heardAt == null) return
      value = book.delta
      hot = Math.abs(value) >= alert.value
    } else {
      if (price == null || !(price > 0)) return
      value = price
      hot = alert.kind === "above" ? price >= alert.value : price <= alert.value
    }
    if (!hot) {
      latched.delete(key)
      return
    }
    if (latched.has(key)) return
    latched.add(key)
    logAlert({ symbol, venue, alertKind: alert.kind, value, threshold: alert.value })
  }, [alert, book.delta, book.heardAt, book.last, book.quote, symbol, venue])

  return null
}

function formatFundingRate(rate: number): string {
  const pct = rate * 100
  const sign = pct > 0 ? "+" : ""
  return `${sign}${pct.toFixed(4)}%`
}

