import { Pin, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { marketById } from "@/lib/runs"
import { MAX_SLOTS, type Slot } from "@/lib/workspace"
import { cn } from "@/lib/utils"

export function WorkspaceBar({
  slots,
  activeId,
  pinnedId,
  onFocus,
  onPin,
  onClose,
  onAdd,
}: {
  slots: Slot[]
  activeId: string
  pinnedId: string | null
  onFocus: (id: string) => void
  onPin: (id: string) => void
  onClose: (id: string) => void
  onAdd: () => void
}) {
  return (
    <nav aria-label="Slots" className="flex w-full min-w-0 items-center gap-1 overflow-x-auto border-b border-border bg-[#fffaf4] px-2 py-1.5">
      {slots.map((slot, index) => {
        const market = marketById(slot.symbol, slot.venue)
        const active = slot.id === activeId
        const pinned = slot.id === pinnedId
        return (
          <div
            key={slot.id}
            className={cn(
              "flex shrink-0 items-center gap-0.5 border px-1 py-0.5",
              active ? "border-[#c56a32] bg-[#f6e4d2]" : "border-border",
            )}
          >
            <button
              type="button"
              className="px-1.5 py-1 text-left font-mono text-[11px] tracking-wide uppercase"
              aria-pressed={active}
              onClick={() => onFocus(slot.id)}
            >
              {index + 1} {market?.base ?? slot.symbol} · {slot.venue === "perp" ? "Perp" : "Spot"}
            </button>
            <Button
              type="button"
              size="icon-xs"
              variant={pinned ? "default" : "ghost"}
              aria-pressed={pinned}
              aria-label={`Pin ${market?.base ?? slot.symbol} beside the active slot`}
              onClick={() => onPin(slot.id)}
            >
              <Pin />
            </Button>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label={`Close ${market?.base ?? slot.symbol}`}
              disabled={slots.length <= 1}
              onClick={() => onClose(slot.id)}
            >
              <X />
            </Button>
          </div>
        )
      })}
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
