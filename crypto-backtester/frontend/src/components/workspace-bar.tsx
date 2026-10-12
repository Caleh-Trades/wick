import { Pin, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { pinsOf, slotUnsynced, type BookPosition } from "@/lib/desk"
import { marketById } from "@/lib/runs"
import { useTapeFreshness } from "@/lib/use-tape-freshness"
import { MAX_SLOTS, type Slot } from "@/lib/workspace"
import type { MarketId } from "@/lib/types"
import { cn } from "@/lib/utils"

export function WorkspaceBar({
  slots,
  activeId,
  pinnedId,
  onFocus,
  onPin,
  onClose,
  onAdd,
  onSymbol,
  positions,
  openTrades,
  biasFor,
  candleClockFor,
}: {
  slots: Slot[]
  activeId: string
  pinnedId: string | null
  onFocus: (id: string) => void
  onPin: (id: string) => void
  onClose: (id: string) => void
  onAdd: () => void
  onSymbol: (id: string, symbol: MarketId) => void
  positions: BookPosition[]
  openTrades: { id: string; exitTime: string | null }[]
  /** Higher-timeframe bias badge for the selected run on that slot. */
  biasFor?: (slot: Slot) => "with trend" | "against" | null
  candleClockFor?: (slot: Slot) => Date | null
}) {
  return (
    <nav aria-label="Slots" className="flex w-full min-w-0 items-center gap-1 overflow-x-auto border-b border-border bg-[#fffaf4] px-2 py-1.5">
      {slots.map((slot, index) => (
        <SlotChip
          key={slot.id}
          slot={slot}
          index={index}
          active={slot.id === activeId}
          pinned={slot.id === pinnedId}
          unsynced={pinsOf(slot).some((symbol) => slotUnsynced(symbol, slot.venue, positions, openTrades))}
          bias={biasFor?.(slot) ?? null}
          candleClock={candleClockFor?.(slot) ?? null}
          canClose={slots.length > 1}
          onFocus={onFocus}
          onPin={onPin}
          onClose={onClose}
          onSymbol={onSymbol}
        />
      ))}
      {slots.length < MAX_SLOTS ? (
        <Button type="button" size="xs" variant="outline" className="normal-case tracking-normal" onClick={onAdd}>
          Add slot
        </Button>
      ) : (
        <span className="px-2 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">4 slots</span>
      )}
    </nav>
  )
}

function SlotChip({
  slot,
  index,
  active,
  pinned,
  unsynced,
  bias,
  candleClock,
  canClose,
  onFocus,
  onPin,
  onClose,
  onSymbol,
}: {
  slot: Slot
  index: number
  active: boolean
  pinned: boolean
  unsynced: boolean
  bias: "with trend" | "against" | null
  candleClock: Date | null
  canClose: boolean
  onFocus: (id: string) => void
  onPin: (id: string) => void
  onClose: (id: string) => void
  onSymbol: (id: string, symbol: MarketId) => void
}) {
  const pins = pinsOf(slot)
  const { tapeStale } = useTapeFreshness(slot.symbol, slot.venue, slot.timeframe, candleClock)
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-0.5 border px-1 py-0.5",
        active ? "border-[#c56a32] bg-[#f6e4d2]" : "border-border",
      )}
    >
      <span className="px-1 font-mono text-[11px] tracking-wide uppercase">{index + 1}</span>
      {pins.map((symbol) => {
        const market = marketById(symbol, slot.venue)
        return (
          <button
            key={symbol}
            type="button"
            className={cn(
              "px-1.5 py-1 text-left font-mono text-[11px] tracking-wide uppercase",
              symbol === slot.symbol ? "text-foreground" : "text-muted-foreground",
            )}
            aria-pressed={symbol === slot.symbol}
            onClick={() => {
              onFocus(slot.id)
              onSymbol(slot.id, symbol)
            }}
          >
            {market?.base ?? symbol.replace(/USDT$/, "")}
          </button>
        )
      })}
      <span className="px-1 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
        {slot.venue === "perp" ? "Perp" : "Spot"}
        {unsynced ? " · unsynced" : ""}
        {bias ? ` · ${bias}` : ""}
        {tapeStale ? " · stale" : ""}
      </span>
      <Button
        type="button"
        size="icon-xs"
        variant={pinned ? "default" : "ghost"}
        aria-pressed={pinned}
        aria-label={`Pin ${slot.symbol.replace(/USDT$/, "")} beside the active slot`}
        onClick={() => onPin(slot.id)}
      >
        <Pin />
      </Button>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        aria-label={`Close ${slot.symbol.replace(/USDT$/, "")}`}
        disabled={!canClose}
        onClick={() => onClose(slot.id)}
      >
        <X />
      </Button>
    </div>
  )
}
