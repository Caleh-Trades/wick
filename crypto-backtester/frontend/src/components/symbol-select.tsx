import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { createPortal } from "react-dom"
import { ChevronDown, Star } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { toggleFavourite, useFavourites } from "@/lib/favourites"
import { orderMarkets } from "@/lib/market-search"
import { marketName, type SpotMarket } from "@/lib/markets"
import { useSpotMarkets } from "@/lib/use-markets"
import { cn } from "@/lib/utils"

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
  const panelRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const keyScroll = useRef(false)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [onlyFav, setOnlyFav] = useState(false)
  const [includeTokenized, setIncludeTokenized] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [box, setBox] = useState({ top: 0, left: 0, width: 352, listHeight: 360 })
  const listed = markets.some((market) => market.id === value) ? markets : [fallback(value), ...markets]
  const named = useMemo(
    () => listed.map((market) => ({ ...market, name: displayName(market) })),
    [listed],
  )
  const bases = useMemo(() => new Set(named.map((market) => market.base)), [named])
  const ordered = useMemo(
    () => orderMarkets(named, query, favourites, includeTokenized, bases),
    [named, query, favourites, includeTokenized, bases],
  )
  const pinned = ordered.pinned
  const rest = onlyFav ? [] : ordered.rest
  const flat = useMemo(() => [...pinned, ...rest], [pinned, rest])
  const current = named.find((market) => market.id === value) ?? fallback(value)

  useEffect(() => {
    if (!open) return
    place()
    inputRef.current?.focus({ preventScroll: true })
    const onPointer = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        setOpen(false)
      }
    }
    const onScroll = (event: Event) => {
      const target = event.target
      if (target instanceof Node && panelRef.current?.contains(target)) return
      setOpen(false)
    }
    window.addEventListener("pointerdown", onPointer)
    window.addEventListener("keydown", onKey)
    window.addEventListener("resize", place)
    window.addEventListener("scroll", onScroll, true)
    return () => {
      window.removeEventListener("pointerdown", onPointer)
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("resize", place)
      window.removeEventListener("scroll", onScroll, true)
    }
  }, [open])

  useEffect(() => {
    if (!open || !keyScroll.current) return
    keyScroll.current = false
    const list = document.getElementById(listId)
    const node = document.getElementById(optionId(listId, highlight))
    if (!list || !node) return
    const listRect = list.getBoundingClientRect()
    const rowRect = node.getBoundingClientRect()
    if (rowRect.top < listRect.top) list.scrollBy({ top: rowRect.top - listRect.top, behavior: "smooth" })
    else if (rowRect.bottom > listRect.bottom) list.scrollBy({ top: rowRect.bottom - listRect.bottom, behavior: "smooth" })
  }, [highlight, open, listId])

  function place() {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = Math.max(rect.width, 352)
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
    const top = rect.bottom + 6
    const listHeight = Math.max(180, Math.min(520, window.innerHeight - top - 132))
    setBox({ top, left, width, listHeight })
  }

  function choose(symbol: string) {
    onChange(symbol)
    setQuery("")
    setOpen(false)
  }

  function onSearchKey(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (flat.length === 0) return
      event.preventDefault()
      keyScroll.current = true
      setHighlight((index) => (event.key === "ArrowDown" ? Math.min(flat.length - 1, index + 1) : Math.max(0, index - 1)))
    } else if (event.key === "Enter") {
      event.preventDefault()
      const next = flat[highlight]
      if (next) choose(next.id)
    } else if (event.key === "Escape") {
      event.preventDefault()
      setOpen(false)
    }
  }

  const panel = open ? (
    <div
      ref={panelRef}
      className="bezel fixed z-[80] flex flex-col bg-[#fffaf4] p-3 shadow-xl"
      style={{ top: box.top, left: box.left, width: box.width }}
    >
      <div className="flex items-center gap-1">
        <Input
          ref={inputRef}
          value={query}
          placeholder="Search markets"
          aria-label="Search markets"
          aria-controls={listId}
          aria-activedescendant={flat.length > 0 ? optionId(listId, highlight) : undefined}
          className="h-8 px-2"
          onChange={(event) => {
            setQuery(event.target.value)
            setHighlight(0)
          }}
          onKeyDown={onSearchKey}
        />
        <Button
          type="button"
          size="icon-xs"
          variant={onlyFav ? "default" : "outline"}
          aria-pressed={onlyFav}
          aria-label="Show favourites"
          onClick={() => {
            setOnlyFav((currentOnly) => !currentOnly)
            setHighlight(0)
          }}
        >
          <Star className={onlyFav ? "fill-current" : ""} />
        </Button>
      </div>
      <label className="mt-2 flex items-center gap-2 text-[11px] tracking-wide text-muted-foreground uppercase">
        <input
          type="checkbox"
          className="size-3 accent-[#c56a32]"
          checked={includeTokenized}
          onChange={(event) => {
            setIncludeTokenized(event.target.checked)
            setHighlight(0)
          }}
        />
        Include tokenized stocks
      </label>
      <ul id={listId} role="listbox" aria-label="Markets" className="mt-2 overflow-y-auto" style={{ maxHeight: box.listHeight }}>
        {pinned.length > 0 ? <li className="px-1 pt-1 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">Favourites</li> : null}
        {pinned.map((market, index) => (
          <MarketRow
            key={market.id}
            id={optionId(listId, index)}
            market={market}
            active={market.id === value}
            highlighted={index === highlight}
            favourite
            onChoose={choose}
            onHighlight={() => setHighlight(index)}
          />
        ))}
        {rest.map((market, index) => (
          <MarketRow
            key={market.id}
            id={optionId(listId, pinned.length + index)}
            market={market}
            active={market.id === value}
            highlighted={pinned.length + index === highlight}
            favourite={false}
            onChoose={choose}
            onHighlight={() => setHighlight(pinned.length + index)}
          />
        ))}
        {flat.length === 0 ? (
          <li className="px-1 py-3 text-sm text-muted-foreground">{onlyFav ? "No favourites yet." : "No markets match."}</li>
        ) : null}
      </ul>
    </div>
  ) : null

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
        onClick={() => {
          if (!open) {
            place()
            const index = flat.findIndex((market) => market.id === value)
            setHighlight(index >= 0 ? index : 0)
          }
          setOpen((currentOpen) => !currentOpen)
        }}
      >
        <span className="truncate">{triggerLabel(current)}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
      {panel ? createPortal(panel, document.body) : null}
    </div>
  )
}

