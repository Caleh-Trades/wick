import { formatPrice } from "@/lib/format"
import { marketSpec } from "@/lib/markets"
import { useLiveBook } from "@/lib/use-book"
import type { Venue } from "@/lib/types"
import { cn } from "@/lib/utils"

export function QuotePrice({ symbol, venue, close }: { symbol: string | null; venue: Venue; close?: number }) {
  const book = useLiveBook(symbol, venue)
  const last = book.symbol === (symbol ?? "").toUpperCase() && book.venue === venue && book.last ? book.last : null
  const price = last?.price ?? close
  if (price == null || !Number.isFinite(price)) return null
  const tick = symbol ? marketSpec(symbol, venue)?.tickSize : undefined
  return (
    <span
      className={cn(
        "font-mono text-lg font-medium tracking-normal tabular-nums normal-case",
        last ? (last.side === "sell" ? "text-down" : "text-up") : "text-foreground",
        last?.changed && (last.side === "sell" ? "last-tick-down" : "last-tick-up"),
      )}
    >
      {formatPrice(price, tick)}
    </span>
  )
}
