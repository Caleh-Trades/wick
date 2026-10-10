import { formatPrice } from "@/lib/format"
import { useFavourites } from "@/lib/favourites"
import { marketById } from "@/lib/runs"
import { marketSpec } from "@/lib/markets"
import { holdBook, useBookView } from "@/lib/use-book"
import type { Slot } from "@/lib/workspace"
import type { MarketId, Venue } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useEffect } from "react"

export function Watchlist({
  slots,
  activeId,
  onFocus,
  onOpen,
}: {
  slots: Slot[]
  activeId: string
  onFocus: (id: string) => void
  onOpen: (symbol: MarketId, venue: Venue) => void
}) {
  const favourites = useFavourites()
  const covered = new Set(slots.map((slot) => slot.symbol))
  const extra = favourites.filter((id) => !covered.has(id as MarketId))

  useEffect(() => {
    const release = extra.map((id) => holdBook(id, "spot", false))
    return () => {
      for (const stop of release) stop()
    }
  }, [extra.join("|")])

  return (
    <aside className="flex w-full shrink-0 flex-row overflow-x-auto border-b border-border bg-[#fffaf4] max-lg:max-h-28 lg:h-full lg:w-[200px] lg:flex-col lg:overflow-y-auto lg:border-r lg:border-b-0" aria-label="Watchlist">
      <p className="px-2 pt-2 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">Slots</p>
      <ul className="flex min-h-0 flex-1 lg:block lg:overflow-y-auto">
        {slots.map((slot) => (
          <li key={slot.id} className="shrink-0 lg:shrink">
            <QuoteRow
              symbol={slot.symbol}
              venue={slot.venue}
              active={slot.id === activeId}
              label={slot.venue === "perp" ? "Perp" : "Spot"}
              onClick={() => onFocus(slot.id)}
            />
          </li>
        ))}
        {extra.length > 0 ? (
          <li className="px-2 pt-3 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">Favourites</li>
        ) : null}
        {extra.map((id) => (
          <li key={id} className="shrink-0 lg:shrink">
            <QuoteRow
              symbol={id as MarketId}
              venue="spot"
              active={false}
              label="Spot"
              onClick={() => onOpen(id as MarketId, "spot")}
            />
          </li>
        ))}
      </ul>
    </aside>
  )
}

function QuoteRow({
  symbol,
  venue,
  active,
  label,
  onClick,
}: {
  symbol: MarketId
  venue: Venue
  active: boolean
  label: string
  onClick: () => void
}) {
  const book = useBookView(symbol, venue)
  const market = marketById(symbol, venue)
  const tick = marketSpec(symbol, venue)?.tickSize
  const price = book.quote ?? book.last?.price ?? null
  const stale = book.status === "stale" && price != null
  const change = book.changePct
  return (
    <button
      type="button"
      className={cn("flex w-full flex-col gap-0.5 px-2 py-1.5 text-left", active && "bg-[#f6e4d2]")}
      onClick={onClick}
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-xs">{market?.base ?? symbol.replace(/USDT$/, "")}</span>
        <span className="font-mono text-[10px] text-muted-foreground uppercase">{label}</span>
      </span>
      <span className="flex items-baseline justify-between gap-2 font-mono text-[11px] tabular-nums">
        <span>{price == null ? "—" : formatPrice(price, tick)}</span>
        <span className={change == null ? "text-muted-foreground" : change > 0 ? "text-up" : change < 0 ? "text-down" : "text-muted-foreground"}>
          {change == null ? "—" : `${change > 0 ? "+" : ""}${change.toFixed(2)}%`}
          {stale ? " · stale" : ""}
        </span>
      </span>
    </button>
  )
}
