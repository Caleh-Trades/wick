import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"

import { type OverlaySeries } from "@/components/charts"
import { Controls } from "@/components/controls"
import { DeskBar } from "@/components/desk-bar"
import { MarketPane } from "@/components/market-pane"
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
import { Watchlist } from "@/components/watchlist"
import { WorkspaceBar } from "@/components/workspace-bar"
import { fetchCandles, mergeFunding } from "@/lib/api"
import { computeBacktest } from "@/lib/compute"
import { CHART_MAX, CHART_MIN, clampChart, loadPanes, savePanes, type PaneSizes } from "@/lib/panes"
import {
  MAX_RUNS,
  createRun,
  fingerprint,
  phraseFor,
  pollIntervalMs,
  rangeDays,
  ruleName,
  runColor,
  suggestedName,
  uniqueName,
} from "@/lib/runs"
import { holdBook } from "@/lib/use-book"
import {
  MAX_SLOTS,
  createSlot,
  loadWorkspace,
  saveWorkspace,
  tapeKey,
  visibleSlots,
  type Slot,
  type Workspace,
} from "@/lib/workspace"
import type { MarketId, Outcome, Run, SortKey, Tape, TapeCandle, Trade, Venue } from "@/lib/types"
import { cn } from "@/lib/utils"

const EMPTY_CANDLES: TapeCandle[] = []
const MAJORS: MarketId[] = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT"]

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace>(() => loadWorkspace())
  const [tapes, setTapes] = useState<Record<string, Tape>>({})
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({})
  const [clocks, setClocks] = useState<Record<string, Date | null>>({})
  const [errors, setErrors] = useState<Record<string, string | null>>({})
  const [loadingKey, setLoadingKey] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [stale, setStale] = useState(false)
  const [panes, setPanes] = useState<PaneSizes>(() => loadPanes())
  const [setupOpen, setSetupOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [drawToken, setDrawToken] = useState(0)
  const workspaceRef = useRef(workspace)
  const tapesRef = useRef(tapes)
  const outcomesRef = useRef(outcomes)
  const requestGen = useRef(new Map<string, number>())
  workspaceRef.current = workspace
  tapesRef.current = tapes
  outcomesRef.current = outcomes

  const active = workspace.slots.find((slot) => slot.id === workspace.activeId) ?? workspace.slots[0]
  const selected = active?.runs.find((run) => run.id === active.selectedId) ?? active?.runs[0]
  const shown = visibleSlots(workspace)

  useEffect(() => {
    saveWorkspace(workspace)
  }, [workspace])

  useEffect(() => {
    savePanes(panes)
  }, [panes])

  const held = workspace.slots.map((slot) => `${slot.venue}:${slot.symbol}`).join("|")
  useEffect(() => {
    const release = workspaceRef.current.slots.map((slot) => holdBook(slot.symbol, slot.venue, true))
    return () => {
      for (const stop of release) stop()
    }
  }, [held])

  const slotKeys = workspace.slots.map((slot) => `${slot.id}:${tapeKey(slot)}`).join("|")
  async function stageRuns(slot: Slot, tape: Tape, gen: number, cancelled: () => boolean) {
    const targets = slot.runs.filter((run) => !run.hidden || run.id === slot.selectedId)
    const computed = await Promise.all(targets.map((run) => computeBacktest(alignRun(run, slot), tape)))
    if (cancelled() || requestGen.current.get(slot.id) !== gen) return
    setOutcomes((current) => {
      const patch = { ...current }
      targets.forEach((run, index) => {
        const outcome = computed[index]
        if (outcome) patch[run.id] = outcome
      })
      return patch
    })
    setDrawToken((token) => token + 1)
  }

  useEffect(() => {
    const slots = workspaceRef.current.slots
    let cancel = false
    const fetching = new Set<string>()
    for (const slot of slots) {
      const key = tapeKey(slot)
      const gen = (requestGen.current.get(slot.id) ?? 0) + 1
      requestGen.current.set(slot.id, gen)
      const cached = tapesRef.current[key]
      if (cached) {
        setClocks((current) => ({ ...current, [slot.id]: current[slot.id] ?? new Date() }))
        void stageRuns(slot, cached, gen, () => cancel)
        continue
      }
      if (fetching.has(key)) continue
      fetching.add(key)
      const fetchGen = (requestGen.current.get(`fetch:${key}`) ?? 0) + 1
      requestGen.current.set(`fetch:${key}`, fetchGen)
      setLoadingKey(key)
      void fetchCandles(slot.symbol, slot.timeframe, { days: rangeDays(slot.range), range: slot.range, venue: slot.venue })
        .then(async (tape) => {
          if (cancel || requestGen.current.get(`fetch:${key}`) !== fetchGen) return
          const next = { ...tapesRef.current, [key]: tape }
          tapesRef.current = next
          setTapes(next)
          const users = workspaceRef.current.slots.filter((item) => tapeKey(item) === key)
          setClocks((current) => {
            const patch = { ...current }
            for (const item of users) patch[item.id] = new Date()
            return patch
          })
          setErrors((current) => {
            const patch = { ...current }
            let changed = false
            for (const item of users) {
              if (patch[item.id]) {
                patch[item.id] = null
                changed = true
              }
            }
            return changed ? patch : current
          })
          for (const item of users) {
            const itemGen = requestGen.current.get(item.id)
            if (itemGen == null) continue
            await stageRuns(item, tape, itemGen, () => cancel)
          }
        })
        .catch((reason: unknown) => {
          if (cancel || requestGen.current.get(`fetch:${key}`) !== fetchGen) return
          const message = reason instanceof Error ? reason.message : "The tape didn't load."
          setErrors((current) => {
            const patch = { ...current }
            for (const item of workspaceRef.current.slots) {
              if (tapeKey(item) === key) patch[item.id] = message
            }
            return patch
          })
        })
        .finally(() => {
          if (requestGen.current.get(`fetch:${key}`) === fetchGen) {
            setLoadingKey((current) => (current === key ? null : current))
          }
        })
    }
    return () => {
      cancel = true
    }
  }, [slotKeys])

  const refreshTail = useCallback(async () => {
    const current = workspaceRef.current
    const targets = visibleSlots(current)
    await Promise.all(
      targets.map(async (slot) => {
        const key = tapeKey(slot)
        const existing = tapesRef.current[key]
        if (!existing) return
        const since = existing.candles[existing.candles.length - 1]?.t
        try {
          const tail = await fetchCandles(slot.symbol, slot.timeframe, { since, venue: slot.venue })
          const base = tapesRef.current[key]
          if (!base || tapeKey(slot) !== key) return
          const merged = mergeFundingTape(base, tail, slot.venue)
          const next = { ...tapesRef.current, [key]: merged }
          tapesRef.current = next
          setTapes(next)
          setStale(false)
          setClocks((clock) => ({ ...clock, [slot.id]: new Date() }))
          const run = slot.runs.find((item) => item.id === slot.selectedId)
          if (!run) return
          const outcome = await computeBacktest(alignRun(run, slot), merged)
          setOutcomes((prev) => ({ ...prev, [run.id]: outcome }))
        } catch {
          setStale(true)
        }
      }),
    )
  }, [])

  useEffect(() => {
    if (!active || setupOpen || editing || loadingKey === tapeKey(active)) return
    const timer = window.setInterval(() => {
      void refreshTail()
    }, pollIntervalMs(active.timeframe))
    return () => window.clearInterval(timer)
  }, [active, editing, loadingKey, refreshTail, setupOpen])

  function patchSlot(id: string, patch: Partial<Slot>) {
    setWorkspace((current) => ({
      ...current,
      slots: current.slots.map((slot) => (slot.id === id ? applySlotPatch(slot, patch) : slot)),
    }))
  }

  function focusSlot(id: string) {
    setWorkspace((current) => {
      if (id === current.activeId) return current
      if (id === current.pinnedId) return { ...current, activeId: id, pinnedId: current.activeId }
      return { ...current, activeId: id }
    })
  }

  function pinSlot(id: string) {
    setWorkspace((current) => ({ ...current, pinnedId: current.pinnedId === id ? null : id }))
  }

  function closeSlot(id: string) {
    setWorkspace((current) => {
      if (current.slots.length <= 1) return current
      const slots = current.slots.filter((slot) => slot.id !== id)
      return {
        ...current,
        slots,
        activeId: current.activeId === id ? slots[0]!.id : current.activeId,
        pinnedId: current.pinnedId === id ? null : current.pinnedId,
      }
    })
  }

  function addSlot() {
    if (!active || workspace.slots.length >= MAX_SLOTS) return
    const taken = new Set(workspace.slots.map((slot) => `${slot.venue}:${slot.symbol}`))
    const symbol = MAJORS.find((item) => !taken.has(`spot:${item}`)) ?? active.symbol
    const slot = createSlot(symbol, "spot", active.timeframe, active.range)
    setWorkspace((current) => ({ ...current, slots: [...current.slots, slot], activeId: slot.id }))
  }

  function openSymbol(symbol: MarketId, venue: Venue) {
    const existing = workspace.slots.find((slot) => slot.symbol === symbol && slot.venue === venue)
    if (existing) {
      focusSlot(existing.id)
      return
    }
    if (!active || workspace.slots.length >= MAX_SLOTS) {
      if (active) patchSlot(active.id, { symbol })
      return
    }
    const slot = createSlot(symbol, venue, active.timeframe, active.range)
    setWorkspace((current) => ({ ...current, slots: [...current.slots, slot], activeId: slot.id }))
  }

  function updateRun(next: Run) {
    if (!active) return
    const prev = active.runs.find((run) => run.id === next.id)
    const symbolChanged = next.symbol !== active.symbol
    const symbol = symbolChanged ? next.symbol : active.symbol
    const patched = alignRun({ ...next, allowShort: active.venue === "spot" ? false : next.allowShort }, {
      ...active,
      symbol,
    })
    setWorkspace((current) => ({
      ...current,
      slots: current.slots.map((slot) => {
        if (slot.id !== active.id) return slot
        const runs = slot.runs.map((run) => (run.id === next.id ? { ...patched, symbol } : { ...run, symbol }))
        return { ...slot, symbol, runs }
      }),
    }))
    if (!prev) return
    const restage = prev.allowShort !== patched.allowShort || prev.capital !== patched.capital || prev.leverage !== patched.leverage
    if (!restage) return
    const tape = tapesRef.current[tapeKey({ ...active, symbol })]
    if (!tape) return
    void computeBacktest({ ...patched, symbol }, tape).then((outcome) => {
      setOutcomes((current) => ({ ...current, [patched.id]: outcome }))
    })
  }

  const selectRun = useCallback((id: string) => {
    const slot = workspaceRef.current.slots.find((item) => item.id === workspaceRef.current.activeId)
    if (!slot) return
    setWorkspace((current) => ({
      ...current,
      slots: current.slots.map((item) => (item.id === slot.id ? { ...item, selectedId: id } : item)),
    }))
    const run = slot.runs.find((item) => item.id === id)
    const tape = tapesRef.current[tapeKey(slot)]
    if (!run || !tape) return
    const aligned = alignRun(run, slot)
    const existing = outcomesRef.current[run.id]
    if (existing?.ok && existing.fingerprint === fingerprint(aligned)) return
    void computeBacktest(aligned, tape).then((outcome) => {
      setOutcomes((current) => ({ ...current, [run.id]: outcome }))
    })
  }, [])

  const removeRun = useCallback((id: string) => {
    setWorkspace((current) => ({
      ...current,
      slots: current.slots.map((slot) => {
        if (slot.id !== current.activeId) return slot
        const runs = slot.runs.filter((run) => run.id !== id)
        if (runs.length === 0) return slot
        const selectedId = slot.selectedId === id ? runs[0]!.id : slot.selectedId
        return { ...slot, runs, selectedId }
      }),
    }))
  }, [])

  function addRun() {
    if (!active || active.runs.length >= MAX_RUNS) return
    const run = createRun(
      { name: uniqueName("SMA 20/50", active.runs), symbol: active.symbol, allowShort: active.venue === "perp" },
      active.runs,
    )
    setWorkspace((current) => ({
      ...current,
      slots: current.slots.map((slot) =>
        slot.id === active.id ? { ...slot, runs: [...slot.runs, run], selectedId: run.id } : slot,
      ),
    }))
    const tape = tapesRef.current[tapeKey(active)]
    if (tape) void computeBacktest(run, tape).then((outcome) => setOutcomes((current) => ({ ...current, [run.id]: outcome })))
  }

  function duplicateRun() {
    if (!active || !selected || active.runs.length >= MAX_RUNS) return
    const copy = createRun(
      {
        name: uniqueName(suggestedName(selected.rule, selected.params), active.runs),
        symbol: active.symbol,
        rule: selected.rule,
        params: { ...selected.params },
        feeBps: selected.feeBps,
        capital: selected.capital,
        leverage: selected.leverage,
        allowShort: active.venue === "perp" && selected.allowShort,
      },
      active.runs,
    )
    setWorkspace((current) => ({
      ...current,
      slots: current.slots.map((slot) =>
        slot.id === active.id ? { ...slot, runs: [...slot.runs, copy], selectedId: copy.id } : slot,
      ),
    }))
    const tape = tapesRef.current[tapeKey(active)]
    if (tape) void computeBacktest(copy, tape).then((outcome) => setOutcomes((current) => ({ ...current, [copy.id]: outcome })))
  }

  async function ensureTape(slot: Slot): Promise<Tape> {
    const key = tapeKey(slot)
    const cached = tapesRef.current[key]
    if (cached) return cached
    const tape = await fetchCandles(slot.symbol, slot.timeframe, { days: rangeDays(slot.range), range: slot.range, venue: slot.venue })
    const next = { ...tapesRef.current, [key]: tape }
    tapesRef.current = next
    setTapes(next)
    setClocks((current) => ({ ...current, [slot.id]: new Date() }))
    return tape
  }

  async function runSelected() {
    if (!active || !selected) return
    setRunning(true)
    setErrors((current) => ({ ...current, [active.id]: null }))
    try {
      const tape = await ensureTape(active)
      const outcome = await computeBacktest(alignRun(selected, active), tape)
      setOutcomes((prev) => ({ ...prev, [selected.id]: outcome }))
      setDrawToken((token) => token + 1)
      setSetupOpen(false)
      if (!outcome.ok) setErrors((current) => ({ ...current, [active.id]: outcome.error }))
    } catch (reason: unknown) {
      setErrors((current) => ({
        ...current,
        [active.id]: reason instanceof Error ? reason.message : "The backtest didn't run.",
      }))
    } finally {
      setRunning(false)
    }
  }

  async function runAll() {
    if (!active) return
    setRunning(true)
    setErrors((current) => ({ ...current, [active.id]: null }))
    const slot = active
    try {
      const tape = await ensureTape(slot)
      const runs = slot.runs.map((run) => alignRun(run, slot))
      const computed = await Promise.all(runs.map((run) => computeBacktest(run, tape)))
      setOutcomes((prev) => {
        const patch = { ...prev }
        runs.forEach((run, index) => {
          const outcome = computed[index]
          if (outcome) patch[run.id] = outcome
        })
        return patch
      })
      setDrawToken((token) => token + 1)
      setSetupOpen(false)
    } catch (reason: unknown) {
      setErrors((current) => ({
        ...current,
        [slot.id]: reason instanceof Error ? reason.message : "The backtests didn't run.",
      }))
    } finally {
      setRunning(false)
    }
  }

  const activeKey = active ? tapeKey(active) : ""
  const activeTape = active ? tapes[activeKey] : undefined
  const selectedOutcome = selected ? outcomes[selected.id] : undefined
  const result = selectedOutcome?.ok ? selectedOutcome.result : null
  const overlays = useMemo<OverlaySeries[]>(() => {
    if (!active) return []
    return active.runs.flatMap((run, index) => {
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
    })
  }, [active, outcomes])
  const error = active ? errors[active.id] : null
  const phrase = phraseFor(active?.timeframe ?? "1d")

  return (
    <div className="flex h-svh min-h-0 flex-col">
      {active && selected ? (
        <DeskBar
          symbol={active.symbol}
          timeframe={active.timeframe}
          range={active.range}
          venue={active.venue}
          tape={activeTape ?? null}
          stale={stale}
          lastFetchAt={clocks[active.id] ?? null}
          onSymbol={(symbol) => openSymbol(symbol, active.venue)}
          onTimeframe={(timeframe) => patchSlot(active.id, { timeframe })}
          onRange={(range) => patchSlot(active.id, { range })}
          onVenue={(venue) => patchSlot(active.id, { venue })}
        />
      ) : null}
      <WorkspaceBar
        slots={workspace.slots}
        activeId={workspace.activeId}
        pinnedId={workspace.pinnedId}
        onFocus={focusSlot}
        onPin={pinSlot}
        onClose={closeSlot}
        onAdd={addSlot}
      />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <Watchlist slots={workspace.slots} activeId={workspace.activeId} onFocus={focusSlot} onOpen={openSymbol} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {error ? (
            <div role="alert" className="bezel mx-3 mt-3 shrink-0 px-4 py-3 text-sm text-down">
              {error}
            </div>
          ) : null}
          <div className="flex min-h-0 min-w-0" style={{ flex: `${panes.chart} 1 0%` }}>
            {shown.map((slot) => (
              <div
                key={slot.id}
                className={cn("min-h-0 min-w-0 flex-1 p-3", slot.id !== workspace.activeId && "hidden xl:block")}
              >
                <MarketPane
                  symbol={slot.symbol}
                  candles={tapes[tapeKey(slot)]?.candles ?? EMPTY_CANDLES}
                  trades={tradesFor(slot, outcomes)}
                  interval={slot.timeframe}
                  venue={slot.venue}
                  bookWidth={panes.book}
                  candleClock={clocks[slot.id] ?? null}
                  showCaption={shown.length > 1}
                  onBookWidth={(book) => setPanes((current) => ({ ...current, book }))}
                />
              </div>
            ))}
          </div>
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize the price chart"
            aria-valuemin={Math.round(CHART_MIN * 100)}
            aria-valuemax={Math.round(CHART_MAX * 100)}
            aria-valuenow={Math.round(panes.chart * 100)}
            tabIndex={0}
            className="relative z-10 flex h-3 shrink-0 cursor-row-resize items-center before:absolute before:inset-x-0 before:top-1/2 before:h-px before:bg-border"
            onPointerDown={(event) => dragChart(event, (chart) => setPanes((current) => ({ ...current, chart })))}
            onKeyDown={(event) => {
              if (event.key === "ArrowUp") setPanes((current) => ({ ...current, chart: clampChart(current.chart - 0.03) }))
              if (event.key === "ArrowDown") setPanes((current) => ({ ...current, chart: clampChart(current.chart + 0.03) }))
            }}
          />
          <div className="flex min-h-0 flex-col overflow-hidden px-3 pb-24 lg:pb-3" style={{ flex: `${Math.max(0.01, 1 - panes.chart)} 1 0%` }}>
            {loadingKey === activeKey && !activeTape ? (
              <p className="py-4 text-sm text-muted-foreground">Pulling the {phrase} tape. The first look at a pair can take a few seconds.</p>
            ) : null}
            {selectedOutcome && !selectedOutcome.ok ? <p className="py-2 font-heading text-2xl">{selectedOutcome.error}</p> : null}
            {result && active && selected ? (
              <div className="min-h-0 flex-1">
              <Results
                runs={active.runs}
                outcomes={outcomes}
                selected={selected}
                result={result}
                venue={active.venue}
                overlays={overlays}
                sortKey={sortKey}
                sortDir={sortDir}
                onSelect={selectRun}
                onToggleHidden={(id) => {
                  setWorkspace((current) => ({
                    ...current,
                    slots: current.slots.map((slot) =>
                      slot.id === active.id
                        ? { ...slot, runs: slot.runs.map((run) => (run.id === id ? { ...run, hidden: !run.hidden } : run)) }
                        : slot,
                    ),
                  }))
                }}
                onRemove={removeRun}
                onSort={(key) => {
                  if (sortKey === key) setSortDir((dir) => (dir === "desc" ? "asc" : "desc"))
                  else {
                    setSortKey(key)
                    setSortDir("desc")
                  }
                }}
                drawToken={drawToken}
              />
              </div>
            ) : null}
            {running ? (
              <p className="mt-3 font-mono text-xs tracking-wide text-muted-foreground uppercase">Running the next pass…</p>
            ) : null}
          </div>
        </div>
        <aside className="hidden w-72 shrink-0 overflow-y-auto border-l border-border xl:block">
          <div className="p-3">
            {active && selected ? (
              <Controls
                idPrefix="desk"
                runs={active.runs}
                selected={selected}
                venue={active.venue}
                running={running}
                onSelect={selectRun}
                onChange={updateRun}
                onToggleHidden={(id) =>
                  setWorkspace((current) => ({
                    ...current,
                    slots: current.slots.map((slot) =>
                      slot.id === active.id
                        ? { ...slot, runs: slot.runs.map((run) => (run.id === id ? { ...run, hidden: !run.hidden } : run)) }
                        : slot,
                    ),
                  }))
                }
                onRemove={removeRun}
                onAdd={addRun}
                onDuplicate={duplicateRun}
                onRun={() => void runSelected()}
                onRunAll={() => void runAll()}
                onEditing={setEditing}
              />
            ) : (
              <EmptyRuns onAdd={addSlot} />
            )}
          </div>
        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-[#fffaf4]/90 p-3 xl:hidden">
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
              <SheetDescription>The selected run on this slot: market, rule, and fee.</SheetDescription>
            </SheetHeader>
            <div className="px-8 pb-8">
              {active && selected ? (
                <Controls
                  idPrefix="sheet"
                  runs={active.runs}
                  selected={selected}
                  venue={active.venue}
                  running={running}
                  onSelect={selectRun}
                  onChange={updateRun}
                  onToggleHidden={() => undefined}
                  onRemove={removeRun}
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

function applySlotPatch(slot: Slot, patch: Partial<Slot>): Slot {
  const venue = patch.venue ?? slot.venue
  const symbol = patch.symbol ?? slot.symbol
  const timeframe = patch.timeframe ?? slot.timeframe
  const range = patch.range ?? slot.range
  const runs = (patch.runs ?? slot.runs).map((run) => ({
    ...run,
    symbol,
    allowShort: venue === "spot" ? false : run.allowShort,
  }))
  return { ...slot, ...patch, venue, symbol, timeframe, range, runs }
}

function alignRun(run: Run, slot: Pick<Slot, "symbol" | "venue">): Run {
  return { ...run, symbol: slot.symbol, allowShort: slot.venue === "perp" ? run.allowShort !== false : false }
}

function tradesFor(slot: Slot, outcomes: Record<string, Outcome>): Trade[] {
  const outcome = outcomes[slot.selectedId]
  if (!outcome?.ok) return []
  return slot.venue === "spot" ? outcome.result.trades.filter((trade) => trade.side !== "short") : outcome.result.trades
}

function mergeFundingTape(base: Tape, tail: Tape, venue: Venue): Tape {
  const funding = venue === "perp" ? mergeFunding(base.funding, tail.funding) : undefined
  return {
    ...base,
    candles: mergeCandles(base.candles, tail.candles),
    source: tail.source,
    venue,
    funding,
    fundingStale: venue === "perp" ? tail.funding == null || tail.fundingStale === true : false,
  }
}

function mergeCandles(existing: TapeCandle[], incoming: TapeCandle[]): TapeCandle[] {
  const byTime = new Map<number, TapeCandle>()
  for (const candle of existing) byTime.set(candle.t, candle)
  for (const candle of incoming) byTime.set(candle.t, candle)
  return [...byTime.values()].sort((left, right) => left.t - right.t)
}

function dragChart(event: ReactPointerEvent<HTMLDivElement>, onChart: (fraction: number) => void) {
  const column = event.currentTarget.parentElement
  if (!column) return
  event.currentTarget.setPointerCapture(event.pointerId)
  const move = (ev: PointerEvent) => {
    const rect = column.getBoundingClientRect()
    if (rect.height <= 0) return
    onChart(clampChart((ev.clientY - rect.top) / rect.height))
  }
  const end = () => {
    window.removeEventListener("pointermove", move)
    window.removeEventListener("pointerup", end)
  }
  window.addEventListener("pointermove", move)
  window.addEventListener("pointerup", end)
}

function EmptyRuns({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">No runs on this slot.</p>
      <Button type="button" variant="outline" onClick={onAdd}>
        Add slot
      </Button>
    </div>
  )
}
