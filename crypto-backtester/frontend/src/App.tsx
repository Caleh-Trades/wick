import { useCallback, useEffect, useRef, useState } from "react"

import { Controls } from "@/components/controls"
import { Results } from "@/components/results"
import type { OverlaySeries } from "@/components/charts"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { fetchCandles } from "@/lib/api"
import { backtest } from "@/lib/backtest"
import {
  MAX_RUNS,
  TIMEFRAMES,
  createRun,
  fingerprint,
  loadDesk,
  mergeCandles,
  pollIntervalMs,
  runColor,
  saveDesk,
  suggestedName,
  uniqueName,
  type DeskState,
} from "@/lib/runs"
import type { MarketId, Outcome, Run, SortKey, Tape, Timeframe } from "@/lib/types"

export default function App() {
  const [desk, setDesk] = useState<DeskState>(() => loadDesk())
  const [tapes, setTapes] = useState<Partial<Record<MarketId, Tape>>>({})
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({})
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
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
      const result = backtest(tape.candles, run, tape.periodsPerYear)
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
      const map = { ...tapesRef.current }
      const missing = symbols.filter((symbol) => map[symbol]?.interval !== timeframe)
      if (missing.length === 0) return map
      const loaded = await Promise.all(missing.map((symbol) => fetchCandles(symbol, timeframe)))
      for (const tape of loaded) map[tape.symbol] = tape
      tapesRef.current = map
      setTapes(map)
      setStale(false)
      return map
    },
    [],
  )

  useEffect(() => {
    const gen = ++generation.current
    const timeframe = desk.timeframe
    const symbols = [...new Set(deskRef.current.runs.map((run) => run.symbol))]
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const loaded = await Promise.all(symbols.map((symbol) => fetchCandles(symbol, timeframe)))
        if (gen !== generation.current) return
        const map: Partial<Record<MarketId, Tape>> = {}
        for (const tape of loaded) map[tape.symbol] = tape
        tapesRef.current = map
        setTapes(map)
        setStale(false)
        const current = deskRef.current
        const targets = current.runs.filter((run) => !run.hidden || run.id === current.selectedId)
        const next: Record<string, Outcome> = {}
        for (const run of targets) {
          const tape = map[run.symbol]
          if (!tape) continue
          next[run.id] = remember(run, tape)
        }
        setOutcomes(next)
      } catch (reason: unknown) {
        if (gen !== generation.current) return
        setError(reason instanceof Error ? reason.message : "The tape didn't load.")
      } finally {
        if (gen === generation.current) setLoading(false)
      }
    })()
  }, [desk.timeframe, remember])

  const refreshTail = useCallback(async () => {
    const current = deskRef.current
    const run = current.runs.find((item) => item.id === current.selectedId)
    if (!run) return
    const existing = tapesRef.current[run.symbol]
    if (!existing || existing.interval !== current.timeframe) return
    const since = existing.candles[existing.candles.length - 1]?.t
    const gen = generation.current
    try {
      const tail = await fetchCandles(run.symbol, current.timeframe, since)
      if (gen !== generation.current || deskRef.current.timeframe !== current.timeframe) return
      const base = tapesRef.current[run.symbol]
      if (!base) return
      const merged = mergeCandles(base.candles, tail.candles)
      const tape: Tape = { ...base, candles: merged, source: tail.source }
      applyTape(tape)
      setStale(false)
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
    if (desk.paused || setupOpen || editing || loading) return
    const timer = window.setInterval(() => {
      void refreshTail()
    }, pollIntervalMs(desk.timeframe))
    return () => window.clearInterval(timer)
  }, [desk.paused, desk.timeframe, desk.selectedId, setupOpen, editing, loading, refreshTail])

  function updateRun(next: Run) {
    setDesk((current) => ({
      ...current,
      runs: current.runs.map((run) => (run.id === next.id ? next : run)),
    }))
  }

  function selectRun(id: string) {
    const run = desk.runs.find((item) => item.id === id)
    setDesk((current) => ({ ...current, selectedId: id }))
    if (!run) return
    const tape = tapesRef.current[run.symbol]
    if (!tape || tape.interval !== desk.timeframe) {
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
  }

  function toggleHidden(id: string) {
    const run = desk.runs.find((item) => item.id === id)
    setDesk((current) => ({
      ...current,
      runs: current.runs.map((item) => (item.id === id ? { ...item, hidden: !item.hidden } : item)),
    }))
    if (run?.hidden) stageRun(run)
  }

  function stageRun(run: Run) {
    const tape = tapesRef.current[run.symbol]
    if (!tape || tape.interval !== deskRef.current.timeframe) return
    setOutcomes((prev) => ({ ...prev, [run.id]: remember(run, tape) }))
  }

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
      },
      desk.runs,
    )
    setDesk((current) => ({ ...current, runs: [...current.runs, copy], selectedId: copy.id }))
    stageRun(copy)
  }

  function changeTimeframe(timeframe: Timeframe) {
    if (timeframe === desk.timeframe) return
    generation.current += 1
    tapesRef.current = {}
    setTapes({})
    setOutcomes({})
    setStale(false)
    setLoading(true)
    setDesk((current) => ({ ...current, timeframe }))
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
      const loaded = await Promise.all(symbols.map((symbol) => fetchCandles(symbol, deskRef.current.timeframe)))
      if (gen !== generation.current) return
      const map: Partial<Record<MarketId, Tape>> = {}
      for (const tape of loaded) map[tape.symbol] = tape
      tapesRef.current = map
      setTapes(map)
      setStale(false)
      const next: Record<string, Outcome> = {}
      for (const run of runs) {
        const tape = map[run.symbol]
        if (!tape) continue
        next[run.id] = remember(run, tape)
      }
      setOutcomes(next)
      setSetupOpen(false)
    } catch (reason: unknown) {
      if (gen === generation.current) {
        setError(reason instanceof Error ? reason.message : "The backtests didn't run.")
      }
    } finally {
      if (gen === generation.current) setRunning(false)
    }
  }

  function onSort(key: SortKey) {
    if (sortKey === key) setSortDir((dir) => (dir === "desc" ? "asc" : "desc"))
    else {
      setSortKey(key)
      setSortDir("desc")
    }
  }

  const selectedOutcome = selected ? outcomes[selected.id] : undefined
  const result = selectedOutcome?.ok ? selectedOutcome.result : null
  const overlays: OverlaySeries[] = desk.runs.flatMap((run, index) => {
    if (run.hidden) return []
    const outcome = outcomes[run.id]
    if (!outcome?.ok) return []
    return [
      {
        id: run.id,
        name: run.name,
        color: runColor(index),
        equity: outcome.result.equity.map((point) => ({ time: point.time, equity: point.equity })),
      },
    ]
  })
  const phrase = TIMEFRAMES.find((item) => item.id === desk.timeframe)?.phrase ?? desk.timeframe

  return (
    <div className="min-h-svh pb-24 lg:pb-12">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-center gap-3">
            <CandleMark />
            <div>
              <p className="font-mono text-[10px] tracking-[0.22em] text-muted-foreground uppercase">Strategy desk</p>
              <h1 className="font-heading text-5xl leading-none">Wick</h1>
            </div>
          </div>
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground sm:text-right">
            Replay a crypto rule against the spot tape and see if it beat just holding the coin.
          </p>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-10 px-5 py-8 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="hidden min-w-0 lg:block">
          <div className="sticky top-6 max-h-[calc(100svh-3rem)] overflow-x-hidden overflow-y-auto pr-2">
            {selected ? (
              <Controls
                idPrefix="desk"
                runs={desk.runs}
                selected={selected}
                running={running}
                onSelect={selectRun}
                onChange={updateRun}
                onToggleHidden={toggleHidden}
                onAdd={addRun}
                onDuplicate={duplicateRun}
                onRun={() => void runSelected()}
                onRunAll={() => void runAll()}
                onEditing={setEditing}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Loading markets…</p>
            )}
          </div>
        </aside>

        <section aria-busy={running || loading} className="min-w-0">
          {error ? (
            <div role="alert" className="mb-6 border border-down/30 bg-down/10 px-4 py-3 text-sm text-down">
              {error}
            </div>
          ) : null}

          {loading && !result ? (
            <div className="flex flex-col gap-4">
              <TimeframeSwitch timeframe={desk.timeframe} onTimeframe={changeTimeframe} />
              <LoadingCopy label={`Pulling the ${phrase} tape. The first look at a pair can take a few seconds.`} />
            </div>
          ) : null}

          {result && selected ? (
            <Results
              runs={desk.runs}
              outcomes={outcomes}
              selected={selected}
              result={result}
              overlays={overlays}
              timeframe={desk.timeframe}
              stale={stale}
              paused={desk.paused}
              sortKey={sortKey}
              sortDir={sortDir}
              onTimeframe={changeTimeframe}
              onPause={() => setDesk((current) => ({ ...current, paused: !current.paused }))}
              onSelect={selectRun}
              onToggleHidden={toggleHidden}
              onSort={onSort}
            />
          ) : null}

          {!loading && !result && selectedOutcome && !selectedOutcome.ok ? (
            <div className="flex flex-col gap-4">
              <TimeframeSwitch timeframe={desk.timeframe} onTimeframe={changeTimeframe} />
              <p className="font-heading text-3xl">{selectedOutcome.error}</p>
            </div>
          ) : null}

          {running && result ? (
            <p className="mt-6 font-mono text-xs tracking-wide text-muted-foreground uppercase">Running the next pass…</p>
          ) : null}
        </section>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 p-3 backdrop-blur lg:hidden">
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
                  running={running}
                  onSelect={selectRun}
                  onChange={updateRun}
                  onToggleHidden={toggleHidden}
                  onAdd={addRun}
                  onDuplicate={duplicateRun}
                  onRun={() => void runSelected()}
                  onRunAll={() => void runAll()}
                  onEditing={setEditing}
                />
              ) : null}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  )
}

function TimeframeSwitch({
  timeframe,
  onTimeframe,
}: {
  timeframe: Timeframe
  onTimeframe: (timeframe: Timeframe) => void
}) {
  return (
    <div className="flex gap-1" role="group" aria-label="Timeframe">
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
  )
}

function LoadingCopy({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-4" aria-live="polite">
      <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">{label}</p>
      <div className="h-72 animate-pulse bg-desk/90" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="h-16 animate-pulse border-t border-border bg-muted/60" />
        ))}
      </div>
    </div>
  )
}

function CandleMark() {
  return (
    <svg viewBox="0 0 32 32" className="size-10 text-foreground" aria-hidden="true">
      <line x1="16" y1="3" x2="16" y2="29" stroke="currentColor" strokeWidth="1.4" />
      <rect x="11" y="9" width="10" height="14" fill="#c9852a" />
    </svg>
  )
}
