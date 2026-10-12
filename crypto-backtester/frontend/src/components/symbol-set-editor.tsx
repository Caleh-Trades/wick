import { X } from "lucide-react"

import { SymbolSelect } from "@/components/symbol-select"
import { Button } from "@/components/ui/button"
import { addSymbol, removeSymbol, SYMBOL_SET_CAP } from "@/lib/symbol-set"
import type { MarketId, Venue } from "@/lib/types"

export function SymbolSetEditor({
  symbols,
  venue,
  onChange,
  label = "Markets",
  cap = SYMBOL_SET_CAP,
}: {
  symbols: MarketId[]
  venue: Venue
  onChange: (symbols: MarketId[]) => void
  label?: string
  cap?: number
}) {
  const full = symbols.length >= cap
  return (
    <div className="bezel flex flex-col gap-3 p-3" aria-label={label}>
      <div className="flex flex-wrap items-center gap-2">
        {symbols.map((symbol) => (
          <span key={symbol} className="inline-flex items-center gap-1 border border-border px-2 py-1 font-mono text-[11px] tracking-wide uppercase">
            {symbol.replace(/USDT$/, "")}
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label={`Remove ${symbol.replace(/USDT$/, "")}`}
              disabled={symbols.length <= 1}
              onClick={() => onChange(removeSymbol(symbols, symbol))}
            >
              <X />
            </Button>
          </span>
        ))}
        {!full ? (
          <div className="min-w-40 flex-1 sm:max-w-56">
            <SymbolSelect
              value=""
              venue={venue}
              emptyLabel="Add market"
              onChange={(next) => onChange(addSymbol(symbols, next, cap))}
            />
          </div>
        ) : (
          <p className="font-mono text-[11px] text-muted-foreground">{cap} markets max</p>
        )}
      </div>
      <p className="font-mono text-[11px] text-muted-foreground tabular-nums">
        {symbols.length} of {cap}
      </p>
    </div>
  )
}
