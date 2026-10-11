import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatFactor, formatMoney, formatPct, formatPlainPct, formatPrice, formatSize, formatStamp } from "@/lib/format"
import { alertEntries, removeAlert, watchAlerts, type JournalEntry } from "@/lib/journal"
import {
  PAGE_SIZE,
  emptyPage,
  emptyQuery,
  exportFiltered,
  exportFilteredCsv,
  exportRunFile,
  listJournalStrategies,
  listRuns,
  listStrategies,
  logBookTrade,
  removeRun,
  removeStrategy,
  removeTrade,
  saveStrategy,
  searchTrades,
  setRunNote,
  setStrategyNote,
  watchBook,
  type KeptListRow,
  type StrategyRecord,
  type TradePage,
  type TradeQuery,
  type TradeRecord,
  type TradeSide,
} from "@/lib/records"
import { RANGES, RULES, TIMEFRAMES, isRange, isTimeframe, normalizeRule, paramsForRule, ruleById, ruleName, ruleParams, strategyLabel, suggestedName } from "@/lib/runs"
import type { RangeId, RuleId, RunParams, Timeframe, Venue } from "@/lib/types"
import { cn } from "@/lib/utils"

export type WorkingDraft = {
  name: string
  symbol: string
  venue: Venue
  timeframe: string
  range: string
  rule: string
  params: RunParams
  combo: { rule: string; params: RunParams }[]
  feeBps: number
  slippageBps: number
  capital: number
  leverage: number
  riskPct: number
  allowShort: boolean
}

function workingDraftKey(draft: WorkingDraft | null): string {
  if (!draft) return "none"
  return [
    draft.symbol,
    draft.venue,
    draft.timeframe,
    draft.range,
    draft.rule,
    draft.name,
    draft.feeBps,
    draft.slippageBps,
    draft.capital,
    draft.leverage,
    draft.riskPct,
    draft.allowShort,
    JSON.stringify(draft.params),
    JSON.stringify(draft.combo),
  ].join("|")
}

export function JournalPage({
  symbol,
  venue,
  draft,
  onRestore,
  onOpenWorking,
}: {
  symbol: string
  venue: Venue
  draft: WorkingDraft | null
  onRestore: (ids: { strategyId: string; runId: string }) => void
  onOpenWorking: (strategyId: string) => void
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
              ? "Trades you log, and trades a bot logs. Newest first. A blank exit is still open. A backtest kept from the desk is not listed here. Filters apply to this table and to both exports."
              : "Strategies you save, and runs you keep from the desk. Keeping a run does not add its fills to the trade log. Opening a row puts that setup on a slot."}
          </p>
        </div>
        {tab === "working" ? (
          <WorkingPanel key={workingDraftKey(draft)} symbol={symbol} venue={venue} draft={draft} onOpen={onOpenWorking} onRestore={onRestore} />
        ) : (
          <TradesPanel symbol={symbol} venue={venue} />
        )}
      </div>
    </div>
  )
}

