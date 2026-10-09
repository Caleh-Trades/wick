import { formatClock } from "@/lib/format"
import { stepDecimals } from "@/lib/book"
import { marketSpec } from "@/lib/markets"
import { useLiveBook, type BookStatus } from "@/lib/use-book"
import type { Level } from "@/lib/book"
import { cn } from "@/lib/utils"

export function OrderBook({ symbol }: { symbol: string | null }) {
  const book = useLiveBook(symbol)
  const spec = symbol ? marketSpec(symbol) : undefined
  const tick = spec?.tickSize ?? "0.01"
  const step = spec?.stepSize ?? "0.00001"
  const rows = [...book.asks, ...book.bids]
  const scale = rows.reduce((max, level) => Math.max(max, level.total), 0)
  const showLadder = book.status === "connected" && book.asks.length > 0 && book.bids.length > 0

  return (
    <section className="bezel grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)_auto_minmax(0,1fr)_5.5rem] gap-1 overflow-hidden p-3" aria-label="Order book">
      <header className="mb-2 flex items-center justify-between gap-2">
        <h3 className="font-heading text-lg">Book</h3>
        <p className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-wide text-muted-foreground uppercase" role="status">
          <span
            className="size-1.5 rounded-full"
            style={{ background: book.status === "connected" ? "#e6c36a" : book.status === "stale" ? "#e07856" : "#c4a48c" }}
          />
          <StatusLabel status={book.status} asOf={book.asOf} />
        </p>
      </header>

      {showLadder ? (
        <>
          <LevelHead />
          <div className="flex min-h-0 flex-col-reverse overflow-y-auto">
            {[...book.asks].reverse().map((level) => (
              <LevelRow key={`ask-${level.priceKey}`} level={level} scale={scale} tone="ask" tick={tick} step={step} best={level === book.asks.at(-1)} />
            ))}
          </div>
          <MidRow book={book} tick={tick} />
          <div className="min-h-0 overflow-y-auto">
            {book.bids.map((level) => (
              <LevelRow key={`bid-${level.priceKey}`} level={level} scale={scale} tone="bid" tick={tick} step={step} best={level === book.bids[0]} />
            ))}
          </div>
        </>
      ) : (
        <p className="row-span-4 px-1 py-6 text-sm text-muted-foreground">
          {book.status === "stale"
            ? book.asOf
              ? `Book stale ${formatClock(new Date(book.asOf))} UTC.`
              : "Book stale. No ladder yet."
            : "Waiting for the book."}
        </p>
      )}

      <div className="flex min-h-0 flex-col overflow-hidden border-t border-border pt-1">
        <DeltaRow delta={book.delta} buy={book.buy} sell={book.sell} step={step} />
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
                <span className="text-right">{formatStep(print.price, tick)}</span>
                <span className="text-right">{formatStep(print.size, step)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  )
}

function StatusLabel({ status, asOf }: { status: BookStatus; asOf: number | null }) {
  if (status === "connected") return <span>Connected</span>
  if (status === "stale") return <span>{asOf ? `Stale ${formatClock(new Date(asOf))} UTC` : "Stale"}</span>
  return <span>Connecting</span>
}

function MidRow({ book, tick }: { book: ReturnType<typeof useLiveBook>; tick: string }) {
  const last = book.last
  return (
    <div className="my-1 grid grid-cols-3 gap-2 border-y border-border px-1 py-1.5 font-mono text-[11px]">
      <span>
        <span className="block text-[10px] tracking-wide text-muted-foreground uppercase">Last</span>
        <span className={cn(last?.side === "sell" ? "text-down" : "text-up", last?.changed && (last.side === "sell" ? "last-tick-down" : "last-tick-up"))}>
          {last ? formatStep(last.price, tick) : "—"}
        </span>
      </span>
      <span className="text-center">
        <span className="block text-[10px] tracking-wide text-muted-foreground uppercase">Spread</span>
        <span className="text-muted-foreground">{book.spread == null ? "—" : formatStep(book.spread, tick)}</span>
      </span>
      <span className="text-right">
        <span className="block text-[10px] tracking-wide text-muted-foreground uppercase">Mid</span>
        <span>{book.mid == null ? "—" : formatStep(book.mid, tick)}</span>
      </span>
    </div>
  )
}

function DeltaRow({ delta, buy, sell, step }: { delta: number; buy: number; sell: number; step: string }) {
  const total = buy + sell
  const sellWidth = total > 0 ? (sell / total) * 50 : 0
  const buyWidth = total > 0 ? (buy / total) * 50 : 0
  const marker = total > 0 ? 50 + (50 * (buy - sell)) / total : 50
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 font-mono text-[11px]">
        <span className="tracking-wide text-muted-foreground uppercase">60s delta</span>
        <span className={delta > 0 ? "text-up" : delta < 0 ? "text-down" : "text-foreground"}>{signedStep(delta, step)}</span>
      </div>
      <div className="relative h-2 bg-[#16110d]" aria-hidden="true">
        <div className="absolute inset-y-0 right-1/2 bg-[#e07856]/70" style={{ width: `${sellWidth}%` }} />
        <div className="absolute inset-y-0 left-1/2 bg-[#e6c36a]/70" style={{ width: `${buyWidth}%` }} />
        <div className="absolute -top-0.5 h-3 w-px bg-[#f6eadc]" style={{ left: `${marker}%` }} />
      </div>
    </div>
  )
}

function LevelHead() {
  return (
    <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-1 pb-1 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
      <span>Price</span>
      <span className="w-16 text-right">Size</span>
      <span className="w-16 text-right">Total</span>
    </div>
  )
}

function LevelRow({
  level,
  scale,
  tone,
  tick,
  step,
  best,
}: {
  level: Level
  scale: number
  tone: "bid" | "ask"
  tick: string
  step: string
  best: boolean
}) {
  const width = scale > 0 ? Math.min(100, (level.total / scale) * 100) : 0
  return (
    <div
      className={cn(
        "book-row relative border border-transparent px-1 py-0.5 font-mono text-[11px] text-foreground transition-[border-color] duration-150",
        best && "border-[#f0a36a]",
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
      <div className="relative grid grid-cols-[1fr_auto_auto] gap-2">
        <span className={tone === "bid" ? "text-up" : "text-down"}>{formatStep(level.price, tick)}</span>
        <span className="w-16 text-right">{formatStep(level.size, step)}</span>
        <span className="w-16 text-right text-muted-foreground">{formatStep(level.total, step)}</span>
      </div>
    </div>
  )
}

function formatStep(value: number, step: string): string {
  const digits = stepDecimals(step)
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function signedStep(value: number, step: string): string {
  if (!Number.isFinite(value) || value === 0) return formatStep(0, step)
  const body = formatStep(Math.abs(value), step)
  return value > 0 ? `+${body}` : `-${body}`
}
