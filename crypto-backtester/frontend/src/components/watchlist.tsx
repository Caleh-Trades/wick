import { formatPrice } from "@/lib/format"
import { pinsOf, positionFor, slotUnsynced, type BookPosition } from "@/lib/desk"
import { useFavourites } from "@/lib/favourites"
import { SLOTS_MAX, SLOTS_MIN, clampSlots } from "@/lib/panes"
import { marketById } from "@/lib/runs"
import { marketSpec } from "@/lib/markets"
import { holdBook, useBookView } from "@/lib/use-book"
import type { Slot } from "@/lib/workspace"
import type { MarketId, Venue } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useEffect, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react"

export function Watchlist({
  slots,
  activeId,
  width,
  onWidth,
  onFocus,
  onOpen,
  onSymbol,
  onFlat,
  positions,
  openTrades,
}: {
  slots: Slot[]
  activeId: string
  width: number
  onWidth: (width: number) => void
  onFocus: (id: string) => void
  onOpen: (symbol: MarketId, venue: Venue) => void
  onSymbol: (id: string, symbol: MarketId) => void
  onFlat: (symbol: string, venue: Venue, price: number) => void
  positions: BookPosition[]
  openTrades: { id: string; exitTime: string | null }[]
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
    <aside
      className="relative flex w-full shrink-0 flex-row overflow-x-auto border-b border-border bg-[#fffaf4] max-lg:max-h-28 lg:h-full lg:w-(--slots-width) lg:flex-col lg:overflow-y-auto lg:overflow-x-hidden lg:border-r lg:border-b-0"
      style={{ "--slots-width": `${width}px` } as CSSProperties}
      aria-label="Watchlist"
    >
      <p className="px-2 pt-2 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">Slots</p>
      <ul className="flex min-h-0 flex-1 lg:block lg:overflow-y-auto">
        {slots.map((slot) => (
          <li key={slot.id} className="shrink-0 lg:shrink">
            <div className={cn("px-2 py-1.5", slot.id === activeId && "bg-[#f6e4d2]")}>
              {pinsOf(slot).map((symbol) => (
                <QuoteRow
                  key={symbol}
                  symbol={symbol}
                  venue={slot.venue}
                  active={symbol === slot.symbol}
                  label={slot.venue === "perp" ? "Perp" : "Spot"}
                  unsynced={slotUnsynced(symbol, slot.venue, positions, openTrades)}
                  positioned={positionFor(positions, symbol, slot.venue) != null}
                  onClick={() => {
                    onFocus(slot.id)
                    onSymbol(slot.id, symbol)
                  }}
                  onFlat={(price) => onFlat(symbol, slot.venue, price)}
                />
              ))}
            </div>
          </li>
        ))}
        {extra.length > 0 ? (
          <li className="px-2 pt-3 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">Favourites</li>
        ) : null}
        {extra.map((id) => (
          <li key={id} className="shrink-0 lg:shrink">
            <div className="px-2 py-1.5">
              <QuoteRow
                symbol={id as MarketId}
                venue="spot"
                active={false}
                label="Spot"
                unsynced={false}
                positioned={false}
                onClick={() => onOpen(id as MarketId, "spot")}
                onFlat={() => undefined}
              />
            </div>
          </li>
        ))}
      </ul>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the slots"
        aria-valuemin={SLOTS_MIN}
        aria-valuemax={SLOTS_MAX}
        aria-valuenow={Math.round(width)}
        tabIndex={0}
        className="absolute inset-y-0 right-0 z-10 hidden w-3 cursor-col-resize lg:block"
        onPointerDown={(event) => dragSlots(event, width, onWidth)}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") onWidth(clampSlots(width - 16))
          if (event.key === "ArrowRight") onWidth(clampSlots(width + 16))
        }}
      />
    </aside>
  )
}

function QuoteRow({
  symbol,
  venue,
  active,
  label,
  unsynced,
  positioned,
  onClick,
  onFlat,
}: {
  symbol: MarketId
  venue: Venue
  active: boolean
  label: string
  unsynced: boolean
  positioned: boolean
  onClick: () => void
  onFlat: (price: number) => void
}) {
  const book = useBookView(symbol, venue)
  const market = marketById(symbol, venue)
  const tick = marketSpec(symbol, venue)?.tickSize
  const price = book.quote ?? book.last?.price ?? null
  const stale = book.status === "stale" && price != null
  const change = book.changePct
  return (
    <div className="flex w-full min-w-0 flex-col gap-0.5 overflow-hidden text-left">
      <span className="flex min-w-0 items-baseline justify-between gap-2">
        <button type="button" className={cn("min-w-0 truncate text-left font-mono text-xs", active && "text-foreground")} onClick={onClick}>
          {market?.base ?? symbol.replace(/USDT$/, "")}
        </button>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground uppercase">
          {label}
          {unsynced ? " · unsynced" : ""}
        </span>
      </span>
      <span className="flex min-w-0 items-baseline justify-between gap-2 font-mono text-[11px] tabular-nums">
        <span className="min-w-0 truncate">{price == null ? "—" : formatPrice(price, tick)}</span>
        <span className={cn("shrink-0", change == null ? "text-muted-foreground" : change > 0 ? "text-up" : change < 0 ? "text-down" : "text-muted-foreground")}>
          {change == null ? "—" : `${change > 0 ? "+" : ""}${change.toFixed(2)}%`}
          {stale ? " · stale" : ""}
          {positioned && price != null ? (
            <button type="button" className="ml-1 uppercase" onClick={() => onFlat(price)}>
              Flat
            </button>
          ) : null}
        </span>
      </span>
    </div>
  )
}

function dragSlots(event: ReactPointerEvent<HTMLDivElement>, width: number, onWidth: (width: number) => void) {
  event.currentTarget.setPointerCapture(event.pointerId)
  const startX = event.clientX
  const start = width
  const move = (ev: PointerEvent) => onWidth(clampSlots(start + (ev.clientX - startX)))
  const end = () => {
    window.removeEventListener("pointermove", move)
    window.removeEventListener("pointerup", end)
  }
  window.addEventListener("pointermove", move)
  window.addEventListener("pointerup", end)
}