function MarketRow({
  id,
  market,
  active,
  highlighted,
  favourite,
  onChoose,
  onHighlight,
}: {
  id: string
  market: SpotMarket
  active: boolean
  highlighted: boolean
  favourite: boolean
  onChoose: (symbol: string) => void
  onHighlight: () => void
}) {
  const name = displayName(market)
  return (
    <li
      id={id}
      className={cn(
        "flex items-center gap-2 border border-transparent px-1",
        highlighted && "border-[#c56a32] bg-[#f6e4d2]",
        active && "text-[#c56a32]",
      )}
    >
      <button
        type="button"
        role="option"
        aria-selected={active}
        className="flex min-w-0 flex-1 items-baseline gap-3 py-1.5 text-left text-sm"
        onMouseEnter={onHighlight}
        onClick={() => onChoose(market.id)}
      >
        {active ? <span aria-hidden="true">●</span> : <span className="inline-block w-[0.6rem]" aria-hidden="true" />}
        <span className="w-16 shrink-0 font-mono">{market.base}</span>
        <span className={cn("min-w-0 flex-1 truncate", active ? "text-[#c56a32]" : "text-muted-foreground")}>{name ?? ""}</span>
        {market.lastPrice ? <span className="shrink-0 font-mono text-xs tabular-nums">{market.lastPrice}</span> : null}
      </button>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        aria-pressed={favourite}
        aria-label={favourite ? `Remove ${market.base} from favourites` : `Favourite ${market.base}`}
        onClick={() => toggleFavourite(market.id)}
      >
        <Star className={favourite ? "fill-[#c56a32] text-[#c56a32]" : ""} />
      </Button>
    </li>
  )
}

function displayName(market: SpotMarket): string | undefined {
  const fromFeed = market.name?.trim()
  if (fromFeed && fromFeed !== market.base) return fromFeed
  const known = marketName(market.base)
  return known !== market.base ? known : undefined
}

function triggerLabel(market: SpotMarket): string {
  const name = displayName(market)
  return name ? `${market.base} · ${name}` : market.base
}

function optionId(listId: string, index: number): string {
  return `${listId}-option-${index}`
}

function fallback(value: string): SpotMarket {
  const base = value.replace(/USDT$/, "") || value
  return { id: value, base, quote: "USDT", tickSize: "0.01", stepSize: "0.00001" }
}
