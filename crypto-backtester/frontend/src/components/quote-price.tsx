import { stepDecimals } from "@/lib/book"
import { formatPrice } from "@/lib/format"
import { marketSpec } from "@/lib/markets"
import { useLiveBook } from "@/lib/use-book"
import { cn } from "@/lib/utils"

export function QuotePrice({ symbol, close }: { symbol: string | null; close?: number }) {
  const book = useLiveBook(symbol)
  const last = book.symbol && book.last ? book.last : null
  const price = last?.price ?? close
  if (price == null || !Number.isFinite(price)) return null
  const tick = symbol ? marketSpec(symbol)?.tickSize : undefined
  return (
    <span
      className={cn(
        "font-mono text-lg font-medium tracking-normal tabular-nums normal-case",
        last ? (last.side === "sell" ? "text-down" : "text-up") : "text-foreground",
        last?.changed && (last.side === "sell" ? "last-tick-down" : "last-tick-up"),
      )}
    >
      {tick ? formatTick(price, tick) : formatPrice(price)}
    </span>
  )
}

function formatTick(value: number, tick: string): string {
  const digits = stepDecimals(tick)
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}
