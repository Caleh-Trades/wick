import { formatClock, formatPrice, formatSize } from "@/lib/format"
import { depthScale, useBook, type BookStatus } from "@/lib/use-book"
import type { Level } from "@/lib/book"
import { cn } from "@/lib/utils"

export function OrderBook({ symbol }: { symbol: string | null }) {
  const book = useBook(symbol)
  const scale = depthScale([...book.asks, ...book.bids])
  const bestAsk = book.asks.at(-1)?.price
  const bestBid = book.bids[0]?.price

  return (
    <section className="bezel flex h-full min-h-0 flex-col p-3" aria-label="Order book">
      <header className="mb-2 flex shrink-0 items-center justify-between gap-2">
        <h3 className="font-heading text-lg">Book</h3>
        <BookStatusLine status={book.status} asOf={book.asOf} symbol={symbol} />
      </header>

      {book.status === "unsupported" ? (
        <p className="text-sm text-muted-foreground">The book is Coinbase spot for BTC-USD and ETH-USD.</p>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <LevelHead />
            {book.asks.length === 0 && book.bids.length === 0 ? (
              <p className="px-1 py-6 text-sm text-muted-foreground">
                {book.status === "stale" ? "No book arrived before the socket dropped." : "Waiting for the Coinbase book."}
              </p>
            ) : (
              <>
                {book.asks.map((level) => (
                  <LevelRow
                    key={`ask-${level.price}`}
                    level={level}
                    scale={scale}
                    tone="ask"
                    best={level.price === bestAsk}
                  />
                ))}
                <div className="my-1 flex items-center justify-between gap-3 border-y border-border px-1 py-1.5 font-mono text-[11px] text-foreground">
                  <span>
                    <span className="text-muted-foreground">Spread </span>
                    {book.spread == null ? "—" : formatPrice(book.spread)}
                  </span>
                  <span>
                    <span className="text-muted-foreground">Mid </span>
                    {book.mid == null ? "—" : formatPrice(book.mid)}
                  </span>
                </div>
                {book.bids.map((level) => (
                  <LevelRow
                    key={`bid-${level.price}`}
                    level={level}
                    scale={scale}
                    tone="bid"
                    best={level.price === bestBid}
                  />
                ))}
              </>
            )}
          </div>

          <div className="mt-3 shrink-0 border-t border-border pt-2">
            <div className="mb-2 flex items-baseline justify-between gap-3 font-mono text-[11px]">
              <span className="tracking-wide text-muted-foreground uppercase">60s delta</span>
              <span className={book.delta > 0 ? "text-up" : book.delta < 0 ? "text-down" : "text-foreground"}>
                {signedSize(book.delta)}
              </span>
            </div>
            <div className="max-h-36 overflow-y-auto" aria-label="Trade tape">
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
                    )}
                  >
                    <span>{formatClock(new Date(print.t))}</span>
                    <span>{print.side === "buy" ? "Buy lift" : "Sell hit"}</span>
                    <span className="text-right">{formatPrice(print.price)}</span>
                    <span className="text-right">{formatSize(print.size)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </section>
  )
}

function BookStatusLine({ status, asOf, symbol }: { status: BookStatus; asOf: number | null; symbol: string | null }) {
  if (status === "unsupported") return null
  const live = status === "live"
  const label =
    status === "live"
      ? "Book live"
      : status === "connecting"
        ? "Book connecting"
        : asOf
          ? `Book stale ${formatClock(new Date(asOf))} UTC`
          : "Book stale"
  return (
    <p className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-wide text-muted-foreground uppercase" role="status">
      <span
        className="size-1.5 rounded-full"
        style={{ background: live ? "#3ee0a2" : status === "stale" ? "#ff5d73" : "#7f97a3" }}
      />
      <span>{symbol}</span>
      <span>{label}</span>
    </p>
  )
}

function LevelHead() {
  return (
    <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-1 pb-1 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
      <span>Price</span>
      <span className="w-16 text-right">Size</span>
      <span className="w-16 text-right">Cum</span>
    </div>
  )
}

function LevelRow({
  level,
  scale,
  tone,
  best,
}: {
  level: Level
  scale: number
  tone: "bid" | "ask"
  best: boolean
}) {
  const width = scale > 0 ? Math.min(100, (level.size / scale) * 100) : 0
  return (
    <div
      className={cn(
        "book-row relative border border-transparent px-1 py-0.5 font-mono text-[11px] text-foreground transition-[border-color] duration-150",
        best && "border-[#39e7ff]",
      )}
    >
      <div
        className="pointer-events-none absolute inset-y-0 left-0"
        style={{
          width: `${width}%`,
          background: tone === "bid" ? "rgb(62 224 162 / 0.16)" : "rgb(255 93 115 / 0.16)",
        }}
      />
      <div className="relative grid grid-cols-[1fr_auto_auto] gap-2">
        <span className={tone === "bid" ? "text-up" : "text-down"}>{formatPrice(level.price)}</span>
        <span className="w-16 text-right">{formatSize(level.size)}</span>
        <span className="w-16 text-right text-muted-foreground">{formatSize(level.cum)}</span>
      </div>
    </div>
  )
}

function signedSize(value: number): string {
  if (!Number.isFinite(value)) return "—"
  if (value === 0) return "0"
  const body = formatSize(Math.abs(value))
  return value > 0 ? `+${body}` : `-${body}`
}
