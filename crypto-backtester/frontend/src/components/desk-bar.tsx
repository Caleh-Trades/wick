import { useEffect, useId, useRef, useState } from "react"
import { ChevronDown } from "lucide-react"

import { AccountSheet } from "@/components/account-sheet"
import { BotSettings } from "@/components/bot-settings"
import type { AccountSession } from "@/lib/account"
import { SymbolSelect } from "@/components/symbol-select"
import { Button } from "@/components/ui/button"
import { liveMark } from "@/lib/book"
import { formatClock, formatDay, formatPrice } from "@/lib/format"
import { useBookView } from "@/lib/use-book"
import { missingBars } from "@/lib/plot"
import { TIMEFRAMES, barsLabel, marketById, windowNote } from "@/lib/runs"
import type { SessionLight } from "@/lib/desk"

export type DeskPage = "desk" | "journal" | "windows" | "replay" | "paper" | "correlation" | "cross" | "diff"
import type { MarketId, RangeId, Tape, Timeframe, Venue } from "@/lib/types"

const PAGE_ITEMS: Array<[DeskPage, string]> = [
  ["journal", "Journal"],
  ["windows", "Windows"],
  ["replay", "Replay"],
  ["paper", "Paper"],
  ["cross", "Cross"],
  ["diff", "Diff"],
]

type DeskBarProps = {
  symbol: MarketId | null
  timeframe: Timeframe
  range: RangeId
  venue: Venue
  tape: Tape | null
  loading: boolean
  stale: boolean
  lastFetchAt: Date | null
  session: SessionLight
  onSession: () => void
  onSymbol: (symbol: MarketId) => void
  onTimeframe: (timeframe: Timeframe) => void
  onVenue: (venue: Venue) => void
  page: DeskPage
  onPage: (page: DeskPage) => void
  lossCount: number
  lossLimit: number
  lossHalted: boolean
  onClearHalt: () => void
  showCorrelation: boolean
  accountSession: AccountSession | null
  accountStatus: string
  onCreateAccount: (name: string, password: string) => Promise<void>
  onSignInAccount: (name: string, password: string) => Promise<void>
  onSignOutAccount: () => Promise<void>
}

