import { useEffect, useMemo, useState } from "react"

import { Input } from "@/components/ui/input"
import type { DeskPage } from "@/components/desk-bar"
import { getMarkets } from "@/lib/markets"
import { matchRank, orderMarkets } from "@/lib/market-search"
import type { MarketId, Venue } from "@/lib/types"
import { cn } from "@/lib/utils"

const PAGE_ITEMS: Array<[DeskPage, string]> = [
  ["desk", "Desk"],
  ["journal", "Journal"],
  ["saved", "Saved"],
  ["windows", "Windows"],
  ["replay", "Replay"],
  ["paper", "Paper"],
  ["cross", "Cross"],
  ["correlation", "Correlation"],
  ["diff", "Diff"],
]

type CommandPaletteProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  venue: Venue
  onPage: (page: DeskPage) => void
  onSymbol: (symbol: MarketId) => void
  onKeep: () => void
  canKeep: boolean
}

type Row =
  | { id: string; kind: "page"; label: string; page: DeskPage }
  | { id: string; kind: "symbol"; label: string; detail: string; symbol: MarketId }
  | { id: string; kind: "action"; label: string; detail: string; run: () => void; disabled?: boolean }

/** One shortcut opens Pages, symbol search, and Keep this run. Not a new page. */
export function CommandPalette({ open, onOpenChange, venue, onPage, onSymbol, onKeep, canKeep }: CommandPaletteProps) {
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const markets = useMemo(() => getMarkets(venue), [venue])
  const bases = useMemo(() => new Set(markets.map((market) => market.base)), [markets])

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const list: Row[] = []
    for (const [page, label] of PAGE_ITEMS) {
      if (!needle || label.toLowerCase().includes(needle) || page.includes(needle)) {
        list.push({ id: `page-${page}`, kind: "page", label, page })
      }
    }
    if (!needle || "keep this run".includes(needle) || "keep".startsWith(needle)) {
      list.push({
        id: "keep",
        kind: "action",
        label: "Keep this run",
        detail: canKeep ? "Save the active run to Saved" : "Run the desk first",
        disabled: !canKeep,
        run: onKeep,
      })
    }
    if (needle) {
      const { pinned, rest } = orderMarkets(markets, needle, [], false, bases)
      for (const market of [...pinned, ...rest].slice(0, 12)) {
        if (matchRank(market.base, market.name, needle) == null) continue
        list.push({
          id: `sym-${market.id}`,
          kind: "symbol",
          label: market.base,
          detail: market.name || market.id,
          symbol: market.id,
        })
      }
    }
    return list
  }, [bases, canKeep, markets, onKeep, query])

  useEffect(() => {
    if (!open) {
      setQuery("")
      setActive(0)
      return
    }
    setActive(0)
  }, [open, query])

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault()
        onOpenChange(false)
        return
      }
      if (event.key === "ArrowDown") {
        event.preventDefault()
        setActive((current) => Math.min(rows.length - 1, current + 1))
        return
      }
      if (event.key === "ArrowUp") {
        event.preventDefault()
        setActive((current) => Math.max(0, current - 1))
        return
      }
      if (event.key === "Enter") {
        event.preventDefault()
        const row = rows[active]
        if (row) pick(row)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [active, onOpenChange, open, rows])

  if (!open) return null

  function pick(row: Row) {
    if (row.kind === "page") {
      onPage(row.page)
      onOpenChange(false)
      return
    }
    if (row.kind === "symbol") {
      onSymbol(row.symbol)
      onOpenChange(false)
      return
    }
    if (row.disabled) return
    row.run()
    onOpenChange(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 px-4 pt-[12vh]" role="presentation" onMouseDown={() => onOpenChange(false)}>
      <div
        role="dialog"
        aria-label="Command palette"
        aria-modal="true"
        className="bezel w-full max-w-lg overflow-hidden shadow-lg"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="border-b border-border px-3 py-2">
          <Input
            autoFocus
            value={query}
            placeholder="Pages, symbol, Keep this run"
            aria-label="Command search"
            className="border-0 shadow-none focus-visible:ring-0"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <ul className="max-h-80 overflow-y-auto py-1" role="listbox">
          {rows.length === 0 ? (
            <li className="px-3 py-3 text-sm text-muted-foreground">No matches.</li>
          ) : (
            rows.map((row, index) => (
              <li key={row.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  disabled={row.kind === "action" && row.disabled}
                  className={cn(
                    "flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm",
                    index === active ? "bg-[#f6e4d2]" : "hover:bg-[#fff4e8]",
                    row.kind === "action" && row.disabled && "opacity-50",
                  )}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => pick(row)}
                >
                  <span>{row.label}</span>
                  <span className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
                    {row.kind === "page" ? "Page" : row.kind === "symbol" ? row.detail : row.detail}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
        <p className="border-t border-border px-3 py-1.5 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
          ↑↓ enter · esc · ⌘K
        </p>
      </div>
    </div>
  )
}

export function commandPaletteHotkey(event: KeyboardEvent): boolean {
  return (event.key === "k" || event.key === "K") && (event.metaKey || event.ctrlKey) && !event.altKey
}
