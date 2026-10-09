import { useEffect, useState, type ReactNode } from "react"
import { Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatPrice, formatStamp } from "@/lib/format"
import { journalEntries, logTrade, removeJournalEntry, watchJournal, type JournalSide } from "@/lib/journal"
import { cn } from "@/lib/utils"

export function JournalToggle({ symbol, children }: { symbol: string; children: ReactNode }) {
  const [place, setPlace] = useState<"results" | "journal">("results")
  return (
    <div className="results-body flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 gap-1" role="tablist" aria-label="Results or journal">
        <Button
          type="button"
          size="xs"
          variant={place === "results" ? "default" : "outline"}
          className="normal-case tracking-normal"
          role="tab"
          aria-selected={place === "results"}
          onClick={() => setPlace("results")}
        >
          Results
        </Button>
        <Button
          type="button"
          size="xs"
          variant={place === "journal" ? "default" : "outline"}
          className="normal-case tracking-normal"
          role="tab"
          aria-selected={place === "journal"}
          onClick={() => setPlace("journal")}
        >
          Journal
        </Button>
      </div>
      {place === "journal" ? <TradeJournal symbol={symbol} /> : <div className="min-h-0 flex-1">{children}</div>}
    </div>
  )
}

function TradeJournal({ symbol }: { symbol: string }) {
  const [entries, setEntries] = useState(journalEntries)
  const [market, setMarket] = useState(symbol)
  const [side, setSide] = useState<JournalSide>("buy")
  const [price, setPrice] = useState("")
  const [size, setSize] = useState("")
  const [note, setNote] = useState("")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => watchJournal(() => setEntries(journalEntries())), [])
  useEffect(() => setMarket(symbol), [symbol])

  function submit() {
    const logged = logTrade({ symbol: market, side, price: Number(price), size: Number(size), note })
    if (!logged) {
      setError("A trade needs a symbol, a price, and a size.")
      return
    }
    setError(null)
    setSize("")
    setNote("")
  }

  return (
    <div className="bezel flex min-h-72 min-w-0 flex-1 flex-col overflow-hidden p-3">
      <p className="font-mono text-xs text-muted-foreground uppercase">Trade journal</p>
      <p className="mt-1 text-sm text-muted-foreground">Log a fill here. A bot with a key can send the same fill with log-trade.</p>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="journal-symbol">Symbol</Label>
          <Input id="journal-symbol" value={market} maxLength={20} onChange={(event) => setMarket(event.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Side</span>
          <div className="flex gap-1" role="group" aria-label="Side">
            {(["buy", "sell"] as const).map((item) => (
              <Button
                key={item}
                type="button"
                size="xs"
                variant={side === item ? "default" : "outline"}
                className="normal-case tracking-normal"
                aria-pressed={side === item}
                onClick={() => setSide(item)}
              >
                {item === "buy" ? "Buy" : "Sell"}
              </Button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="journal-price">Price</Label>
          <Input id="journal-price" inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="journal-size">Size</Label>
          <Input id="journal-size" inputMode="decimal" value={size} onChange={(event) => setSize(event.target.value)} />
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Label htmlFor="journal-note">Note</Label>
          <Input id="journal-note" value={note} maxLength={280} placeholder="Why this fill" onChange={(event) => setNote(event.target.value)} />
        </div>
        <Button type="button" onClick={submit}>
          Log trade
        </Button>
      </div>
      {error ? <p className="mt-2 text-sm text-down">{error}</p> : null}
      {entries.length === 0 ? (
        <p className="mt-4 border-t border-border py-6 text-sm text-muted-foreground">No fills yet. Log one above, or let a bot send it.</p>
      ) : (
        <ul className="mt-4 min-h-0 flex-1 overflow-x-hidden overflow-y-auto border-t border-border">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-start justify-between gap-3 border-b border-border py-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-2">
                  <Badge variant={entry.side === "buy" ? "default" : "secondary"}>{entry.side === "buy" ? "Buy" : "Sell"}</Badge>
                  <span className="text-sm">{entry.symbol.replace(/USDT$/, "")}</span>
                  <span className={cn("font-mono text-xs tabular-nums", entry.side === "buy" ? "text-up" : "text-down")}>
                    {formatPrice(entry.price)} × {entry.size}
                  </span>
                </div>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">{formatStamp(entry.time, "1m")}</p>
                {entry.note ? <p className="mt-1 text-sm break-words">{entry.note}</p> : null}
              </div>
              <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove ${entry.symbol} ${entry.side}`} onClick={() => removeJournalEntry(entry.id)}>
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
