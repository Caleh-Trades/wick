import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { fetchPremium, type PremiumQuote } from "@/lib/api"
import { formatClock } from "@/lib/format"
import { logAlert } from "@/lib/journal"
import { useBookView } from "@/lib/use-book"
import type { Venue } from "@/lib/types"
import type { AlertKind, SlotAlert } from "@/lib/workspace"

const KINDS: { id: AlertKind; label: string }[] = [
  { id: "above", label: "Above" },
  { id: "below", label: "Below" },
  { id: "delta", label: "60s delta" },
]

const latched = new Set<string>()

export function FundingQuote({ symbol }: { symbol: string }) {
  const [quote, setQuote] = useState<PremiumQuote | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    let stop = false
    setQuote(null)
    setMissing(false)

    async function load() {
      try {
        const next = await fetchPremium(symbol)
        if (stop) return
        setQuote(next)
        setMissing(false)
      } catch {
        if (stop) return
        setQuote((current) => (current ? { ...current, stale: true } : null))
        setMissing(true)
      }
    }

    void load()
    const timer = window.setInterval(() => void load(), 60_000)
    return () => {
      stop = true
      window.clearInterval(timer)
    }
  }, [symbol])

  if (!quote) {
    return (
      <p className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase" role="status">
        {missing ? "Funding unavailable" : "Funding"}
      </p>
    )
  }

  return (
    <p className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase" role="status">
      Funding {formatFundingRate(quote.rate)}
      {" · next "}
      {formatFundingWhen(quote.nextFundingTime)}
      {quote.stale ? " · stale" : ""}
    </p>
  )
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

function formatFundingWhen(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—"
  const date = new Date(ms)
  const day = date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
  return `${day} ${formatClock(date)} UTC`
}
