import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react"

import { PriceChart } from "@/components/price-chart"
import { OrderBook } from "@/components/order-book"
import { AlertControl, AlertWatch, FundingQuote } from "@/components/slot-tools"
import { formatClock } from "@/lib/format"
import type { TapeCandle, Trade, Venue } from "@/lib/types"
import type { SlotAlert } from "@/lib/workspace"

export function MarketPane({
  symbol,
  candles,
  trades,
  interval,
  venue,
  bookWidth,
  candleClock,
  showCaption,
  alert,
  onAlert,
  onBookWidth,
  onEnlarge,
}: {
  symbol: string | null
  candles: TapeCandle[]
  trades: Trade[]
  interval: string
  venue: Venue
  bookWidth: number
  candleClock: Date | null
  showCaption: boolean
  alert: SlotAlert | null
  onAlert: (alert: SlotAlert | null) => void
  onBookWidth: (width: number) => void
  onEnlarge: () => void
}) {
  const rowRef = useRef<HTMLDivElement>(null)
  const [rowWidth, setRowWidth] = useState(0)
  useEffect(() => {
    const node = rowRef.current
    if (!node) return
    const measure = () => setRowWidth(node.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const book = fitBook(rowWidth, bookWidth)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-1 flex flex-col gap-1 px-1">
        {showCaption ? (
          <p className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
            {venue === "perp" ? "Binance perp" : "Binance spot"}
            {" · "}
            Candles {candleClock ? `${formatClock(candleClock)} UTC` : "—"}
          </p>
        ) : null}
        {venue === "perp" && symbol ? <FundingQuote symbol={symbol} /> : null}
        <AlertControl alert={alert} onChange={onAlert} />
        {symbol ? <AlertWatch symbol={symbol} venue={venue} alert={alert} /> : null}
      </div>
      <div ref={rowRef} className="flex min-h-0 flex-1 flex-row">
        <div className="min-h-0 min-w-0 flex-1">
          <PriceChart candles={candles} trades={trades} interval={interval} symbol={symbol} venue={venue} onEnlarge={onEnlarge} />
        </div>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize chart and book"
          aria-valuemin={160}
          aria-valuemax={520}
          aria-valuenow={Math.round(book)}
          tabIndex={0}
          className="relative z-10 hidden w-3 shrink-0 cursor-col-resize items-center md:flex before:absolute before:inset-y-0 before:left-1/2 before:w-px before:bg-border"
          onPointerDown={(event) => dragBook(event, book, onBookWidth)}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") onBookWidth(Math.min(520, book + 16))
            if (event.key === "ArrowRight") onBookWidth(Math.max(160, book - 16))
          }}
        />
        <div className="h-full min-h-0 w-(--book-width) shrink-0" style={{ "--book-width": `${book}px` } as CSSProperties}>
          <OrderBook symbol={symbol} venue={venue} />
        </div>
      </div>
    </div>
  )
}

/** Leave the chart enough room, and keep the ladder wide enough for price, size, total, and notional. */
export function fitBook(rowWidth: number, preferred: number): number {
  if (rowWidth <= 0) return preferred
  const chartFloor = 180
  const bookFloor = 240
  const handle = 12
  const room = rowWidth - chartFloor - handle
  const wanted = Math.min(520, Math.max(bookFloor, preferred))
  if (room >= bookFloor) return Math.min(wanted, room)
  return Math.max(200, rowWidth - 120 - handle)
}

function dragBook(event: ReactPointerEvent<HTMLDivElement>, bookWidth: number, onBookWidth: (width: number) => void) {
  event.currentTarget.setPointerCapture(event.pointerId)
  const startX = event.clientX
  const start = bookWidth
  const move = (ev: PointerEvent) => onBookWidth(Math.min(520, Math.max(160, start - (ev.clientX - startX))))
  const end = () => {
    window.removeEventListener("pointermove", move)
    window.removeEventListener("pointerup", end)
  }
  window.addEventListener("pointermove", move)
  window.addEventListener("pointerup", end)
}