function TradesPanel({ symbol, venue }: { symbol: string; venue: Venue }) {
  const [query, setQuery] = useState<TradeQuery>(emptyQuery)
  const [loadedQuery, setLoadedQuery] = useState<TradeQuery>(emptyQuery)
  const [page, setPage] = useState<TradePage>(emptyPage)
  const [strategies, setStrategies] = useState<StrategyRecord[]>([])
  const [alerts, setAlerts] = useState(alertEntries)
  const [market, setMarket] = useState(symbol)
  const [side, setSide] = useState<TradeSide>("long")
  const [strategy, setStrategy] = useState("none")
  const [price, setPrice] = useState("")
  const [exitPrice, setExitPrice] = useState("")
  const [size, setSize] = useState("")
  const [note, setNote] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => setMarket(symbol), [symbol])

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
    }
    load()
    const stop = watchBook(load)
    return () => {
      cancel = true
      stop()
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
    const logged = await logBookTrade({
      symbol: market,
      side,
      entryPrice: Number(price),
      size: Number(size),
      venue,
      strategyName: strategy === "none" ? "" : ruleName(strategy),
      rule: strategy === "none" ? "" : strategy,
      exitPrice: exit,
      note,
      source: "desk",
    })
    if (!logged) {
      setError("A trade needs a symbol, an entry price, and a size.")
      return
    }
    setError(null)
    setExitPrice("")
    setSize("")
    setNote("")
  }

  const names = new Map(strategies.map((row) => [row.id, row.name]))
  const fromRow = page.total === 0 ? 0 : loadedQuery.page * PAGE_SIZE + 1
  const toRow = Math.min(page.total, (loadedQuery.page + 1) * PAGE_SIZE)
  const lastPage = Math.max(0, Math.ceil(page.total / PAGE_SIZE) - 1)

  return (
    <>
      <section className="bezel grid grid-cols-2 gap-px overflow-hidden sm:grid-cols-3 lg:grid-cols-5" aria-label="Filtered totals">
        <Stat label="Trades" value={String(page.total)} />
        <Stat label="Closed" value={String(page.closed)} />
        <Stat label="Open" value={String(page.open)} />
        <Stat label="Profit factor" value={formatFactor(page.profitFactor)} />
        <Stat
          label="Expectancy"
          value={formatPct(page.expectancy)}
          toneName={page.expectancy == null ? "ink" : moneyTone(page.expectancy)}
        />
      </section>

      <form
        className="bezel grid grid-cols-2 gap-3 p-3 lg:grid-cols-6"
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
        <p className="bezel px-4 py-8 text-sm text-muted-foreground">No trades match. Log one below, or let a bot send it with log-trade.</p>
      ) : (
        <div className="bezel overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Entry</TableHead>
                <TableHead>Symbol</TableHead>
                <TableHead>Side</TableHead>
                <TableHead>Strategy</TableHead>
                <TableHead className="text-right">Entry</TableHead>
                <TableHead className="text-right">Exit</TableHead>
                <TableHead className="text-right">Size</TableHead>
                <TableHead className="text-right">Return</TableHead>
                <TableHead className="text-right">P&L</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.rows.map((trade) => (
                <TradeTableRow key={trade.id} trade={trade} strategyName={names.get(trade.strategyId) ?? ""} />
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
          Log a trade · {venue === "perp" ? "Kraken perp" : "Binance spot"}
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
            <Label htmlFor="journal-price">Entry</Label>
            <Input id="journal-price" inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="journal-exit">Exit</Label>
            <Input id="journal-exit" inputMode="decimal" value={exitPrice} placeholder="Open" onChange={(event) => setExitPrice(event.target.value)} />
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

function TradeTableRow({ trade, strategyName }: { trade: TradeRecord; strategyName: string }) {
  const base = trade.symbol.replace(/USDT$/, "")
  const open = trade.exitTime == null
  return (
    <TableRow>
      <TableCell className="font-mono text-xs whitespace-nowrap text-muted-foreground">{formatStamp(trade.entryTime, "1m")}</TableCell>
      <TableCell>{base}</TableCell>
      <TableCell>
        <Badge variant={trade.side === "long" ? "default" : "secondary"}>{trade.side === "long" ? "Long" : "Short"}</Badge>
      </TableCell>
      <TableCell className="max-w-40 truncate">{strategyName}</TableCell>
      <TableCell className="text-right font-mono text-xs tabular-nums">{formatPrice(trade.entryPrice)}</TableCell>
      <TableCell className="text-right font-mono text-xs tabular-nums">{open || trade.exitPrice == null ? "Open" : formatPrice(trade.exitPrice)}</TableCell>
      <TableCell className="text-right font-mono text-xs tabular-nums">{formatSize(trade.size)}</TableCell>
      <TableCell className={cn("text-right font-mono text-xs tabular-nums", trade.returnPct != null && moneyTone(trade.returnPct) === "up" && "text-up", trade.returnPct != null && moneyTone(trade.returnPct) === "down" && "text-down")}>
        {open ? "—" : formatPlainPct(trade.returnPct, 1)}
      </TableCell>
      <TableCell className={cn("text-right font-mono text-xs tabular-nums", trade.pnl != null && moneyTone(trade.pnl) === "up" && "text-up", trade.pnl != null && moneyTone(trade.pnl) === "down" && "text-down")}>
        {open || trade.pnl == null ? "—" : signedMoney(trade.pnl)}
      </TableCell>
      <TableCell className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">{trade.source}</TableCell>
      <TableCell>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove ${base} ${trade.side}`} onClick={() => void removeTrade(trade.id)}>
          <Trash2 />
        </Button>
      </TableCell>
    </TableRow>
  )
}

function WorkingPanel({
  symbol,
  venue,
  draft,
  onOpen,
  onRestore,
}: {
  symbol: string
  venue: Venue
  draft: WorkingDraft | null
  onOpen: (strategyId: string) => void
  onRestore: (ids: { strategyId: string; runId: string }) => void
}) {
  const [rows, setRows] = useState<StrategyRecord[]>([])
  const [kept, setKept] = useState<KeptListRow[]>([])
  const [name, setName] = useState(draft?.name ?? "SMA 20/50")
  const [nameTouched, setNameTouched] = useState(false)
  const [market, setMarket] = useState(draft?.symbol ?? symbol)
  const [marketVenue, setMarketVenue] = useState<Venue>(draft?.venue ?? venue)
  const [timeframe, setTimeframe] = useState<Timeframe>(draft && isTimeframe(draft.timeframe) ? draft.timeframe : "1d")
  const [range, setRange] = useState<RangeId>(draft && isRange(draft.range) ? draft.range : "1Y")
  const [rule, setRule] = useState<RuleId>(draft ? normalizeRule(draft.rule) : "sma_cross")
  const [params, setParams] = useState<RunParams>(() => ruleParams(draft ? normalizeRule(draft.rule) : "sma_cross", draft?.params))
  const [combo, setCombo] = useState(draft?.combo ?? [])
  const [feeBps, setFeeBps] = useState(String(draft?.feeBps ?? 10))
  const [slippageBps, setSlippageBps] = useState(String(draft?.slippageBps ?? 5))
  const [capital, setCapital] = useState(String(draft?.capital ?? 10_000))
  const [leverage, setLeverage] = useState(String(draft?.leverage ?? (venue === "perp" ? 3 : 1)))
  const [riskPct, setRiskPct] = useState(String(draft?.riskPct ?? 1))
  const [allowShort, setAllowShort] = useState(draft?.allowShort ?? venue === "perp")
  const [note, setNote] = useState("")
  const [openNote, setOpenNote] = useState("")
  const [error, setError] = useState<string | null>(null)
  const spec = ruleById(rule)

  useEffect(() => {
    let cancel = false
    const load = () => {
      void listStrategies().then((next) => {
        if (!cancel) setRows(next)
      })
      void listRuns().then((next) => {
        if (!cancel) setKept(next)
      })
    }
    load()
    const stop = watchBook(load)
    return () => {
      cancel = true
      stop()
    }
  }, [])

  function chooseRule(next: string) {
    const picked = normalizeRule(next)
    const nextParams = ruleParams(picked, paramsForRule(picked, params))
    setRule(picked)
    setParams(nextParams)
    setCombo((current) => current.filter((item) => normalizeRule(item.rule) !== picked))
    if (!nameTouched) setName(suggestedName(picked, nextParams))
  }

  async function submit() {
    const saved = await saveStrategy({
      name,
      symbol: market,
      market: marketVenue,
      timeframe,
      range,
      rule,
      params,
      combo,
      fee: Number(feeBps),
      slippage: Number(slippageBps),
      capital: Number(capital),
      leverage: marketVenue === "perp" ? Number(leverage) : 1,
      risk: Number(riskPct),
      allowShort: marketVenue === "perp" && allowShort,
      note,
    })
    if (!saved) {
      setError("A strategy needs a symbol and a bar size Wick already uses.")
      return
    }
    setError(null)
    setNote("")
  }

  async function saveOpen() {
    if (!draft) return
    const saved = await saveStrategy({
      name: draft.name,
      symbol: draft.symbol,
      market: draft.venue,
      timeframe: draft.timeframe,
      range: draft.range,
      rule: draft.rule,
      params: draft.params,
      combo: draft.combo,
      fee: draft.feeBps,
      slippage: draft.slippageBps,
      capital: draft.capital,
      leverage: draft.venue === "perp" ? draft.leverage : 1,
      risk: draft.riskPct,
      allowShort: draft.venue === "perp" && draft.allowShort,
      note: openNote,
    })
    if (!saved) {
      setError("The open strategy needs a symbol and a bar size Wick already uses.")
      return
    }
    setError(null)
    setOpenNote("")
  }

  return (
    <>
      {draft ? (
        <form
          className="bezel p-3"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void saveOpen()
          }}
        >
          <p className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">Open on the desk</p>
          <p className="mt-2 text-sm">
            {draft.name} · {strategyLabel({ rule: normalizeRule(draft.rule), combo: draft.combo.map((item) => ({ rule: normalizeRule(item.rule), params: item.params })) })} · {draft.symbol.replace(/USDT$/, "")} · {draft.venue === "perp" ? "Perp" : "Spot"} · {draft.timeframe} · {draft.range}
          </p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <Label htmlFor="working-open-note">Why it is working</Label>
              <GrowingNote id="working-open-note" value={openNote} placeholder="Holds the trend after the last two weeks" onChange={setOpenNote} />
            </div>
            <Button type="submit" className="shrink-0">
              Save the open strategy
            </Button>
          </div>
        </form>
      ) : null}

      <form
        className="bezel p-3"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <p className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">Write one down</p>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="working-name">Name</Label>
            <Input
              id="working-name"
              value={name}
              maxLength={48}
              onChange={(event) => {
                setNameTouched(true)
                setName(event.target.value)
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="working-symbol">Symbol</Label>
            <Input id="working-symbol" value={market} maxLength={20} onChange={(event) => setMarket(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Market</span>
            <div className="flex gap-1" role="group" aria-label="Market">
              {(["spot", "perp"] as const).map((item) => (
                <Button
                  key={item}
                  type="button"
                  size="xs"
                  variant={marketVenue === item ? "default" : "outline"}
                  className="normal-case tracking-normal"
                  aria-pressed={marketVenue === item}
                  onClick={() => {
                    setMarketVenue(item)
                    if (item === "spot") setAllowShort(false)
                  }}
                >
                  {item === "spot" ? "Spot" : "Perp"}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="working-rule">Rule</Label>
            <Select value={rule} onValueChange={chooseRule}>
              <SelectTrigger id="working-rule" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RULES.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="working-timeframe">Bars</Label>
            <Select value={timeframe} onValueChange={(value) => { if (isTimeframe(value)) setTimeframe(value) }}>
              <SelectTrigger id="working-timeframe" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEFRAMES.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="working-range">Range</Label>
            <Select value={range} onValueChange={(value) => { if (isRange(value)) setRange(value) }}>
              <SelectTrigger id="working-range" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANGES.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {(spec?.params ?? []).map((param) =>
            param.toggle ? (
              <div key={param.key} className="flex items-center justify-between gap-3">
                <Label htmlFor={`working-${param.key}`}>{param.label}</Label>
                <Switch
                  id={`working-${param.key}`}
                  checked={(params[param.key] ?? param.default) >= 1}
                  onCheckedChange={(checked) => setParams((current) => ({ ...current, [param.key]: checked ? 1 : 0 }))}
                />
              </div>
            ) : (
              <div key={param.key} className="flex flex-col gap-1">
                <Label htmlFor={`working-${param.key}`}>{param.label}</Label>
                <Input
                  id={`working-${param.key}`}
                  inputMode="decimal"
                  value={String(params[param.key] ?? param.default)}
                  onChange={(event) => {
                    const number = Number(event.target.value)
                    if (Number.isFinite(number)) setParams((current) => ({ ...current, [param.key]: number }))
                  }}
                />
              </div>
            ),
          )}
          <div className="flex flex-col gap-1">
            <Label htmlFor="working-fee">Fee (bps)</Label>
            <Input id="working-fee" inputMode="decimal" value={feeBps} onChange={(event) => setFeeBps(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="working-slippage">Slippage (bps)</Label>
            <Input id="working-slippage" inputMode="decimal" value={slippageBps} onChange={(event) => setSlippageBps(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="working-capital">Base balance</Label>
            <Input id="working-capital" inputMode="decimal" value={capital} onChange={(event) => setCapital(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="working-risk">Risk %</Label>
            <Input id="working-risk" inputMode="decimal" value={riskPct} onChange={(event) => setRiskPct(event.target.value)} />
          </div>
          {marketVenue === "perp" ? (
            <div className="flex flex-col gap-1">
              <Label htmlFor="working-leverage">Leverage</Label>
              <Input id="working-leverage" inputMode="decimal" value={leverage} onChange={(event) => setLeverage(event.target.value)} />
            </div>
          ) : null}
          {marketVenue === "perp" ? (
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="working-short">Allow short</Label>
              <Switch id="working-short" checked={allowShort} onCheckedChange={setAllowShort} />
            </div>
          ) : null}
          <div className="col-span-2 flex flex-col gap-1">
            <Label htmlFor="working-note">Why it is working</Label>
            <GrowingNote id="working-note" value={note} placeholder="Why this setup" onChange={setNote} />
          </div>
        </div>
        {spec ? <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{spec.summary}</p> : null}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button type="submit">Save strategy</Button>
          {error ? <p className="text-sm text-down">{error}</p> : null}
        </div>
      </form>

      <section aria-label="Kept runs">
        <p className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">Kept runs</p>
        {kept.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Keep a run from the desk. The list shows the strategy, the symbol, the return, and the note. Reopening loads that strategy and that run. The fills stay on the run.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {kept.map((row) => (
              <KeptRow key={row.run.id} row={row} onRestore={onRestore} />
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Working strategies">
        <p className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">Saved</p>
        {rows.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Nothing saved yet. Save the strategy on the desk, or write the rule down above.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {rows.map((row) => (
              <WorkingRow key={row.id} row={row} onOpen={onOpen} />
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

function WorkingRow({ row, onOpen }: { row: StrategyRecord; onOpen: (strategyId: string) => void }) {
  const base = row.symbol.replace(/USDT$/, "")
  const spec = ruleById(row.rule)
  const fields = (spec?.params ?? [])
    .map((param) => `${param.label} ${row.params[param.key] ?? param.default}`)
    .join(" · ")
  const label = strategyLabel({
    rule: normalizeRule(row.rule),
    combo: row.combo.map((item) => ({ rule: normalizeRule(item.rule), params: item.params })),
  })
  return (
    <li className="bezel flex items-start justify-between gap-3 px-3 py-2">
      <div className="min-w-0">
        <button type="button" className="flex max-w-full flex-wrap items-baseline gap-x-2 gap-y-1 text-left" onClick={() => onOpen(row.id)}>
          <span className="text-sm">{row.name}</span>
          <span className="text-sm text-muted-foreground">{base}</span>
          <span className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">{row.market === "perp" ? "Perp" : "Spot"}</span>
        </button>
        <p className="mt-1 text-sm text-muted-foreground">
          {label} · {row.timeframe} · {row.range}
          {fields ? ` · ${fields}` : ""}
        </p>
        <GrowingNote
          label={`Note for ${row.name}`}
          value={row.note}
          placeholder="Why this one is working"
          className="mt-2"
          onChange={(value) => void setStrategyNote(row.id, value)}
        />
      </div>
      <div className="flex shrink-0 gap-1">
        <Button type="button" size="xs" variant="outline" className="normal-case tracking-normal" onClick={() => onOpen(row.id)}>
          Open
        </Button>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove working ${row.name}`} onClick={() => void removeStrategy(row.id)}>
          <Trash2 />
        </Button>
      </div>
    </li>
  )
}

function GrowingNote({
  id,
  label,
  value,
  placeholder,
  className,
  onChange,
}: {
  id?: string
  label?: string
  value: string
  placeholder: string
  className?: string
  onChange: (value: string) => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    node.style.height = "auto"
    node.style.height = `${node.scrollHeight + 2}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      id={id}
      aria-label={label}
      value={value}
      maxLength={280}
      rows={1}
      placeholder={placeholder}
      className={cn(
        "w-full min-w-0 resize-none overflow-hidden border-0 border-b border-b-input bg-transparent py-1 text-sm leading-relaxed break-words whitespace-pre-wrap outline-none placeholder:text-muted-foreground focus-visible:border-b-ring",
        className,
      )}
      onChange={(event) => onChange(event.target.value)}
    />
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

function KeptRow({ row, onRestore }: { row: KeptListRow; onRestore: (ids: { strategyId: string; runId: string }) => void }) {
  const base = row.strategy.symbol.replace(/USDT$/, "")
  const ids = { strategyId: row.strategy.id, runId: row.run.id }
  return (
    <li className="bezel flex items-start justify-between gap-3 px-3 py-2">
      <div className="min-w-0">
        <button type="button" className="flex max-w-full flex-wrap items-baseline gap-x-2 gap-y-1 text-left" onClick={() => onRestore(ids)}>
          <span className="text-sm">{row.strategy.name}</span>
          <span className="text-sm text-muted-foreground">{base}</span>
          <span className={cn("font-mono text-xs tabular-nums", moneyTone(row.run.metrics.total_return_pct) === "up" && "text-up", moneyTone(row.run.metrics.total_return_pct) === "down" && "text-down")}>
            {formatPct(row.run.metrics.total_return_pct)}
          </span>
        </button>
        <GrowingNote
          label={`Note for ${row.strategy.name}`}
          value={row.run.note}
          placeholder="Note on this run"
          className="mt-2"
          onChange={(value) => void setRunNote(row.run.id, value)}
        />
      </div>
      <div className="flex shrink-0 gap-1">
        <Button type="button" size="xs" variant="outline" className="normal-case tracking-normal" onClick={() => void exportRunFile(row.run.id)}>
          Export
        </Button>
        <Button type="button" size="xs" variant="outline" className="normal-case tracking-normal" onClick={() => onRestore(ids)}>
          Reopen
        </Button>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove kept ${row.strategy.name}`} onClick={() => void removeRun(row.run.id)}>
          <Trash2 />
        </Button>
      </div>
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
