import { markReturn } from "@/lib/backtest"
import { formatPrice } from "@/lib/format"
import { pinsOf, positionFor, slotUnsynced, type BookPosition } from "@/lib/desk"
import { useFavourites } from "@/lib/favourites"
import { bestOpenReturn, formatR, gaveBack, openR } from "@/lib/open-trade"
import { SLOTS_MAX, SLOTS_MIN, clampSlots } from "@/lib/panes"
import { marketById } from "@/lib/runs"
import { marketSpec } from "@/lib/markets"
import { timeStopDue } from "@/lib/time-stop"
import { TAPE_STALE_MS } from "@/lib/stale-tape"
import { holdBook, useBookView } from "@/lib/use-book"
import { tapeKey, type Slot } from "@/lib/workspace"
import type { MarketId, Tape, Venue } from "@/lib/types"
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
  tapes,
  giveBack,
  maxBarsOpen,
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
  openTrades: { id: string; exitTime: string | null; side: "long" | "short"; entryTime: string; stop: number | null }[]
  tapes: Record<string, Tape>
  giveBack: number
  maxBarsOpen: number | null
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
                  position={positionFor(positions, symbol, slot.venue)}
                  trade={openTrades.find((trade) => trade.id === positionFor(positions, symbol, slot.venue)?.tradeId) ?? null}
                  bars={tapes[tapeKey({ venue: slot.venue, timeframe: slot.timeframe, range: slot.range, symbol })]?.candles ?? []}
                  giveBack={giveBack}
                  timeframe={slot.timeframe}
                  maxBarsOpen={maxBarsOpen}
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
                position={null}
                trade={null}
                bars={[]}
                giveBack={giveBack}
                timeframe="1d"
                maxBarsOpen={maxBarsOpen}
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
  position,
  trade,
  bars,
  giveBack,
  timeframe,
  maxBarsOpen,
  onClick,
  onFlat,
}: {
  symbol: MarketId
  venue: Venue
  active: boolean
  label: string
  unsynced: boolean
  position: BookPosition | null
  trade: { side: "long" | "short"; entryTime: string; stop: number | null } | null
  bars: Array<{ time: string; high: number; low: number }>
  giveBack: number
  timeframe: string
  maxBarsOpen: number | null
  onClick: () => void
  onFlat: (price: number) => void
}) {
  const book = useBookView(symbol, venue)
  const market = marketById(symbol, venue)
  const tick = marketSpec(symbol, venue)?.tickSize
  const price = book.quote ?? book.last?.price ?? null
  // Book status flips stale after 3 quiet seconds; only badge the rail after 15s so a short gap is not an error wall.
  const stale =
    book.status === "stale" &&
    price != null &&
    (book.heardAt == null || Date.now() - book.heardAt > TAPE_STALE_MS)
  const change = book.changePct
  const stop = position?.stop ?? trade?.stop ?? null
  const mark = position && price != null && stop != null ? openR(position.side, position.entry, stop, price) : null
  const current = position && price != null ? markReturn(position.side, position.entry, price) : null
  const best = position && price != null && trade ? bestOpenReturn(position.side, position.entry, price, bars, trade.entryTime) : current
  const flagged = current != null && best != null && gaveBack(current, best, giveBack)
  const timed = position != null && trade != null && timeStopDue(trade.entryTime, timeframe, maxBarsOpen)
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
          {position && mark != null ? (
            <span className="ml-1 text-foreground" aria-label="Open R">
              {formatR(mark)}
            </span>
          ) : null}
          {timed ? <span className="ml-1 text-foreground normal-case">time</span> : null}
          {position && flagged ? <span className="ml-1 text-down normal-case">give-back</span> : null}
          {position && price != null ? (
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