export function DeskBar({
  symbol,
  timeframe,
  range,
  venue,
  tape,
  loading,
  stale,
  lastFetchAt,
  session,
  onSession,
  onSymbol,
  onTimeframe,
  onVenue,
  page,
  onPage,
  lossCount,
  lossLimit,
  lossHalted,
  onClearHalt,
  showCorrelation,
  accountSession,
  accountStatus,
  onCreateAccount,
  onSignInAccount,
  onSignOutAccount,
}: DeskBarProps) {
  const frame = TIMEFRAMES.find((item) => item.id === timeframe)
  const market = symbol ? marketById(symbol, venue) : undefined
  const book = useBookView(symbol, venue)
  const mark = symbol && book.symbol === symbol.toUpperCase() && book.venue === venue ? liveMark(book) : null
  const last = tape?.candles.at(-1)
  const first = tape?.candles[0]
  const headerPrice = mark?.price ?? last?.close ?? null
  const limited = tape ? windowNote(range, tape) : null
  const gaps = tape ? missingBars(tape.candles, tape.seconds) : 0
  const pages = showCorrelation ? ([...PAGE_ITEMS, ["correlation", "Correlation"] as const] as Array<[DeskPage, string]>) : PAGE_ITEMS

  return (
    <header className="bezel sticky top-0 z-30">
      <div className="scan-track" aria-hidden="true">
        <span className="scan-line" />
      </div>
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2">
        <div className="flex items-center gap-2">
          <button type="button" className="flex items-center gap-2" aria-label="Wick desk" onClick={() => onPage("desk")}>
            <CandleMark />
            <h1 className="font-mono text-sm tracking-[0.32em] text-[#c56a32] uppercase">Wick</h1>
          </button>
          <AccountSheet
            session={accountSession}
            status={accountStatus}
            onCreate={onCreateAccount}
            onSignIn={onSignInAccount}
            onSignOut={onSignOutAccount}
          />
          <BotSettings />
        </div>

        <PagesMenu page={page} pages={pages} onPage={onPage} />

        <div className="flex shrink-0 gap-1" role="group" aria-label="Venue">
          {(["spot", "perp"] as const).map((item) => (
            <Button
              key={item}
              type="button"
              size="xs"
              variant={item === venue ? "default" : "outline"}
              className="normal-case tracking-normal"
              aria-pressed={item === venue}
              onClick={() => onVenue(item)}
            >
              {item === "spot" ? "Spot" : "Perp"}
            </Button>
          ))}
        </div>

        {symbol ? (
          <SymbolSelect value={symbol} venue={venue} className="w-44" onChange={(value) => onSymbol(value)} />
        ) : null}

        <div className="flex max-w-full flex-wrap gap-1" role="group" aria-label="Timeframe">
          {TIMEFRAMES.map((item) => (
            <Button
              key={item.id}
              type="button"
              size="xs"
              variant={item.id === timeframe ? "default" : "outline"}
              className="normal-case tracking-normal"
              aria-pressed={item.id === timeframe}
              onClick={() => onTimeframe(item.id)}
            >
              {item.label}
            </Button>
          ))}
        </div>

        <div className="ml-auto flex min-w-0 flex-1 items-center gap-x-3 overflow-hidden font-mono text-[11px] tracking-wide whitespace-nowrap text-muted-foreground uppercase">
          <button
            type="button"
            className={session === "open" ? "text-up" : session === "stand-down" ? "text-down" : "text-muted-foreground"}
            aria-label={`Session ${session}`}
            onClick={onSession}
          >
            {session}
          </button>
          <span aria-label="Consecutive losses">
            {lossCount}/{lossLimit}
          </span>
          {lossHalted ? (
            <button type="button" className="text-foreground normal-case" onClick={onClearHalt}>
              Clear
            </button>
          ) : null}
          <span>{venue === "perp" ? "Kraken perp" : "Binance spot"}</span>
          {tape && last && first ? (
            <>
              <span>{market?.base ?? tape.symbol}</span>
              <span>{barsLabel(timeframe, tape.candles.length)}</span>
              <span>
                {formatDay(first.time)} – {formatDay(last.time)} UTC
              </span>
              {gaps > 0 ? <span>{gapLabel(gaps)}</span> : null}
              <span className="text-foreground tabular-nums">
                {mark?.source === "mid" ? "Mid " : ""}
                {headerPrice == null ? "—" : formatPrice(headerPrice, market?.tickSize)}
              </span>
              {limited ? <span>{limited}</span> : null}
            </>
          ) : loading ? (
            <span>Loading {frame?.label ?? timeframe} bars</span>
          ) : (
            <span>{frame?.label ?? timeframe} bars didn't load</span>
          )}
          <span>Candles {lastFetchAt ? `${formatClock(lastFetchAt)} UTC` : "—"}</span>
        </div>
      </div>
      {stale ? (
        <p className="mx-auto max-w-[1440px] px-4 pb-3 text-sm text-down" role="status">
          Last poll failed.
          {lastFetchAt ? ` Showing the tape from ${formatClock(lastFetchAt)} UTC.` : " Showing the last good tape."}
        </p>
      ) : null}
    </header>
  )
}

function PagesMenu({
  page,
  pages,
  onPage,
}: {
  page: DeskPage
  pages: Array<[DeskPage, string]>
  onPage: (page: DeskPage) => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const current = pages.find(([item]) => item === page)?.[1]

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    window.addEventListener("mousedown", onPointer)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("mousedown", onPointer)
      window.removeEventListener("keydown", onKey)
    }
  }, [open])

  return (
    <div ref={root} className="relative shrink-0">
      <Button
        type="button"
        size="xs"
        variant={page === "desk" ? "outline" : "default"}
        className="gap-1 normal-case tracking-normal"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={current ? `Pages, ${current}` : "Pages"}
        onClick={() => setOpen((value) => !value)}
      >
        Pages
        <ChevronDown className="size-3 opacity-70" aria-hidden="true" />
      </Button>
      {open ? (
        <ul
          id={menuId}
          role="menu"
          aria-label="Pages"
          className="bezel absolute top-full left-0 z-40 mt-1 min-w-36 py-1"
        >
          <li role="none">
            <button
              type="button"
              role="menuitem"
              className="flex w-full px-3 py-1.5 text-left font-mono text-xs tracking-wide uppercase hover:bg-[#f6e4d2]"
              onClick={() => {
                onPage("desk")
                setOpen(false)
              }}
            >
              Desk
            </button>
          </li>
          {pages.map(([item, label]) => (
            <li key={item} role="none">
              <button
                type="button"
                role="menuitem"
                className="flex w-full px-3 py-1.5 text-left font-mono text-xs tracking-wide uppercase hover:bg-[#f6e4d2]"
                aria-current={page === item ? "page" : undefined}
                onClick={() => {
                  onPage(item)
                  setOpen(false)
                }}
              >
                {label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function gapLabel(count: number): string {
  return count === 1 ? "1 gap" : `${count} gaps`
}

function CandleMark() {
  return (
    <svg viewBox="0 0 32 32" className="size-6 text-[#c56a32]" aria-hidden="true">
      <line x1="16" y1="4" x2="16" y2="28" stroke="currentColor" strokeWidth="1" />
      <rect x="12" y="10" width="8" height="12" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}
