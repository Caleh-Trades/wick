import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react"

import { PriceChart } from "@/components/price-chart"
import { OrderBook } from "@/components/order-book"
import { formatClock } from "@/lib/format"
import type { TapeCandle, Trade, Venue } from "@/lib/types"

export function MarketPane({
  symbol,
  candles,
  trades,
  interval,
  venue,
  bookWidth,
  candleClock,
  showCaption,
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
  const book = rowWidth > 0 ? Math.min(bookWidth, Math.max(160, rowWidth - 300)) : bookWidth

  return (
    <div className="flex h-full min-h-0 flex-col">
      {showCaption ? (
        <p className="mb-1 px-1 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
          {venue === "perp" ? "Binance perp" : "Binance spot"}
          {" · "}
          Candles {candleClock ? `${formatClock(candleClock)} UTC` : "—"}
        </p>
      ) : null}
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
