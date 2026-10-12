import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react"

import { PriceChart } from "@/components/price-chart"
import { OrderBook } from "@/components/order-book"
import { AlertControl, AlertWatch, FundingQuote } from "@/components/slot-tools"
import { formatClock } from "@/lib/format"
import type { ArmGate, RiskMode, SessionLight } from "@/lib/desk"
import type { FundingRate, RangeId, TapeCandle, Trade, Venue } from "@/lib/types"
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
  deltaAlert,
  session,
  riskMode,
  arm,
  onRisk,
  funding,
  fundingStale,
  focusTime,
  reading,
  range,
  onRange,
  onClearFocus,
  onAlert,
  onBookWidth,
  onEnlarge,
  onRetry,
  onArmPrice,
  showBook = true,
  barsPending = true,
  smoothed = false,
  biasBadge = null,
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
  deltaAlert: number | null
  session: SessionLight
  riskMode: RiskMode
  arm: ArmGate | null
  onRisk: (mode: RiskMode) => void
  funding?: FundingRate[] | null
  fundingStale?: boolean
  focusTime?: string | null
  reading?: string[]
  range?: RangeId
  onRange?: (range: RangeId) => void
  onClearFocus?: () => void
  onAlert: (alert: SlotAlert | null) => void
  onBookWidth: (width: number) => void
  onEnlarge: () => void
  onRetry?: () => void
  onArmPrice?: (price: number, mid: number | null) => void
  /** False when the desk draws one book beside the chart and the results. */
  showBook?: boolean
  barsPending?: boolean
  smoothed?: boolean
  biasBadge?: "with trend" | "against" | null
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
    <div className="market-pane flex h-full min-h-0 flex-col">
      <div className="mb-1 flex flex-col gap-1 px-1">
        {showCaption ? (
          <p className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
            {venue === "perp" ? "Kraken perp" : "Binance spot"}
            {" · "}
            Candles {candleClock ? `${formatClock(candleClock)} UTC` : "—"}
            {biasBadge ? ` · ${biasBadge}` : ""}
          </p>
        ) : biasBadge ? (
          <p className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase" role="status">
            Bias {biasBadge}
          </p>
        ) : null}
        {venue === "perp" && symbol ? <FundingQuote rates={funding} stale={fundingStale === true} /> : null}
        <AlertControl
          alert={alert}
          deltaAlert={deltaAlert}
          symbol={symbol}
          venue={venue}
          session={session}
          riskMode={riskMode}
          arm={arm}
          onRisk={onRisk}
          onChange={onAlert}
        />
        {symbol ? <AlertWatch symbol={symbol} venue={venue} alert={alert} deltaAlert={deltaAlert} session={session} /> : null}
      </div>
      <div ref={rowRef} className="chart-book-row flex min-h-0 flex-1 items-stretch">
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
          <PriceChart
            candles={candles}
            trades={trades}
            interval={interval}
            symbol={symbol}
            venue={venue}
            focusTime={focusTime}
            reading={reading}
            range={range}
            onRange={onRange}
            onClearFocus={onClearFocus}
            onEnlarge={onEnlarge}
            pending={barsPending}
            onRetry={onRetry}
            smoothed={smoothed}
          />
        </div>
        {showBook ? (
          <>
            <BookResize book={book} onBookWidth={onBookWidth} />
            <div className="book-column relative flex min-h-0 w-(--book-width) shrink-0 self-stretch" style={{ "--book-width": `${book}px` } as CSSProperties}>
              <div className="absolute inset-0 flex min-h-0 w-full">
                <OrderBook symbol={symbol} venue={venue} onArmPrice={onArmPrice} />
              </div>
            </div>
          </>
        ) : null}
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

/** One book for the focused slot, from the price chart down through the results panel. */
export function BookSpan({
  symbol,
  venue,
  preferred,
  onWidth,
  onArmPrice,
}: {
  symbol: string | null
  venue: Venue
  preferred: number
  onWidth: (width: number) => void
  onArmPrice?: (price: number, mid: number | null) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [padTop, setPadTop] = useState(0)
  const [book, setBook] = useState(preferred)

  useLayoutEffect(() => {
    const node = ref.current
    const stage = node?.parentElement
    if (!node || !stage) return
    const measure = () => {
      const chart = stage.querySelector(".chart-book-row")
      setBook(fitBook(stage.clientWidth, preferred))
      if (!chart) return
      const top = chart.getBoundingClientRect().top - stage.getBoundingClientRect().top
      setPadTop(Math.max(0, Math.round(top)))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(stage)
    const chart = stage.querySelector(".chart-book-row")
    if (chart) observer.observe(chart)
    return () => observer.disconnect()
  }, [preferred])

  return (
    <div ref={ref} className="book-span flex shrink-0 self-stretch pb-3" style={{ width: book + 12, paddingTop: padTop }}>
      <BookResize book={book} onBookWidth={onWidth} />
      <div className="min-h-0 min-w-0 flex-1">
        <OrderBook symbol={symbol} venue={venue} onArmPrice={onArmPrice} />
      </div>
    </div>
  )
}

function BookResize({ book, onBookWidth }: { book: number; onBookWidth: (width: number) => void }) {
  return (
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
