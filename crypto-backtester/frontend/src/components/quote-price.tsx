import { liveMark } from "@/lib/book"
import { formatPrice } from "@/lib/format"
import { marketSpec } from "@/lib/markets"
import { useBookView } from "@/lib/use-book"
import type { Venue } from "@/lib/types"
import { cn } from "@/lib/utils"

export function QuotePrice({ symbol, venue, close }: { symbol: string | null; venue: Venue; close?: number }) {
  const book = useBookView(symbol, venue)
  const matched = book.symbol === (symbol ?? "").toUpperCase() && book.venue === venue
  const mark = matched ? liveMark(book) : null
  const price = mark?.price ?? close
  if (price == null || !Number.isFinite(price)) return null
  const tick = symbol ? marketSpec(symbol, venue)?.tickSize : undefined
  const trade = mark?.source === "trade"
  const mid = mark?.source === "mid"
  return (
    <span
      className={cn(
        "font-mono text-lg font-medium tracking-normal tabular-nums normal-case",
        trade && mark.side === "sell" ? "text-down" : trade && mark.side === "buy" ? "text-up" : "text-foreground",
        trade && mark.changed && (mark.side === "sell" ? "last-tick-down" : "last-tick-up"),
      )}
    >
      {mid ? <span className="align-baseline text-[10px] tracking-wide text-muted-foreground uppercase">MID </span> : null}
      {formatPrice(price, tick)}
    </span>
  )
}
