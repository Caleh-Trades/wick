import { useState } from "react"

import { PriceChart } from "@/components/charts"
import { OrderBook } from "@/components/order-book"
import { Button } from "@/components/ui/button"
import type { TapeCandle, Trade } from "@/lib/types"
import { cn } from "@/lib/utils"

export function MarketPane({
  symbol,
  candles,
  trades,
  interval,
  onEnlarge,
}: {
  symbol: string | null
  candles: TapeCandle[]
  trades: Trade[]
  interval: string
  onEnlarge: () => void
}) {
  const [tab, setTab] = useState<"chart" | "book">("chart")

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex gap-1 xl:hidden" role="tablist" aria-label="Chart or book">
        <Button
          type="button"
          size="xs"
          variant={tab === "chart" ? "default" : "outline"}
          className="normal-case tracking-normal"
          role="tab"
          aria-selected={tab === "chart"}
          onClick={() => setTab("chart")}
        >
          Chart
        </Button>
        <Button
          type="button"
          size="xs"
          variant={tab === "book" ? "default" : "outline"}
          className="normal-case tracking-normal"
          role="tab"
          aria-selected={tab === "book"}
          onClick={() => setTab("book")}
        >
          Book
        </Button>
      </div>
      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className={cn("min-h-0", tab === "chart" ? "block" : "hidden xl:block")}>
          <PriceChart candles={candles} trades={trades} interval={interval} onEnlarge={onEnlarge} />
        </div>
        <div className={cn("min-h-0", tab === "book" ? "block" : "hidden xl:block")}>
          <OrderBook symbol={symbol} />
        </div>
      </div>
    </div>
  )
}
