import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { marketName, type SpotMarket } from "@/lib/markets"
import { useSpotMarkets } from "@/lib/use-markets"

export function SymbolSelect({
  value,
  onChange,
  id,
  className,
}: {
  value: string
  onChange: (symbol: string) => void
  id?: string
  className?: string
}) {
  const markets = useSpotMarkets()
  const listed = markets.some((market) => market.id === value) ? markets : [fallback(value), ...markets]

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className={className} aria-label="Symbol">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {listed.map((market) => (
          <SelectItem key={market.id} value={market.id}>
            {labelFor(market)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function labelFor(market: SpotMarket): string {
  const name = marketName(market.base)
  return name === market.base ? market.base : `${market.base} · ${name}`
}

function fallback(value: string): SpotMarket {
  return {
    id: value,
    base: value.replace(/USDT$/, "") || value,
    quote: "USDT",
    tickSize: "0.01",
    stepSize: "0.00001",
  }
}
