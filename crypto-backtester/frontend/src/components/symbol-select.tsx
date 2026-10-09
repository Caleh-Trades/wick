import { useEffect, useId, useRef, useState } from "react"
import { ChevronDown, Star } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { toggleFavourite, useFavourites } from "@/lib/favourites"
import { marketName, type SpotMarket } from "@/lib/markets"
import { useSpotMarkets } from "@/lib/use-markets"
import { cn } from "@/lib/utils"

const REST_LIMIT = 60

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
  const favourites = useFavourites()
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [onlyFav, setOnlyFav] = useState(false)
  const [box, setBox] = useState({ top: 0, left: 0, width: 288 })
  const listed = markets.some((market) => market.id === value) ? markets : [fallback(value), ...markets]
  const current = listed.find((market) => market.id === value) ?? fallback(value)
  const favouriteIds = new Set(favourites)
  const needle = query.trim().toLowerCase()
  const matched = listed.filter((market) => {
    if (onlyFav && !favouriteIds.has(market.id)) return false
    if (!needle) return true
    const name = marketName(market.base).toLowerCase()
    return market.base.toLowerCase().includes(needle) || name.includes(needle) || market.id.toLowerCase().includes(needle)
  })
  const pinned = matched.filter((market) => favouriteIds.has(market.id))
  const rest = matched.filter((market) => !favouriteIds.has(market.id))
  const visibleRest = onlyFav ? [] : rest.slice(0, REST_LIMIT)
  const hidden = onlyFav ? 0 : rest.length - visibleRest.length

  useEffect(() => {
    if (!open) return
    place()
    inputRef.current?.focus()
    const onPointer = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && rootRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    window.addEventListener("pointerdown", onPointer)
    window.addEventListener("keydown", onKey)
    window.addEventListener("resize", place)
    window.addEventListener("scroll", place, true)
    return () => {
      window.removeEventListener("pointerdown", onPointer)
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("resize", place)
      window.removeEventListener("scroll", place, true)
    }
  }, [open])

  function place() {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    setBox({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 288) })
  }

  function choose(symbol: string) {
    onChange(symbol)
    setQuery("")
    setOpen(false)
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        className="flex h-10 w-full items-center justify-between gap-2 border-b border-input bg-transparent text-left text-sm"
        aria-label="Symbol"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((currentOpen) => !currentOpen)}
      >
        <span className="truncate">{labelFor(current)}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
      {open ? (
        <div
          className="bezel fixed z-50 bg-[#0e1522] p-2"
          style={{ top: box.top, left: box.left, width: box.width }}
        >
          <div className="flex items-center gap-1">
            <Input
              ref={inputRef}
              value={query}
              placeholder="Search markets"
              aria-label="Search markets"
              className="h-8 px-2"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return
                event.preventDefault()
                const next = pinned[0] ?? visibleRest[0]
                if (next) choose(next.id)
              }}
            />
            <Button
              type="button"
              size="icon-xs"
              variant={onlyFav ? "default" : "outline"}
              aria-pressed={onlyFav}
              aria-label="Show favourites"
              onClick={() => setOnlyFav((currentOnly) => !currentOnly)}
            >
              <Star className={onlyFav ? "fill-current" : ""} />
            </Button>
          </div>
          <ul id={listId} role="listbox" aria-label="Markets" className="mt-2 max-h-72 overflow-y-auto">
            {pinned.length > 0 ? <li className="px-1 pt-1 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">Favourites</li> : null}
            {pinned.map((market) => (
              <MarketRow key={market.id} market={market} selected={market.id === value} favourite onChoose={choose} />
            ))}
            {visibleRest.map((market) => (
              <MarketRow key={market.id} market={market} selected={market.id === value} favourite={false} onChoose={choose} />
            ))}
            {pinned.length + visibleRest.length === 0 ? (
              <li className="px-1 py-3 text-sm text-muted-foreground">
                {onlyFav ? "No favourites yet. Star a market to keep it here." : "No markets match."}
              </li>
            ) : null}
            {hidden > 0 ? (
              <li className="px-1 py-2 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
                {hidden.toLocaleString("en-US")} more. Search to narrow.
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function MarketRow({
  market,
  selected,
  favourite,
  onChoose,
}: {
  market: SpotMarket
  selected: boolean
  favourite: boolean
  onChoose: (symbol: string) => void
}) {
  return (
    <li className="flex items-center gap-1 border border-transparent hover:border-[#39e7ff]">
      <button
        type="button"
        role="option"
        aria-selected={selected}
        className={cn("min-w-0 flex-1 truncate px-1 py-1.5 text-left text-sm", selected && "text-[#39e7ff]")}
        onClick={() => onChoose(market.id)}
      >
        {labelFor(market)}
      </button>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        aria-pressed={favourite}
        aria-label={favourite ? `Remove ${market.base} from favourites` : `Favourite ${market.base}`}
        onClick={() => toggleFavourite(market.id)}
      >
        <Star className={favourite ? "fill-[#39e7ff] text-[#39e7ff]" : ""} />
      </Button>
    </li>
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
