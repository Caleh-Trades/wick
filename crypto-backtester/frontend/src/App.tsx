import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { type OverlaySeries } from "@/components/charts"
import { MarketPane } from "@/components/market-pane"
import { Controls } from "@/components/controls"
import { DeskBar } from "@/components/desk-bar"
import { ResearchChart } from "@/components/research"
import { Results } from "@/components/results"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { fetchCandles, mergeFunding } from "@/lib/api"
import { backtest } from "@/lib/backtest"
import {
  MAX_RUNS,
  createRun,
  fingerprint,
  loadDesk,
  mergeCandles,
  phraseFor,
  pollIntervalMs,
  rangeDays,
  ruleName,
  runColor,
  saveDesk,
  suggestedName,
  uniqueName,
  type DeskState,
} from "@/lib/runs"
import type { MarketId, Outcome, RangeId, Run, SortKey, Tape, TapeCandle, Timeframe, Trade, Venue } from "@/lib/types"

const EMPTY_CANDLES: TapeCandle[] = []
const EMPTY_TRADES: Trade[] = []

export default function App() {
  const [desk, setDesk] = useState<DeskState>(() => loadDesk())
  const [tapes, setTapes] = useState<Partial<Record<MarketId, Tape>>>({})
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({})
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [lastFetchAt, setLastFetchAt] = useState<Date | null>(null)
  const [setupOpen, setSetupOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [drawToken, setDrawToken] = useState(0)
  const generation = useRef(0)
  const deskRef = useRef(desk)
  const tapesRef = useRef(tapes)
  deskRef.current = desk
  tapesRef.current = tapes

  const selected = desk.runs.find((run) => run.id === desk.selectedId) ?? desk.runs[0]

  useEffect(() => {
    saveDesk(desk)
  }, [desk])

  const applyTape = useCallback((tape: Tape) => {
    const next = { ...tapesRef.current, [tape.symbol]: tape }
    tapesRef.current = next
    setTapes(next)
    return next
  }, [])

  const remember = useCallback((run: Run, tape: Tape): Outcome => {
    try {
      const result = backtest(tape.candles, run, tape.periodsPerYear, {
        venue: tape.venue,
        funding: tape.funding,
        fundingStale: tape.fundingStale,
      })
      result.interval = tape.interval
      result.source = tape.source
      return { ok: true, result, fingerprint: fingerprint(run) }
    } catch (reason: unknown) {
      return {
        ok: false,
        error: reason instanceof Error ? reason.message : "This run didn't compute.",
        fingerprint: fingerprint(run),
      }
    }
  }, [])

  const tapesFor = useCallback(
    async (symbols: MarketId[]) => {
      const timeframe = deskRef.current.timeframe
      const range = deskRef.current.range
      const venue = deskRef.current.venue
      const gen = generation.current
      const map = { ...tapesRef.current }
      const missing = symbols.filter((symbol) => !tapeMatches(map[symbol], timeframe, range, venue))
      if (missing.length === 0) return map
      const loaded = await Promise.allSettled(
        missing.map((symbol) => fetchCandles(symbol, timeframe, { days: rangeDays(range), range, venue })),
      )
      if (
        gen !== generation.current ||
        deskRef.current.timeframe !== timeframe ||
        deskRef.current.range !== range ||
        deskRef.current.venue !== venue
      ) {
        return tapesRef.current
      }
      let failure = ""
      for (const item of loaded) {
        if (item.status === "fulfilled") map[item.value.symbol] = item.value
        else if (!failure) {
          failure = item.reason instanceof Error ? item.reason.message : "The tape didn't load."
        }
      }
      tapesRef.current = map
      setTapes(map)
      setStale(false)
      if (failure) throw new Error(failure)
      return map
    },
    [],
  )

  useEffect(() => {
    const gen = ++generation.current
    const timeframe = desk.timeframe
    const range = desk.range
    const venue = desk.venue
    const symbols = [...new Set(deskRef.current.runs.map((run) => run.symbol))]
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const loaded = await Promise.allSettled(
          symbols.map((symbol) => fetchCandles(symbol, timeframe, { days: rangeDays(range), range, venue })),
        )
        if (gen !== generation.current || deskRef.current.venue !== venue) return
        const map: Partial<Record<MarketId, Tape>> = {}
        let selectedError = ""
        const selectedSymbol = deskRef.current.runs.find((run) => run.id === deskRef.current.selectedId)?.symbol
        symbols.forEach((symbol, index) => {
          const item = loaded[index]
          if (!item) return
          if (item.status === "fulfilled") map[item.value.symbol] = item.value
          else if (symbol === selectedSymbol) {
            selectedError = item.reason instanceof Error ? item.reason.message : "The tape didn't load."
          }
        })
        tapesRef.current = map
        setTapes(map)
        setStale(false)
        if (selectedError && !map[selectedSymbol ?? ""]) setError(selectedError)
        if (Object.keys(map).length > 0) setLastFetchAt(new Date())
        const current = deskRef.current
        const targets = current.runs.filter((run) => !run.hidden || run.id === current.selectedId)
        const next: Record<string, Outcome> = {}
        for (const run of targets) {
          const tape = map[run.symbol]
          if (!tape) continue
          next[run.id] = remember(run, tape)
        }
        setOutcomes(next)
        setDrawToken((token) => token + 1)
      } catch (reason: unknown) {
        if (gen !== generation.current) return
        setError(reason instanceof Error ? reason.message : "The tape didn't load.")
      } finally {
        if (gen === generation.current) setLoading(false)
      }
    })()
  }, [desk.timeframe, desk.range, desk.venue, remember])

  const refreshTail = useCallback(async () => {
    const current = deskRef.current
    const run = current.runs.find((item) => item.id === current.selectedId)
    if (!run) return
    const existing = tapesRef.current[run.symbol]
    if (!tapeMatches(existing, current.timeframe, current.range, current.venue)) return
    const since = existing.candles[existing.candles.length - 1]?.t
    const gen = generation.current
    try {
      const tail = await fetchCandles(run.symbol, current.timeframe, { since, venue: current.venue })
      if (
        gen !== generation.current ||
        deskRef.current.timeframe !== current.timeframe ||
        deskRef.current.range !== current.range ||
        deskRef.current.venue !== current.venue
      ) {
        return
      }
      const base = tapesRef.current[run.symbol]
      if (!tapeMatches(base, current.timeframe, current.range, current.venue)) return
      const merged = mergeCandles(base.candles, tail.candles)
      const funding = current.venue === "perp" ? mergeFunding(base.funding, tail.funding) : undefined
      const tape: Tape = {
        ...base,
        candles: merged,
        source: tail.source,
        venue: current.venue,
        funding,
        fundingStale: current.venue === "perp" ? tail.funding == null || tail.fundingStale === true : false,
      }
      applyTape(tape)
      setStale(false)
      setLastFetchAt(new Date())
      const latest = deskRef.current
      const targets = latest.runs.filter(
        (item) => item.symbol === run.symbol && (!item.hidden || item.id === latest.selectedId),
      )
      setOutcomes((prev) => {
        const patch: Record<string, Outcome> = {}
        for (const item of targets) patch[item.id] = remember(item, tape)
        return { ...prev, ...patch }
      })
    } catch {
      if (gen === generation.current) setStale(true)
    }
  }, [applyTape, remember])

  useEffect(() => {
    if (setupOpen || editing || loading) return
    const timer = window.setInterval(() => {
      void refreshTail()
    }, pollIntervalMs(desk.timeframe))
    return () => window.clearInterval(timer)
  }, [desk.timeframe, desk.selectedId, setupOpen, editing, loading, refreshTail])

  function updateRun(next: Run) {
    const prev = deskRef.current.runs.find((run) => run.id === next.id)
    const updated = {
      ...deskRef.current,
      runs: deskRef.current.runs.map((run) => (run.id === next.id ? next : run)),
    }
    deskRef.current = updated
    setDesk(updated)
    if (prev && (prev.allowShort !== next.allowShort || prev.capital !== next.capital || prev.leverage !== next.leverage)) {
      const tape = tapesRef.current[next.symbol]
      if (tapeMatches(tape, updated.timeframe, updated.range, updated.venue)) {
        setOutcomes((current) => ({ ...current, [next.id]: remember(next, tape) }))
      }
    }
    if (!prev || prev.symbol === next.symbol) return
    setOutcomes((current) => {
      if (!(next.id in current)) return current
      const copy = { ...current }
      delete copy[next.id]
      return copy
    })
    void tapesFor([next.symbol])
      .then((map) => {
        const tape = map[next.symbol]
        if (!tape) return
        setLastFetchAt(new Date())
        const latest = deskRef.current
        const targets = latest.runs.filter(
          (item) => item.symbol === next.symbol && (!item.hidden || item.id === latest.selectedId),
        )
        setOutcomes((current) => {
          const patch: Record<string, Outcome> = {}
          for (const item of targets) patch[item.id] = remember(item, tape)
          return { ...current, ...patch }
        })
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "The tape didn't load.")
      })
  }

  const selectRun = useCallback(
    (id: string) => {
      const current = deskRef.current
      const run = current.runs.find((item) => item.id === id)
      setDesk((state) => ({ ...state, selectedId: id }))
      if (!run) return
      const tape = tapesRef.current[run.symbol]
      if (!tapeMatches(tape, current.timeframe, current.range, current.venue)) {
        void tapesFor([run.symbol])
          .then((map) => {
            const loaded = map[run.symbol]
            if (!loaded) return
            setOutcomes((prev) => ({ ...prev, [run.id]: remember(run, loaded) }))
          })
          .catch((reason: unknown) => {
            setError(reason instanceof Error ? reason.message : "The tape didn't load.")
          })
        return
      }
      setOutcomes((prev) => {
        const existing = prev[run.id]
        if (existing?.ok && existing.fingerprint === fingerprint(run)) return prev
        return { ...prev, [run.id]: remember(run, tape) }
      })
    },
    [remember, tapesFor],
  )

  const removeRun = useCallback((id: string) => {
    const current = deskRef.current
    const index = current.runs.findIndex((run) => run.id === id)
    if (index < 0) return
    const runs = current.runs.filter((run) => run.id !== id)
    const neighbor = runs[index] ?? runs[index - 1]
    const selectedId = current.selectedId === id ? (neighbor?.id ?? "") : current.selectedId
    const updated = { ...current, runs, selectedId }
    deskRef.current = updated
    setDesk(updated)
    setOutcomes((prev) => {
      if (!(id in prev)) return prev
      const copy = { ...prev }
      delete copy[id]
      return copy
    })
  }, [])

  const stageRun = useCallback(
    (run: Run) => {
      const tape = tapesRef.current[run.symbol]
      if (!tapeMatches(tape, deskRef.current.timeframe, deskRef.current.range, deskRef.current.venue)) return
      setOutcomes((prev) => ({ ...prev, [run.id]: remember(run, tape) }))
    },
    [remember],
  )

  const toggleHidden = useCallback(
    (id: string) => {
      const run = deskRef.current.runs.find((item) => item.id === id)
      setDesk((current) => ({
        ...current,
        runs: current.runs.map((item) => (item.id === id ? { ...item, hidden: !item.hidden } : item)),
      }))
      if (run?.hidden) stageRun(run)
    },
    [stageRun],
  )

  function addRun() {
    if (desk.runs.length >= MAX_RUNS) return
    const run = createRun({ name: uniqueName("SMA 20/50", desk.runs) }, desk.runs)
    setDesk((current) => ({ ...current, runs: [...current.runs, run], selectedId: run.id }))
    stageRun(run)
  }

  function duplicateRun() {
    if (desk.runs.length >= MAX_RUNS) return
    const source = desk.runs.find((run) => run.id === desk.selectedId)
    if (!source) return
    const copy = createRun(
      {
        name: uniqueName(suggestedName(source.rule, source.params), desk.runs),
        symbol: source.symbol,
        rule: source.rule,
        params: { ...source.params },
        feeBps: source.feeBps,
        capital: source.capital,
        leverage: source.leverage,
        allowShort: source.allowShort,
      },
      desk.runs,
    )
    setDesk((current) => ({ ...current, runs: [...current.runs, copy], selectedId: copy.id }))
    stageRun(copy)
  }

  function changeTimeframe(timeframe: Timeframe) {
    if (timeframe === desk.timeframe) return
    retape({ timeframe })
  }

  function changeRange(range: RangeId) {
    if (range === desk.range) return
    retape({ range })
  }

  function changeVenue(venue: Venue) {
    if (venue === desk.venue) return
    retape({ venue })
  }

  function retape(patch: Partial<DeskState>) {
    generation.current += 1
    tapesRef.current = {}
    setTapes({})
    setOutcomes({})
    setStale(false)
    setLoading(true)
    setLastFetchAt(null)
    setDesk((current) => ({ ...current, ...patch }))
  }

  async function runSelected() {
    if (!selected) return
    setRunning(true)
    setError(null)
    try {
      const map = await tapesFor([selected.symbol])
      const tape = map[selected.symbol]
      if (!tape) throw new Error("The tape didn't load.")
      setOutcomes((prev) => ({ ...prev, [selected.id]: remember(selected, tape) }))
      setDrawToken((token) => token + 1)
      setSetupOpen(false)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "The backtest didn't run.")
    } finally {
      setRunning(false)
    }
  }

  async function runAll() {
    setRunning(true)
    setError(null)
    const gen = generation.current
    try {
      const runs = deskRef.current.runs
      const symbols = [...new Set(runs.map((run) => run.symbol))]
      const timeframe = deskRef.current.timeframe
      const range = deskRef.current.range
      const venue = deskRef.current.venue
      const loaded = await Promise.allSettled(
        symbols.map((symbol) => fetchCandles(symbol, timeframe, { days: rangeDays(range), range, venue })),
      )
      if (gen !== generation.current) return
      const map: Partial<Record<MarketId, Tape>> = {}
      let selectedError = ""
      let otherError = ""
      const selectedSymbol = deskRef.current.runs.find((run) => run.id === deskRef.current.selectedId)?.symbol
      symbols.forEach((symbol, index) => {
        const item = loaded[index]
        if (!item) return
        if (item.status === "fulfilled") map[item.value.symbol] = item.value
        else {
          const message = item.reason instanceof Error ? item.reason.message : "The tape didn't load."
          if (symbol === selectedSymbol) selectedError = message
          else if (!otherError) otherError = message
        }
      })
      tapesRef.current = map
      setTapes(map)
      setStale(false)
      const notice = selectedError || otherError
      if (notice) setError(notice)
      if (Object.keys(map).length > 0) setLastFetchAt(new Date())
      const next: Record<string, Outcome> = {}
      for (const run of runs) {
        const tape = map[run.symbol]
        if (!tape) continue
        next[run.id] = remember(run, tape)
      }
      setOutcomes(next)
      setDrawToken((token) => token + 1)
      setSetupOpen(false)
    } catch (reason: unknown) {
      if (gen === generation.current) {
        setError(reason instanceof Error ? reason.message : "The backtests didn't run.")
      }
    } finally {
      if (gen === generation.current) setRunning(false)
    }
  }

  const sortRef = useRef({ key: sortKey, dir: sortDir })
  sortRef.current = { key: sortKey, dir: sortDir }
  const onSort = useCallback((key: SortKey) => {
    const current = sortRef.current
    if (current.key === key) setSortDir(current.dir === "desc" ? "asc" : "desc")
    else {
      setSortKey(key)
      setSortDir("desc")
    }
  }, [])

  const enlarge = useCallback(() => {
    setDesk((current) => (current.enlarged ? current : { ...current, enlarged: true }))
  }, [])

  const closeEnlarge = useCallback(() => {
    setDesk((current) => (current.enlarged ? { ...current, enlarged: false } : current))
  }, [])

  const selectedOutcome = selected ? outcomes[selected.id] : undefined
  const result = selectedOutcome?.ok ? selectedOutcome.result : null
  const overlays = useMemo<OverlaySeries[]>(
    () =>
      desk.runs.flatMap((run, index) => {
        if (run.hidden) return []
        const outcome = outcomes[run.id]
        if (!outcome?.ok) return []
        return [
          {
            id: run.id,
            name: `${run.name} · ${ruleName(run.rule)}`,
            color: runColor(index),
            equity: outcome.result.equity.map((point) => ({ time: point.time, equity: point.equity })),
          },
        ]
      }),
    [desk.runs, outcomes],
  )
  const phrase = phraseFor(desk.timeframe)
  const activeTape = selected ? tapes[selected.symbol] : undefined
  const tapeReady = tapeMatches(activeTape, desk.timeframe, desk.range, desk.venue)
  const visibleCandles = tapeReady && activeTape ? activeTape.candles : EMPTY_CANDLES
  const visibleTrades = result?.trades ?? EMPTY_TRADES

  return (
    <div className="min-h-svh pb-24 lg:pb-8">
      <DeskBar
        symbol={selected?.symbol ?? null}
        timeframe={desk.timeframe}
        range={desk.range}
        venue={desk.venue}
        tape={tapeReady && activeTape ? activeTape : null}
        stale={stale}
        lastFetchAt={lastFetchAt}
        onSymbol={(symbol) => {
          if (!selected || selected.symbol === symbol) return
          updateRun({ ...selected, symbol })
        }}
        onTimeframe={changeTimeframe}
        onRange={changeRange}
        onVenue={changeVenue}
      />

      <main className="mx-auto grid max-w-[1440px] gap-6 px-4 py-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="hidden min-w-0 lg:block">
          <div className="sticky top-24 max-h-[calc(100svh-7rem)] overflow-x-hidden overflow-y-auto pr-2">
            {selected ? (
              <Controls
                idPrefix="desk"
                runs={desk.runs}
                selected={selected}
                venue={desk.venue}
                running={running}
                onSelect={selectRun}
                onChange={updateRun}
                onToggleHidden={toggleHidden}
                onRemove={removeRun}
                onAdd={addRun}
                onDuplicate={duplicateRun}
                onRun={() => void runSelected()}
                onRunAll={() => void runAll()}
                onEditing={setEditing}
              />
            ) : (
              <EmptyRuns onAdd={addRun} />
            )}
          </div>
        </aside>

        <section aria-busy={running || loading} className="min-w-0">
          {error ? (
            <div role="alert" className="bezel mb-6 px-4 py-3 text-sm text-down">
              {error}
            </div>
          ) : null}

          {!result && selected ? (
            <div className="flex h-[min(72vh,48rem)] min-h-[24rem] flex-col gap-4">
              {loading && !tapeReady ? (
                <p className="text-sm text-muted-foreground">Pulling the {phrase} tape. The first look at a pair can take a few seconds.</p>
              ) : null}
              {selectedOutcome && !selectedOutcome.ok ? (
                <p className="font-heading text-3xl">{selectedOutcome.error}</p>
              ) : null}
              <MarketPane
                symbol={selected.symbol}
                candles={visibleCandles}
                trades={EMPTY_TRADES}
                interval={desk.timeframe}
                venue={desk.venue}
                onEnlarge={enlarge}
              />
            </div>
          ) : null}

          {result && selected ? (
            <Results
              runs={desk.runs}
              outcomes={outcomes}
              selected={selected}
              result={result}
              candles={visibleCandles}
              interval={desk.timeframe}
              venue={desk.venue}
              overlays={overlays}
              sortKey={sortKey}
              sortDir={sortDir}
              onEnlarge={enlarge}
              onSelect={selectRun}
              onToggleHidden={toggleHidden}
              onRemove={removeRun}
              onSort={onSort}
              drawToken={drawToken}
            />
          ) : null}

          {running && result ? (
            <p className="mt-6 font-mono text-xs tracking-wide text-muted-foreground uppercase">Running the next pass…</p>
          ) : null}
        </section>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-[#fffaf4]/90 p-3 lg:hidden">
        <Sheet
          open={setupOpen}
          onOpenChange={(open) => {
            setSetupOpen(open)
            if (!open) setEditing(false)
          }}
        >
          <SheetTrigger asChild>
            <Button className="w-full">Setup</Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="max-h-[88svh] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Setup</SheetTitle>
              <SheetDescription>The selected run: market, rule, and fee.</SheetDescription>
            </SheetHeader>
            <div className="px-8 pb-8">
              {selected ? (
                <Controls
                  idPrefix="sheet"
                  runs={desk.runs}
                  selected={selected}
                  venue={desk.venue}
                  running={running}
                  onSelect={selectRun}
                  onChange={updateRun}
                  onToggleHidden={toggleHidden}
                  onRemove={removeRun}
                  onAdd={addRun}
                  onDuplicate={duplicateRun}
                  onRun={() => void runSelected()}
                  onRunAll={() => void runAll()}
                  onEditing={setEditing}
                />
              ) : (
                <EmptyRuns onAdd={addRun} />
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {desk.enlarged ? (
        <ResearchChart
          candles={visibleCandles}
          trades={visibleTrades}
          interval={desk.timeframe}
          symbol={selected?.symbol ?? null}
          venue={desk.venue}
          metrics={result?.metrics ?? null}
          runName={selected?.name ?? "Run"}
          onClose={closeEnlarge}
        />
      ) : null}
    </div>
  )
}

function tapeMatches(tape: Tape | undefined, timeframe: Timeframe, range: RangeId, venue: Venue): tape is Tape {
  return Boolean(tape && tape.interval === timeframe && tape.range === range && tape.venue === venue)
}

function EmptyRuns({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">No runs on the desk.</p>
      <Button type="button" variant="outline" onClick={onAdd}>
        Add run
      </Button>
    </div>
  )
}
