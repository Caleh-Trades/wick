import { useEffect, useMemo, useState } from "react"
import { Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatMoney, formatPlainPct, formatPrice, formatSize, formatStamp } from "@/lib/format"
import { journalEntries, journalStats, logTrade, removeJournalEntry, tradePnl, watchJournal, type JournalEntry, type JournalSide } from "@/lib/journal"
import { RULES } from "@/lib/runs"
import { cn } from "@/lib/utils"

export function JournalPage({ symbol }: { symbol: string }) {
  const [entries, setEntries] = useState(journalEntries)
  const [market, setMarket] = useState(symbol)
  const [side, setSide] = useState<JournalSide>("buy")
  const [strategy, setStrategy] = useState("none")
  const [price, setPrice] = useState("")
  const [exitPrice, setExitPrice] = useState("")
  const [size, setSize] = useState("")
  const [note, setNote] = useState("")
  const [error, setError] = useState<string | null>(null)
  const stats = useMemo(() => journalStats(entries), [entries])

  useEffect(() => watchJournal(() => setEntries(journalEntries())), [])
  useEffect(() => setMarket(symbol), [symbol])

  function submit() {
    const exitRaw = exitPrice.trim()
    let exit: number | null = null
    if (exitRaw) {
      exit = Number(exitRaw)
      if (!(exit > 0)) {
        setError("Exit price has to be above zero, or leave it blank while the trade is open.")
        return
      }
    }
    const logged = logTrade({
      symbol: market,
      side,
      price: Number(price),
      size: Number(size),
      strategy: strategy === "none" ? "" : strategy,
      exitPrice: exit,
      note,
    })
    if (!logged) {
      setError("A trade needs a symbol, an entry price, and a size.")
      return
    }
    setError(null)
    setExitPrice("")
    setSize("")
    setNote("")
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-4 px-4 py-4 pb-16">
        <div>
          <h2 className="font-mono text-xs tracking-[0.28em] text-[#c56a32] uppercase">Journal</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Round trips you took, or a bot logged. P&amp;L is the exit minus the entry, times size, and flipped for a sell. A blank exit stays open.
          </p>
        </div>

        <section className="bezel grid grid-cols-2 gap-px overflow-hidden sm:grid-cols-3 lg:grid-cols-6" aria-label="Journal totals">
          <Stat label="P&L" value={signedMoney(stats.pnl)} toneName={moneyTone(stats.pnl)} />
          <Stat label="Win rate" value={stats.closed ? formatPlainPct(stats.winRate, 0) : "—"} />
          <Stat label="Closed" value={String(stats.closed)} />
          <Stat label="Open" value={String(stats.open)} />
          <Stat label="Profit factor" value={formatFactor(stats.profitFactor)} />
          <Stat label="Average trade" value={stats.average == null ? "—" : signedMoney(stats.average)} toneName={stats.average == null ? "ink" : moneyTone(stats.average)} />
        </section>

        {stats.strategies.length > 0 ? (
          <section aria-label="By strategy">
            <p className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">By strategy</p>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {stats.strategies.map((row) => (
                <li key={row.name} className="bezel px-3 py-2">
                  <p className="text-sm">{row.name}</p>
                  <p className="mt-1 flex flex-wrap gap-x-3 font-mono text-[11px] text-muted-foreground tabular-nums">
                    <span>
                      {row.trades} closed · {row.trades ? Math.round((row.wins / row.trades) * 100) : 0}% wins
                    </span>
                    <span className={cn(moneyTone(row.pnl) === "up" && "text-up", moneyTone(row.pnl) === "down" && "text-down")}>{signedMoney(row.pnl)}</span>
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <form
          className="bezel p-3"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <p className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">Log a trade</p>
          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
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
            <div className="col-span-2 flex flex-col gap-1">
              <Label htmlFor="journal-strategy">Strategy</Label>
              <Select value={strategy} onValueChange={setStrategy}>
                <SelectTrigger id="journal-strategy" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No strategy</SelectItem>
                  {RULES.map((rule) => (
                    <SelectItem key={rule.id} value={rule.id}>
                      {rule.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="journal-price">Entry</Label>
              <Input id="journal-price" inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="journal-exit">Exit</Label>
              <Input id="journal-exit" inputMode="decimal" value={exitPrice} placeholder="Open" onChange={(event) => setExitPrice(event.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="journal-size">Size</Label>
              <Input id="journal-size" inputMode="decimal" value={size} onChange={(event) => setSize(event.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="journal-note">Note</Label>
              <Input id="journal-note" value={note} maxLength={280} placeholder="Why this trade" onChange={(event) => setNote(event.target.value)} />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button type="submit">Log trade</Button>
            {error ? <p className="text-sm text-down">{error}</p> : null}
          </div>
        </form>

        {entries.length === 0 ? (
          <p className="bezel px-4 py-8 text-sm text-muted-foreground">No trades yet. Log one above, or let a bot send it with log-trade.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {entries.map((entry) => (
              <TradeRow key={entry.id} entry={entry} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function TradeRow({ entry }: { entry: JournalEntry }) {
  const pnl = tradePnl(entry)
  const notional = entry.price * entry.size
  const returned = pnl != null && notional > 0 ? (pnl / notional) * 100 : null
  const base = entry.symbol.replace(/USDT$/, "")
  return (
    <li className="bezel flex items-start justify-between gap-3 px-3 py-2">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <Badge variant={entry.side === "buy" ? "default" : "secondary"}>{entry.side === "buy" ? "Buy" : "Sell"}</Badge>
          <span className="text-sm">{base}</span>
          {entry.strategy ? <span className="text-sm text-muted-foreground">{entry.strategy}</span> : null}
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {formatPrice(entry.price)}
            {entry.exitPrice != null ? ` → ${formatPrice(entry.exitPrice)}` : " · open"} × {formatSize(entry.size)}
          </span>
          {pnl == null ? (
            <span className="font-mono text-xs text-muted-foreground">Open</span>
          ) : (
            <span className={cn("font-mono text-xs tabular-nums", moneyTone(pnl) === "up" && "text-up", moneyTone(pnl) === "down" && "text-down")}>
              {signedMoney(pnl)}
              {returned != null ? ` · ${formatPlainPct(returned, 1)}` : ""}
            </span>
          )}
        </div>
        <p className="mt-1 font-mono text-[11px] text-muted-foreground">{formatStamp(entry.time, "1m")}</p>
        {entry.note ? <p className="mt-1 text-sm break-words">{entry.note}</p> : null}
      </div>
      <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove ${base} ${entry.side}`} onClick={() => removeJournalEntry(entry.id)}>
        <Trash2 />
      </Button>
    </li>
  )
}

function Stat({ label, value, toneName = "ink" }: { label: string; value: string; toneName?: "up" | "down" | "ink" }) {
  return (
    <div className="bg-[#fffaf4] px-3 py-3">
      <p className="text-[0.65rem] font-semibold tracking-[0.16em] text-muted-foreground uppercase">{label}</p>
      <p className={cn("mt-1 font-mono text-lg tabular-nums", toneName === "up" && "text-up", toneName === "down" && "text-down")}>{value}</p>
    </div>
  )
}

function signedMoney(value: number): string {
  const text = formatMoney(Math.abs(value), 2)
  if (value > 0) return `+${text}`
  if (value < 0) return `-${text}`
  return text
}

function moneyTone(value: number): "up" | "down" | "ink" {
  if (value > 0) return "up"
  if (value < 0) return "down"
  return "ink"
}

function formatFactor(value: number | null): string {
  if (value == null) return "—"
  if (!Number.isFinite(value)) return "∞"
  return value.toFixed(2)
}
