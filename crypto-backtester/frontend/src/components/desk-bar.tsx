import { AccountSheet } from "@/components/account-sheet"
import { BotSettings } from "@/components/bot-settings"
import type { AccountSession } from "@/lib/account"
import { SymbolSelect } from "@/components/symbol-select"
import { Button } from "@/components/ui/button"
import { formatClock, formatDay, formatPrice } from "@/lib/format"
import { missingBars } from "@/lib/plot"
import { TIMEFRAMES, barsLabel, marketById, windowNote } from "@/lib/runs"
import type { MarketId, RangeId, Tape, Timeframe, Venue } from "@/lib/types"

type DeskBarProps = {
  symbol: MarketId | null
  timeframe: Timeframe
  range: RangeId
  venue: Venue
  tape: Tape | null
  stale: boolean
  lastFetchAt: Date | null
  onSymbol: (symbol: MarketId) => void
  onTimeframe: (timeframe: Timeframe) => void
  onVenue: (venue: Venue) => void
  page: "desk" | "journal"
  onPage: (page: "desk" | "journal") => void
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
  stale,
  lastFetchAt,
  onSymbol,
  onTimeframe,
  onVenue,
  page,
  onPage,
  accountSession,
  accountStatus,
  onCreateAccount,
  onSignInAccount,
  onSignOutAccount,
}: DeskBarProps) {
  const frame = TIMEFRAMES.find((item) => item.id === timeframe)
  const market = symbol ? marketById(symbol, venue) : undefined
  const last = tape?.candles.at(-1)
  const first = tape?.candles[0]
  const limited = tape ? windowNote(range, tape) : null
  const gaps = tape ? missingBars(tape.candles, tape.seconds) : 0

  return (
    <header className="bezel sticky top-0 z-30">
      <div className="scan-track" aria-hidden="true">
        <span className="scan-line" />
      </div>
      <div className="mx-auto flex max-w-[1440px] items-center gap-x-3 gap-y-2 px-4 py-2 max-lg:flex-wrap lg:flex-nowrap">
        <div className="flex items-center gap-2">
          <CandleMark />
          <h1 className="font-mono text-sm tracking-[0.32em] text-[#c56a32] uppercase">Wick</h1>
          <AccountSheet
            session={accountSession}
            status={accountStatus}
            onCreate={onCreateAccount}
            onSignIn={onSignInAccount}
            onSignOut={onSignOutAccount}
          />
          <BotSettings />
        </div>

        <div className="flex shrink-0 gap-1" role="group" aria-label="Page">
          {(["desk", "journal"] as const).map((item) => (
            <Button
              key={item}
              type="button"
              size="xs"
              variant={page === item ? "default" : "outline"}
              className="normal-case tracking-normal"
              aria-pressed={page === item}
              onClick={() => onPage(item)}
            >
              {item === "desk" ? "Desk" : "Journal"}
            </Button>
          ))}
        </div>

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

        <div className="flex min-w-0 max-w-full gap-1 overflow-x-auto" role="group" aria-label="Timeframe">
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

        <div className="ml-auto flex min-w-0 items-center gap-x-3 overflow-hidden font-mono text-[11px] tracking-wide whitespace-nowrap text-muted-foreground uppercase">
          <span>{venue === "perp" ? "Kraken perp" : "Binance spot"}</span>
          {tape && last && first ? (
            <>
              <span>{market?.base ?? tape.symbol}</span>
              <span>{barsLabel(timeframe, tape.candles.length)}</span>
              <span>
                {formatDay(first.time)} – {formatDay(last.time)} UTC
              </span>
              {gaps > 0 ? <span>{gapLabel(gaps)}</span> : null}
              <span className="text-foreground tabular-nums">{formatPrice(last.close, market?.tickSize)}</span>
              {limited ? <span>{limited}</span> : null}
            </>
          ) : (
            <span>Loading {frame?.label ?? timeframe} bars</span>
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
