import { useEffect, useRef } from "react"

import { formatBookSize, formatClock, formatCompact, formatPrice } from "@/lib/format"
import { marketSpec } from "@/lib/markets"
import { useLiveBook, type BookStatus, type LiveView } from "@/lib/use-book"
import type { Level } from "@/lib/book"
import type { Venue } from "@/lib/types"
import { cn } from "@/lib/utils"

export function OrderBook({ symbol, venue }: { symbol: string | null; venue: Venue }) {
  const book = useLiveBook(symbol, venue)
  const spec = symbol ? marketSpec(symbol, venue) : undefined
  const tick = spec?.tickSize
  const rows = [...book.asks, ...book.bids]
  const scale = rows.reduce((max, level) => Math.max(max, level.price * level.size), 0)
  const showLadder = book.asks.length > 0 && book.bids.length > 0
  const asksRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = asksRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [book.asks, book.heardAt, showLadder])

  return (
    <section className="bezel grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)_auto_minmax(0,1fr)_5.5rem] gap-1 overflow-hidden p-3" aria-label="Order book">
      <header className="mb-2 flex items-center justify-between gap-2">
        <h3 className="font-heading text-lg">Book</h3>
        <p className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-wide text-muted-foreground uppercase" role="status">
          <span
            className="size-1.5 rounded-full"
            style={{ background: book.status === "connected" ? "#e6c36a" : book.status === "stale" ? "#e07856" : "#8d6b56" }}
          />
          <StatusLabel status={book.status} heardAt={book.heardAt} />
        </p>
      </header>

      {showLadder ? (
        <>
          <LevelHead />
          <div ref={asksRef} className="flex min-h-0 flex-col justify-end overflow-y-auto">
            {book.asks.map((level) => (
              <LevelRow key={`ask-${level.priceKey}`} level={level} scale={scale} tone="ask" tick={tick} best={level === book.asks.at(-1)} />
            ))}
          </div>
          <MidRow book={book} tick={tick} />
          <div className="min-h-0 overflow-y-auto">
            {book.bids.map((level) => (
              <LevelRow key={`bid-${level.priceKey}`} level={level} scale={scale} tone="bid" tick={tick} best={level === book.bids[0]} />
            ))}
          </div>
        </>
      ) : (
        <p className="row-span-4 px-1 py-6 text-sm text-muted-foreground">
          {book.status === "stale"
            ? book.heardAt
              ? `Book stale ${formatClock(new Date(book.heardAt))} UTC.`
              : "Book stale. No ladder yet."
            : "Waiting for the book."}
        </p>
      )}

      <div className="flex min-h-0 flex-col overflow-hidden border-t border-border pt-1">
        <DeltaRow delta={book.delta} buy={book.buy} sell={book.sell} />
        <div className="mt-1 min-h-0 flex-1 overflow-y-auto" aria-label="Trade tape">
          <div className="mb-1 grid grid-cols-[3.6rem_4rem_minmax(0,1fr)_auto] gap-2 px-1 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
            <span>Time</span>
            <span>Side</span>
            <span className="text-right">Price</span>
            <span className="text-right">Size</span>
          </div>
          {book.prints.length === 0 ? (
            <p className="px-1 py-2 text-sm text-muted-foreground">No prints yet.</p>
          ) : (
            book.prints.map((print) => (
              <div
                key={print.id}
                className={cn(
                  "book-row grid grid-cols-[3.6rem_4rem_minmax(0,1fr)_auto] gap-2 border border-transparent px-1 py-0.5 font-mono text-[11px] transition-[border-color] duration-150",
                  print.side === "buy" ? "text-up" : "text-down",
                  book.freshIds.includes(print.id) && "tape-in",
                )}
              >
                <span>{formatClock(new Date(print.t))}</span>
                <span>{print.side === "buy" ? "Buy lift" : "Sell hit"}</span>
                <span className="text-right">{formatPrice(print.price, tick)}</span>
                <span className="text-right">{formatCompact(print.size)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  )
}

function StatusLabel({ status, heardAt }: { status: BookStatus; heardAt: number | null }) {
  const clock = heardAt ? `Book ${formatClock(new Date(heardAt))} UTC` : "Book"
  if (status === "connected") return <span>{clock}</span>
  if (status === "stale") return <span>{heardAt ? `${clock} · Stale` : "Stale"}</span>
  return <span>Connecting</span>
}

function MidRow({ book, tick }: { book: LiveView; tick?: string }) {
  const last = book.last
  return (
    <div className="my-1 grid grid-cols-3 gap-2 border-y border-border px-1 py-1.5 font-mono text-[11px]">
      <span>
        <span className="block text-[10px] tracking-wide text-muted-foreground uppercase">Last</span>
        <span className={cn(last?.side === "sell" ? "text-down" : "text-up", last?.changed && (last.side === "sell" ? "last-tick-down" : "last-tick-up"))}>
          {last ? formatPrice(last.price, tick) : "—"}
        </span>
      </span>
      <span className="text-center">
        <span className="block text-[10px] tracking-wide text-muted-foreground uppercase">Spread</span>
        <span className="text-muted-foreground">{book.spread == null ? "—" : formatPrice(book.spread, tick)}</span>
      </span>
      <span className="text-right">
        <span className="block text-[10px] tracking-wide text-muted-foreground uppercase">Mid</span>
        <span>{book.mid == null ? "—" : formatPrice(book.mid, tick)}</span>
      </span>
    </div>
  )
}

function DeltaRow({ delta, buy, sell }: { delta: number; buy: number; sell: number }) {
  const total = buy + sell
  const sellWidth = total > 0 ? (sell / total) * 50 : 0
  const buyWidth = total > 0 ? (buy / total) * 50 : 0
  const marker = total > 0 ? 50 + (50 * (buy - sell)) / total : 50
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 font-mono text-[11px]">
        <span className="tracking-wide text-muted-foreground uppercase">60s delta</span>
        <span className={delta > 0 ? "text-up" : delta < 0 ? "text-down" : "text-foreground"}>
          {delta > 0 ? "+" : ""}
          {formatCompact(delta)}
        </span>
      </div>
      <div className="relative h-2 bg-[#f3e6d6]" aria-hidden="true">
        <div className="absolute inset-y-0 right-1/2 bg-[#ff5d73]/70" style={{ width: `${sellWidth}%` }} />
        <div className="absolute inset-y-0 left-1/2 bg-[#3ee0a2]/70" style={{ width: `${buyWidth}%` }} />
        <div className="absolute -top-0.5 h-3 w-px bg-[#3c2a22]" style={{ left: `${marker}%` }} />
      </div>
    </div>
  )
}

const LEVEL_GRID = "grid-cols-[minmax(0,1.35fr)_minmax(3.2rem,0.8fr)_minmax(3.4rem,0.9fr)_minmax(3.4rem,0.9fr)]"

function LevelHead() {
  return (
    <div className={cn("grid gap-1.5 px-1 pb-1 font-mono text-[10px] tracking-wide text-muted-foreground uppercase", LEVEL_GRID)}>
      <span>Price</span>
      <span className="text-right">Size</span>
      <span className="text-right">Total</span>
      <span className="text-right">Notional</span>
    </div>
  )
}

function LevelRow({
  level,
  scale,
  tone,
  tick,
  best,
}: {
  level: Level
  scale: number
  tone: "bid" | "ask"
  tick?: string
  best: boolean
}) {
  const notional = level.price * level.size
  const width = scale > 0 ? Math.min(100, (notional / scale) * 100) : 0
  return (
    <div
      className={cn(
        "book-row relative border border-transparent px-1 py-0.5 font-mono text-[11px] text-foreground transition-[border-color] duration-150",
        best && "border-[#c56a32]",
        level.changed && (tone === "bid" ? "book-flash-bid" : "book-flash-ask"),
      )}
    >
      <div
        className="depth-bar pointer-events-none absolute inset-y-0 left-0"
        style={{
          width: `${width}%`,
          background: tone === "bid" ? "rgb(62 224 162 / 0.16)" : "rgb(255 93 115 / 0.16)",
        }}
      />
      <div className={cn("relative grid gap-1.5", LEVEL_GRID)}>
        <span className={cn("truncate", tone === "bid" ? "text-up" : "text-down")}>{formatPrice(level.price, tick)}</span>
        <span className="text-right tabular-nums">{formatBookSize(level.size)}</span>
        <span className="text-right text-muted-foreground tabular-nums">{formatBookSize(level.total)}</span>
        <span className="text-right text-muted-foreground tabular-nums">{formatCompact(notional)}</span>
      </div>
    </div>
  )
}
