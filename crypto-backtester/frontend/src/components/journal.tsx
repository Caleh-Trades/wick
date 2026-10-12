import { useEffect, useState } from "react"
import { Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { marketLabel, RISK_MODES, rowIsStale, SESSION_LIGHTS, type BookPosition, type RiskMode, type SessionLight } from "@/lib/desk"
import { formatFactor, formatMoney, formatPct, formatPlainPct, formatPrice, formatSize, formatStamp } from "@/lib/format"
import { marketSpec } from "@/lib/markets"
import { alertEntries, removeAlert, watchAlerts, type JournalEntry } from "@/lib/journal"
import { liveMark } from "@/lib/book"
import { formatR, openR } from "@/lib/open-trade"
import {
  PAGE_SIZE,
  emptyPage,
  emptyQuery,
  emptyTicketQuery,
  exportFiltered,
  exportFilteredCsv,
  listJournalStrategies,
  logBookTrade,
  matchingTrades,
  removeTrade,
  saveTicket,
  searchTickets,
  searchTrades,
  setTicketScaleOut,
  watchBook,
  type StrategyRecord,
  type TicketPage,
  type TicketQuery,
  type TradePage,
  type TradeQuery,
  type TradeRecord,
  type TradeSide,
  type WorkingTicket,
} from "@/lib/records"
import { weekStrip, type WeekStrip } from "@/lib/week-strip"
import { RULES, ruleName } from "@/lib/runs"
import { timeStopDue } from "@/lib/time-stop"
import { useBookView } from "@/lib/use-book"
import type { Timeframe, Venue } from "@/lib/types"
import { cn } from "@/lib/utils"

export function JournalPage({
  symbol,
  venue,
  timeframe,
  riskMode,
  session,
  positions,
  maxBarsOpen,
  feeBps,
  slippageBps,
  onLogged,
  onCloseTrade,
  onPromote,
}: {
  symbol: string
  venue: Venue
  timeframe: Timeframe
  riskMode: RiskMode
  session: SessionLight
  positions: BookPosition[]
  maxBarsOpen: number | null
  feeBps: number
  slippageBps: number
  onLogged: (trade: TradeRecord) => void
  onCloseTrade: (trade: TradeRecord, price: number) => void
  onPromote: (id: string) => void
}) {
  const [tab, setTab] = useState<"trades" | "working">("trades")

  return (
    <div className="desk-stack lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-4 px-4 py-4 pb-16">
        <div>
          <h2 className="font-mono text-xs tracking-[0.28em] text-[#c56a32] uppercase">Journal</h2>
          <div className="mt-3 flex gap-1" role="tablist" aria-label="Journal">
            {(
              [
                ["trades", "Trades"],
                ["working", "Working"],
              ] as const
            ).map(([id, label]) => (
              <Button
                key={id}
                type="button"
                size="xs"
                variant={tab === id ? "default" : "outline"}
                className="normal-case tracking-normal"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
              >
                {label}
              </Button>
            ))}
          </div>
          <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
            {tab === "trades"
              ? "Open trades, then closed trades from the last 30 days. Archive holds older closed rows. Filters apply to this table and to both exports. Candle history is not stored on a row."
              : "Live tickets only: open, armed, or not yet kept. Kept runs live on Saved. A ticket fill writes one journal row."}
          </p>
        </div>
        {tab === "working" ? (
          <WorkingPanel symbol={symbol} venue={venue} riskMode={riskMode} session={session} onPromote={onPromote} />
        ) : (
          <TradesPanel
            symbol={symbol}
            venue={venue}
            timeframe={timeframe}
            riskMode={riskMode}
            positions={positions}
            maxBarsOpen={maxBarsOpen}
            feeBps={feeBps}
            slippageBps={slippageBps}
            onLogged={onLogged}
            onCloseTrade={onCloseTrade}
          />
        )}
      </div>
    </div>
  )
}

function TradesPanel({
  symbol,
  venue,
  timeframe,
  riskMode,
  positions,
  maxBarsOpen,
  feeBps,
  slippageBps,
  onLogged,
  onCloseTrade,
}: {
  symbol: string
  venue: Venue
  timeframe: Timeframe
  riskMode: RiskMode
  positions: BookPosition[]
  maxBarsOpen: number | null
  feeBps: number
  slippageBps: number
  onLogged: (trade: TradeRecord) => void
  onCloseTrade: (trade: TradeRecord, price: number) => void
}) {
  const [query, setQuery] = useState<TradeQuery>({ ...emptyQuery(), market: venue })
  const [loadedQuery, setLoadedQuery] = useState<TradeQuery>({ ...emptyQuery(), market: venue })
  const [page, setPage] = useState<TradePage>(emptyPage)
  const [strategies, setStrategies] = useState<StrategyRecord[]>([])
  const [alerts, setAlerts] = useState(alertEntries)
  const [market, setMarket] = useState(symbol)
  const [side, setSide] = useState<TradeSide>("long")
  const [strategy, setStrategy] = useState("none")
  const [price, setPrice] = useState("")
  const [exitPrice, setExitPrice] = useState("")
  const [size, setSize] = useState("")
  const [stop, setStop] = useState("")
  const [reward, setReward] = useState("")
  const [note, setNote] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [week, setWeek] = useState<WeekStrip>({ pnl: null, winRate: null, avgR: null, closed: 0 })

  useEffect(() => {
    setMarket(symbol)
    if (venue === "spot") setSide("long")
    setQuery((current) => ({ ...current, market: venue, page: 0 }))
  }, [symbol, venue])

  useEffect(() => {
    let cancel = false
    const load = () => {
      setLoading(true)
      void searchTrades(query)
        .then((next) => {
          if (cancel) return
          setPage(next)
          setLoadedQuery(query)
          setLoading(false)
          setError(null)
        })
        .catch((reason: unknown) => {
          if (cancel) return
          setLoading(false)
          setError(reason instanceof Error ? reason.message : "The trades didn't load.")
        })
      void listJournalStrategies().then((next) => {
        if (!cancel) setStrategies(next)
      })
      void matchingTrades(emptyQuery()).then((trades) => {
        if (!cancel) setWeek(weekStrip(trades))
      })
    }
    load()
    const stopWatch = watchBook(load)
    return () => {
      cancel = true
      stopWatch()
    }
  }, [query])

  useEffect(() => watchAlerts(() => setAlerts(alertEntries())), [])

  function patch(partial: Partial<TradeQuery>, resetPage = true) {
    setQuery((current) => ({ ...current, ...partial, page: resetPage ? 0 : (partial.page ?? current.page) }))
  }

  async function submit() {
    const exitRaw = exitPrice.trim()
    let exit: number | null = null
    if (exitRaw) {
      exit = Number(exitRaw)
      if (!(exit > 0)) {
        setError("Exit price has to be above zero, or leave it blank while the trade is open.")
        return
      }
    }
    const stopRaw = stop.trim() ? Number(stop) : null
    const rewardRaw = reward.trim() ? Number(reward) : null
    if (stopRaw != null && !(stopRaw > 0)) {
      setError("Stop has to be above zero, or leave it blank.")
      return
    }
    if (rewardRaw != null && !(rewardRaw > 0)) {
      setError("R has to be above zero, or leave it blank.")
      return
    }
    const logged = await logBookTrade({
      symbol: market,
      side: venue === "spot" ? "long" : side,
      entryPrice: Number(price),
      size: Number(size),
      venue,
      market: venue,
      strategyName: strategy === "none" ? "" : ruleName(strategy),
      rule: strategy === "none" ? "" : strategy,
      exitPrice: exit,
      note,
      stop: stopRaw,
      r: rewardRaw,
      riskMode,
      feeBps,
      slippageBps,
      source: "desk",
    })
    if (!logged) {
      setError("A trade needs a symbol, an entry price, and a size.")
      return
    }
    onLogged(logged)
    setError(null)
    setExitPrice("")
    setSize("")
    setStop("")
    setReward("")
    setNote("")
  }

  const tick = marketSpec(market, venue)?.tickSize
  const names = new Map(strategies.map((row) => [row.id, row.name]))
  const fromRow = page.total === 0 ? 0 : loadedQuery.page * PAGE_SIZE + 1
  const toRow = Math.min(page.total, (loadedQuery.page + 1) * PAGE_SIZE)
  const lastPage = Math.max(0, Math.ceil(page.total / PAGE_SIZE) - 1)

  return (
    <>
      <section className="bezel flex flex-wrap items-baseline gap-x-4 gap-y-1 px-3 py-2" aria-label="This week">
        <span className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">This week</span>
        <span className={cn("font-mono text-xs tabular-nums", week.pnl == null ? "text-muted-foreground" : moneyTone(week.pnl) === "up" ? "text-up" : moneyTone(week.pnl) === "down" ? "text-down" : "")}>
          {week.pnl == null ? "—" : signedMoney(week.pnl)}
        </span>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          Win {week.winRate == null ? "—" : formatPlainPct(week.winRate, 0)}
        </span>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          Avg R {week.avgR == null ? "—" : formatR(week.avgR)}
        </span>
      </section>
      <section className="bezel grid grid-cols-2 gap-px overflow-hidden sm:grid-cols-3 lg:grid-cols-6" aria-label="Filtered totals">
        <Stat label="Trades" value={String(page.total)} />
        <Stat label="Closed" value={String(page.closed)} />
        <Stat label="Open" value={String(page.open)} />
        <Stat label="P&L" value={signedMoney(page.pnl)} toneName={moneyTone(page.pnl)} />
        <Stat label="Fees" value={formatMoney(page.fees, 2)} />
        <Stat label="Profit factor" value={formatFactor(page.profitFactor)} />
        <Stat
          label="Expectancy"
          value={formatPct(page.expectancy)}
          toneName={page.expectancy == null ? "ink" : moneyTone(page.expectancy)}
        />
      </section>

      <form
        className="bezel grid grid-cols-2 gap-3 p-3 lg:grid-cols-5"
        aria-label="Trade filters"
        onSubmit={(event) => event.preventDefault()}
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor="filter-symbol">Symbol</Label>
          <Input id="filter-symbol" value={query.symbol} maxLength={20} onChange={(event) => patch({ symbol: event.target.value })} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="filter-strategy">Strategy</Label>
          <Select value={query.strategyId || "all"} onValueChange={(value) => patch({ strategyId: value === "all" ? "" : value })}>
            <SelectTrigger id="filter-strategy" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All strategies</SelectItem>
              {strategies.map((row) => (
                <SelectItem key={row.id} value={row.id}>
                  {row.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="filter-side">Side</Label>
          <Select value={query.side || "all"} onValueChange={(value) => patch({ side: value === "long" || value === "short" ? value : "" })}>
            <SelectTrigger id="filter-side" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Both</SelectItem>
              <SelectItem value="long">Long</SelectItem>
              <SelectItem value="short">Short</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="filter-from">From</Label>
          <Input id="filter-from" type="date" value={query.from} onChange={(event) => patch({ from: event.target.value })} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="filter-to">To</Label>
          <Input id="filter-to" type="date" value={query.to} onChange={(event) => patch({ to: event.target.value })} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="filter-risk">Risk</Label>
          <Select value={query.riskMode || "all"} onValueChange={(value) => patch({ riskMode: value === "DEFENSIVE" || value === "NORMAL" || value === "PRESS" ? value : "" })}>
            <SelectTrigger id="filter-risk" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any risk</SelectItem>
              {RISK_MODES.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {mode}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="filter-state">Open or closed</Label>
          <Select value={query.state || "all"} onValueChange={(value) => patch({ state: value === "open" || value === "closed" ? value : "" })}>
            <SelectTrigger id="filter-state" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Open and closed</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="filter-window">Window</Label>
          <Select
            value={query.window === "archive" ? "archive" : "recent"}
            onValueChange={(value) => patch({ window: value === "archive" ? "archive" : "recent" })}
          >
            <SelectTrigger id="filter-window" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Recent · 30 days</SelectItem>
              <SelectItem value="archive">Archive · older closed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="xs" variant="outline" className="normal-case tracking-normal" onClick={() => void exportFiltered(query)}>
          Export JSON
        </Button>
        <Button type="button" size="xs" variant="outline" className="normal-case tracking-normal" onClick={() => void exportFilteredCsv(query)}>
          Export trades CSV
        </Button>
        <p className="font-mono text-[11px] text-muted-foreground tabular-nums">
          {loading ? "Loading…" : page.total === 0 ? "0 trades" : `${fromRow}–${toRow} of ${page.total}`}
        </p>
        <div className="ml-auto flex gap-1">
          <Button type="button" size="xs" variant="outline" className="normal-case tracking-normal" disabled={loading || query.page <= 0} onClick={() => patch({ page: query.page - 1 }, false)}>
            Previous
          </Button>
          <Button type="button" size="xs" variant="outline" className="normal-case tracking-normal" disabled={loading || query.page >= lastPage} onClick={() => patch({ page: query.page + 1 }, false)}>
            Next
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="bezel px-4 py-8 text-sm text-muted-foreground">Loading trades.</p>
      ) : page.rows.length === 0 ? (
        <p className="bezel px-4 py-8 text-sm text-muted-foreground">
          {query.window === "archive" ? "No archived trades match." : "No trades match. Log one below, or let a bot send it with log-trade."}
        </p>
      ) : (
        <div className="bezel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Entry</TableHead>
                <TableHead>Symbol</TableHead>
                <TableHead>Side</TableHead>
                <TableHead>Strategy</TableHead>
                <TableHead>Risk</TableHead>
                <TableHead className="text-right">Entry</TableHead>
                <TableHead className="text-right">Stop</TableHead>
                <TableHead className="text-right">R</TableHead>
                <TableHead className="text-right">Exit</TableHead>
                <TableHead className="text-right">Size</TableHead>
                <TableHead className="text-right">Return</TableHead>
                <TableHead className="text-right">Fee</TableHead>
                <TableHead className="text-right">MAE</TableHead>
                <TableHead className="text-right">MFE</TableHead>
                <TableHead className="text-right">P&L</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.rows.map((trade) => (
                <TradeTableRow
                  key={trade.id}
                  trade={trade}
                  strategyName={names.get(trade.strategyId) ?? ""}
                  stale={rowIsStale(trade, positions)}
                  timeframe={timeframe}
                  maxBarsOpen={maxBarsOpen}
                  onClose={onCloseTrade}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <form
        className="bezel p-3"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <p className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
          Log a trade · {marketLabel(venue)} · {riskMode}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="journal-symbol">Symbol</Label>
            <Input id="journal-symbol" value={market} maxLength={20} onChange={(event) => setMarket(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Side</span>
            <div className="flex gap-1" role="group" aria-label="Side">
              {(["long", "short"] as const).map((item) => (
                <Button
                  key={item}
                  type="button"
                  size="xs"
                  variant={side === item ? "default" : "outline"}
                  className="normal-case tracking-normal"
                  aria-pressed={side === item}
                  disabled={item === "short" && venue === "spot"}
                  onClick={() => setSide(item)}
                >
                  {item === "long" ? "Long" : "Short"}
                </Button>
              ))}
            </div>
          </div>
          <div className="col-span-2 flex flex-col gap-1">
            <Label htmlFor="journal-strategy">Strategy</Label>
            <Select value={strategy} onValueChange={setStrategy}>
              <SelectTrigger id="journal-strategy" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No strategy</SelectItem>
                {RULES.map((rule) => (
                  <SelectItem key={rule.id} value={rule.id}>
                    {rule.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="journal-price">Entry{tick ? ` · tick ${tick}` : ""}</Label>
            <Input id="journal-price" inputMode="decimal" step={tick || "any"} value={price} onChange={(event) => setPrice(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="journal-exit">Exit{tick ? ` · tick ${tick}` : ""}</Label>
            <Input id="journal-exit" inputMode="decimal" step={tick || "any"} value={exitPrice} placeholder="Open" onChange={(event) => setExitPrice(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="journal-stop">Stop</Label>
            <Input id="journal-stop" inputMode="decimal" step={tick || "any"} value={stop} placeholder="Optional" onChange={(event) => setStop(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="journal-r">R</Label>
            <Input id="journal-r" inputMode="decimal" value={reward} placeholder="Optional" onChange={(event) => setReward(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="journal-size">Size</Label>
            <Input id="journal-size" inputMode="decimal" value={size} onChange={(event) => setSize(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="journal-note">Note</Label>
            <Input id="journal-note" value={note} maxLength={280} placeholder="Why this trade" onChange={(event) => setNote(event.target.value)} />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button type="submit">Log trade</Button>
          {error ? <p className="text-sm text-down">{error}</p> : null}
        </div>
      </form>

      {alerts.length > 0 ? (
        <section aria-label="Alerts">
          <p className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">Alerts</p>
          <ul className="mt-2 flex flex-col gap-2">
            {alerts.map((entry) => (
              <AlertRow key={entry.id} entry={entry} />
            ))}
          </ul>
        </section>
      ) : null}
    </>
  )
}

function TradeTableRow({
  trade,
  strategyName,
  stale,
  timeframe,
  maxBarsOpen,
  onClose,
}: {
  trade: TradeRecord
  strategyName: string
  stale: boolean
  timeframe: Timeframe
  maxBarsOpen: number | null
  onClose: (trade: TradeRecord, price: number) => void
}) {
  const base = trade.symbol.replace(/USDT$/, "")
  const open = trade.exitTime == null
  const book = useBookView(trade.symbol, trade.market)
  const last = liveMark(book)?.price ?? null
  const tick = marketSpec(trade.symbol, trade.market)?.tickSize
  const markR = open && last != null && trade.stop != null ? openR(trade.side, trade.entryPrice, trade.stop, last) : null
  const timed = open && timeStopDue(trade.entryTime, timeframe, maxBarsOpen)
  return (
    <TableRow>
      <TableCell className="font-mono text-xs whitespace-nowrap text-muted-foreground">{formatStamp(trade.entryTime, "1m")}</TableCell>
      <TableCell>{base}</TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant={trade.side === "long" ? "default" : "secondary"}>{trade.side === "long" ? "Long" : "Short"}</Badge>
          {trade.leg === "partial" ? <Badge variant="outline">Partial</Badge> : null}
          {trade.leg === "runner" ? <Badge variant="outline">Runner</Badge> : null}
          {timed ? <Badge variant="outline">time</Badge> : null}
        </div>
      </TableCell>
      <TableCell className="max-w-40">
        <div className="truncate">{trade.strategyName || strategyName}</div>
        {trade.note || trade.ticketId || trade.linkId ? (
          <div className="truncate font-mono text-[10px] text-muted-foreground">
            {trade.note || (trade.linkId ? `linked ${trade.linkId.slice(0, 8)}` : `ticket ${trade.ticketId}`)}
          </div>
        ) : null}
      </TableCell>
      <TableCell className="font-mono text-[10px] tracking-wide uppercase">
        {trade.riskMode}
        {stale ? " · stale" : ""}
      </TableCell>
      <TableCell className="text-right font-mono text-xs tabular-nums">{formatPrice(trade.entryPrice, tick)}</TableCell>
      <TableCell className="text-right font-mono text-xs tabular-nums">{trade.stop == null ? "—" : formatPrice(trade.stop, tick)}</TableCell>
      <TableCell className="text-right font-mono text-xs tabular-nums">
        {open ? (markR == null ? "—" : formatR(markR)) : trade.r == null ? "—" : trade.r}
      </TableCell>
      <TableCell className="text-right font-mono text-xs tabular-nums">{open || trade.exitPrice == null ? "Open" : formatPrice(trade.exitPrice, tick)}</TableCell>
      <TableCell className="text-right font-mono text-xs tabular-nums">{formatSize(trade.size)}</TableCell>
      <TableCell className={cn("text-right font-mono text-xs tabular-nums", trade.returnPct != null && moneyTone(trade.returnPct) === "up" && "text-up", trade.returnPct != null && moneyTone(trade.returnPct) === "down" && "text-down")}>
        {open ? "—" : formatPlainPct(trade.returnPct, 1)}
      </TableCell>
      <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">{formatMoney(trade.fee, 2)}</TableCell>
      <TableCell className={cn("text-right font-mono text-xs tabular-nums", trade.mae != null && moneyTone(trade.mae) === "down" && "text-down")}>
        {open ? "—" : formatPct(trade.mae)}
      </TableCell>
      <TableCell className={cn("text-right font-mono text-xs tabular-nums", trade.mfe != null && moneyTone(trade.mfe) === "up" && "text-up")}>
        {open ? "—" : formatPct(trade.mfe)}
      </TableCell>
      <TableCell className={cn("text-right font-mono text-xs tabular-nums", trade.pnl != null && moneyTone(trade.pnl) === "up" && "text-up", trade.pnl != null && moneyTone(trade.pnl) === "down" && "text-down")}>
        {open || trade.pnl == null ? "—" : signedMoney(trade.pnl)}
      </TableCell>
      <TableCell className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">{trade.source}</TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          {open && last != null ? (
            <Button type="button" size="xs" variant="outline" className="normal-case tracking-normal" onClick={() => onClose(trade, last)}>
              Close
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove ${base} ${trade.side}`} onClick={() => void removeTrade(trade.id)}>
            <Trash2 />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}

function WorkingPanel({
  symbol,
  venue,
  riskMode,
  session,
  onPromote,
}: {
  symbol: string
  venue: Venue
  riskMode: RiskMode
  session: SessionLight
  onPromote: (id: string) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [ticketQuery, setTicketQuery] = useState<TicketQuery>(emptyTicketQuery)
  const [ticketPage, setTicketPage] = useState<TicketPage>({ rows: [], total: 0 })
  const [ticketSymbol, setTicketSymbol] = useState(symbol)
  const [ticketSide, setTicketSide] = useState<TradeSide>("long")
  const [ticketStrategy, setTicketStrategy] = useState("Discretionary")
  const [ticketEntry, setTicketEntry] = useState("")
  const [ticketStop, setTicketStop] = useState("")
  const [ticketSize, setTicketSize] = useState("")
  const [ticketR, setTicketR] = useState("")
  const [scaleOutR, setScaleOutR] = useState("2")
  const [scaleOutPct, setScaleOutPct] = useState("50")

  useEffect(() => {
    setTicketSymbol(symbol)
    if (venue === "spot") setTicketSide("long")
  }, [symbol, venue])

  useEffect(() => {
    let cancel = false
    void searchTickets(ticketQuery).then((next) => {
      if (!cancel) setTicketPage(next)
    })
    const stop = watchBook(() => {
      void searchTickets(ticketQuery).then((next) => {
        if (!cancel) setTicketPage(next)
      })
    })
    return () => {
      cancel = true
      stop()
    }
  }, [ticketQuery])

  function patchTickets(partial: Partial<TicketQuery>, resetPage = true) {
    setTicketQuery((current) => ({ ...current, ...partial, page: resetPage ? 0 : (partial.page ?? current.page) }))
  }

  async function writeTicket() {
    const saved = await saveTicket({
      symbol: ticketSymbol,
      market: venue,
      side: venue === "spot" ? "long" : ticketSide,
      strategy: ticketStrategy,
      entry: Number(ticketEntry),
      stop: Number(ticketStop),
      size: Number(ticketSize),
      r: Number(ticketR),
      scaleOutR: Number(scaleOutR),
      scaleOutPct: Number(scaleOutPct),
      riskMode,
      session,
    })
    if (!saved) {
      setError("A ticket needs a symbol, a strategy, an entry, a stop, a size, and R.")
      return
    }
    setError(null)
    setTicketEntry("")
    setTicketStop("")
    setTicketSize("")
    setTicketR("")
    setScaleOutR("2")
    setScaleOutPct("50")
  }

  const ticketLast = Math.max(0, Math.ceil(ticketPage.total / PAGE_SIZE) - 1)
  const ticketTick = marketSpec(ticketSymbol, venue)?.tickSize

  return (
    <>
      <TicketFilters query={ticketQuery} total={ticketPage.total} lastPage={ticketLast} onPatch={patchTickets} />
      <form
        className="bezel p-3"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void writeTicket()
        }}
      >
        <p className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
          Working ticket · {marketLabel(venue)} · {riskMode} · {session}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="ticket-symbol">Symbol</Label>
            <Input id="ticket-symbol" value={ticketSymbol} maxLength={20} onChange={(event) => setTicketSymbol(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Side</span>
            <div className="flex gap-1" role="group" aria-label="Ticket side">
              {(["long", "short"] as const).map((item) => (
                <Button
                  key={item}
                  type="button"
                  size="xs"
                  variant={ticketSide === item ? "default" : "outline"}
                  className="normal-case tracking-normal"
                  aria-pressed={ticketSide === item}
                  disabled={item === "short" && venue === "spot"}
                  onClick={() => setTicketSide(item)}
                >
                  {item === "long" ? "Long" : "Short"}
                </Button>
              ))}
            </div>
          </div>
          <div className="col-span-2 flex flex-col gap-1">
            <Label htmlFor="ticket-strategy">Strategy</Label>
            <Input id="ticket-strategy" value={ticketStrategy} maxLength={48} onChange={(event) => setTicketStrategy(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="ticket-entry">Entry{ticketTick ? ` · tick ${ticketTick}` : ""}</Label>
            <Input id="ticket-entry" inputMode="decimal" step={ticketTick || "any"} value={ticketEntry} onChange={(event) => setTicketEntry(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="ticket-stop">Stop</Label>
            <Input id="ticket-stop" inputMode="decimal" step={ticketTick || "any"} value={ticketStop} onChange={(event) => setTicketStop(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="ticket-size">Size</Label>
            <Input id="ticket-size" inputMode="decimal" value={ticketSize} onChange={(event) => setTicketSize(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="ticket-r">R</Label>
            <Input id="ticket-r" inputMode="decimal" value={ticketR} onChange={(event) => setTicketR(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="ticket-scale-r">Scale-out (R)</Label>
            <Input id="ticket-scale-r" inputMode="decimal" value={scaleOutR} onChange={(event) => setScaleOutR(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="ticket-scale-pct">Scale-out %</Label>
            <Input id="ticket-scale-pct" inputMode="numeric" value={scaleOutPct} onChange={(event) => setScaleOutPct(event.target.value)} />
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Second target defaults to 2R and closes 50% there. The rest stays as the runner.</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button type="submit">Save ticket</Button>
          {error ? <p className="text-sm text-down">{error}</p> : null}
        </div>
      </form>
      <section aria-label="Working tickets">
        <p className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
          {ticketPage.total} {ticketPage.total === 1 ? "ticket" : "tickets"}
        </p>
        {ticketPage.rows.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No tickets match. Save one above. Kept runs are on Saved, not here.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {ticketPage.rows.map((ticket) => (
              <TicketRow key={ticket.id} ticket={ticket} onPromote={onPromote} />
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

function AlertRow({ entry }: { entry: JournalEntry }) {
  const base = entry.symbol.replace(/USDT$/, "")
  const label = entry.alertKind === "delta" ? "60s delta" : entry.alertKind === "below" ? "Price below" : "Price above"
  const hit = entry.alertKind === "delta" ? formatSize(entry.price) : formatPrice(entry.price)
  return (
    <li className="bezel flex items-start justify-between gap-3 px-3 py-2">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <Badge variant="secondary">Alert</Badge>
          <span className="text-sm">{base}</span>
          <span className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">{entry.venue === "perp" ? "Perp" : "Spot"}</span>
          <span className="font-mono text-xs tabular-nums">{label} {hit}</span>
        </div>
        <p className="mt-1 font-mono text-[11px] text-muted-foreground">{formatStamp(entry.time, "1m")}</p>
        {entry.note ? <p className="mt-1 text-sm break-words">{entry.note}</p> : null}
      </div>
      <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove ${base} alert`} onClick={() => removeAlert(entry.id)}>
        <Trash2 />
      </Button>
    </li>
  )
}

function TicketFilters({
  query,
  total,
  lastPage,
  onPatch,
}: {
  query: TicketQuery
  total: number
  lastPage: number
  onPatch: (partial: Partial<TicketQuery>, resetPage?: boolean) => void
}) {
  return (
    <form className="bezel grid grid-cols-2 gap-3 p-3 lg:grid-cols-5" aria-label="Working filters" onSubmit={(event) => event.preventDefault()}>
      <div className="flex flex-col gap-1">
        <Label htmlFor="ticket-filter-symbol">Symbol</Label>
        <Input id="ticket-filter-symbol" value={query.symbol} maxLength={20} onChange={(event) => onPatch({ symbol: event.target.value })} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="ticket-filter-strategy">Strategy</Label>
        <Input id="ticket-filter-strategy" value={query.strategy} maxLength={48} onChange={(event) => onPatch({ strategy: event.target.value })} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="ticket-filter-side">Side</Label>
        <Select value={query.side || "all"} onValueChange={(value) => onPatch({ side: value === "long" || value === "short" ? value : "" })}>
          <SelectTrigger id="ticket-filter-side" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Both</SelectItem>
            <SelectItem value="long">Long</SelectItem>
            <SelectItem value="short">Short</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="ticket-filter-risk">Risk</Label>
        <Select value={query.riskMode || "all"} onValueChange={(value) => onPatch({ riskMode: value === "DEFENSIVE" || value === "NORMAL" || value === "PRESS" ? value : "" })}>
          <SelectTrigger id="ticket-filter-risk" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any risk</SelectItem>
            {RISK_MODES.map((mode) => (
              <SelectItem key={mode} value={mode}>
                {mode}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="ticket-filter-session">Session</Label>
        <Select value={query.session || "all"} onValueChange={(value) => onPatch({ session: value === "open" || value === "closed" || value === "stand-down" ? value : "" })}>
          <SelectTrigger id="ticket-filter-session" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any session</SelectItem>
            {SESSION_LIGHTS.map((light) => (
              <SelectItem key={light} value={light}>
                {light}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="col-span-2 flex items-center gap-2 lg:col-span-5">
        <p className="font-mono text-[11px] text-muted-foreground tabular-nums">{total} match{total === 1 ? "" : "es"}</p>
        <div className="ml-auto flex gap-1">
          <Button type="button" size="xs" variant="outline" className="normal-case tracking-normal" disabled={query.page <= 0} onClick={() => onPatch({ page: query.page - 1 }, false)}>
            Previous
          </Button>
          <Button type="button" size="xs" variant="outline" className="normal-case tracking-normal" disabled={query.page >= lastPage} onClick={() => onPatch({ page: query.page + 1 }, false)}>
            Next
          </Button>
        </div>
      </div>
    </form>
  )
}

function TicketRow({ ticket, onPromote }: { ticket: WorkingTicket; onPromote: (id: string) => void }) {
  const base = ticket.symbol.replace(/USDT$/, "")
  const tick = marketSpec(ticket.symbol, ticket.market)?.tickSize
  const [scaleR, setScaleR] = useState(String(ticket.scaleOutR))
  const [scalePct, setScalePct] = useState(String(ticket.scaleOutPct))

  useEffect(() => {
    setScaleR(String(ticket.scaleOutR))
    setScalePct(String(ticket.scaleOutPct))
  }, [ticket.scaleOutPct, ticket.scaleOutR])

  return (
    <li className="bezel flex items-start justify-between gap-3 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-sm">{ticket.strategy}</span>
          <span className="text-sm text-muted-foreground">{base}</span>
          <Badge variant={ticket.side === "long" ? "default" : "secondary"}>{ticket.side === "long" ? "Long" : "Short"}</Badge>
          <span className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">{ticket.riskMode}</span>
          <span className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">{ticket.session}</span>
          <span className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">{marketLabel(ticket.market)}</span>
          {ticket.armed ? <span className="font-mono text-[10px] tracking-wide uppercase">Armed</span> : null}
          {ticket.filledAt ? <span className="font-mono text-[10px] tracking-wide uppercase">Filled</span> : null}
        </div>
        <p className="mt-1 font-mono text-[11px] text-muted-foreground tabular-nums">
          Entry {formatPrice(ticket.entry, tick)} · Stop {formatPrice(ticket.stop, tick)} · Size {formatSize(ticket.size)} · R {ticket.r}
        </p>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <div className="flex w-20 flex-col gap-1">
            <Label htmlFor={`scale-r-${ticket.id}`} className="text-[10px]">
              Scale R
            </Label>
            <Input
              id={`scale-r-${ticket.id}`}
              inputMode="decimal"
              className="h-7"
              value={scaleR}
              onChange={(event) => setScaleR(event.target.value)}
              onBlur={() => void setTicketScaleOut(ticket.id, Number(scaleR), Number(scalePct))}
            />
          </div>
          <div className="flex w-20 flex-col gap-1">
            <Label htmlFor={`scale-pct-${ticket.id}`} className="text-[10px]">
              Close %
            </Label>
            <Input
              id={`scale-pct-${ticket.id}`}
              inputMode="numeric"
              className="h-7"
              value={scalePct}
              onChange={(event) => setScalePct(event.target.value)}
              onBlur={() => void setTicketScaleOut(ticket.id, Number(scaleR), Number(scalePct))}
            />
          </div>
        </div>
      </div>
      <Button type="button" size="xs" variant="outline" className="normal-case tracking-normal" onClick={() => onPromote(ticket.id)}>
        Promote
      </Button>
    </li>
  )
}

function Stat({ label, value, toneName = "ink" }: { label: string; value: string; toneName?: "up" | "down" | "ink" }) {
  return (
    <div className="bg-[#fffaf4] px-3 py-3">
      <p className="text-[0.65rem] font-semibold tracking-[0.16em] text-muted-foreground uppercase">{label}</p>
      <p className={cn("mt-1 font-mono text-lg tabular-nums", toneName === "up" && "text-up", toneName === "down" && "text-down")}>{value}</p>
    </div>
  )
}

function signedMoney(value: number): string {
  const text = formatMoney(Math.abs(value), 2)
  if (value > 0) return `+${text}`
  if (value < 0) return `-${text}`
  return text
}

function moneyTone(value: number): "up" | "down" | "ink" {
  if (value > 0) return "up"
  if (value < 0) return "down"
  return "ink"
}
