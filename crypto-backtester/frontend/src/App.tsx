import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react"

import { type OverlaySeries } from "@/components/charts"
import { useAccountSync } from "@/lib/use-account"
import { CommandPalette, commandPaletteHotkey } from "@/components/command-palette"
import { Controls } from "@/components/controls"
import { DeskBar } from "@/components/desk-bar"
import { BookSpan, MarketPane } from "@/components/market-pane"
import { ResearchChart } from "@/components/research"
import { Results, RunStrip, WindowsPage, type NudgeReturn } from "@/components/results"
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
import { fetchCandles, mergeFunding, requestFailure } from "@/lib/api"
import { ackBotEdits, fetchBotInbox } from "@/lib/bot-api"
import { applyBotEdits, editConcerns } from "@/lib/bot-edits"
import { CorrelationPage } from "@/components/correlation"
import { CrossBookPage } from "@/components/cross-book"
import { DiffPage } from "@/components/diff"
import { JournalPage } from "@/components/journal"
import { PaperPage } from "@/components/paper"
import { ReplayPage } from "@/components/replay"
import { SavedPage } from "@/components/saved"
import type { DeskPage } from "@/components/desk-bar"
import {
  applyScaleOut,
  downloadBacktestCsv,
  downloadLiveRun,
  closeJournalTrade,
  downloadText,
  emptyQuery,
  exportRunFile,
  fillWorkingTicket,
  findRun,
  getRun,
  getStrategy,
  keepDeskRun,
  listRuns,
  liveTicket,
  logTradeOp,
  matchingTrades,
  promoteWorkingTicket,
  syncPaperTrades,
  tradesCsv,
  tradesForRun,
  watchBook,
  type StrategyRecord,
  type TradeRecord,
  type WorkingTicket,
} from "@/lib/records"
import { liveMark } from "@/lib/book"
import { copyShareRun, parseShareRun } from "@/lib/share-run"
import { timeStopDue } from "@/lib/time-stop"
import { ruleParams } from "@/lib/runs"
import { biasLabel, isHigherTimeframe, latestBias } from "@/lib/bias"
import { computeBacktest } from "@/lib/compute"
import { ruleReading } from "@/lib/signals"
import { spotTrades } from "@/lib/plot"
import { CHART_MAX, CHART_MIN, clampChart, loadPanes, savePanes, type PaneSizes } from "@/lib/panes"
import {
  MAX_RUNS,
  createRun,
  comboKey,
  fingerprint,
  nudgeFast,
  normalizeRule,
  phraseFor,
  pollIntervalMs,
  rangeDays,
  runColor,
  runParamsChanged,
  strategyLabel,
  suggestedName,
  uniqueName,
} from "@/lib/runs"
import { dropPosition, lossStreak, nextSession, pinSymbol, pinsOf, resolveSession, ticketFills, upsertPosition, type ArmGate } from "@/lib/desk"
import { runFromKept } from "@/lib/paper"
import { armTapeBlocked, isTapeStale } from "@/lib/stale-tape"
import { bookHeardAt, holdBook, peekBook, subscribeBooks, useBookView } from "@/lib/use-book"
import {
  MAX_SLOTS,
  createSlot,
  loadWorkspace,
  saveWorkspace,
  tapeForSlot,
  tapeKey,
  visibleSlots,
  type Slot,
  type Workspace,
} from "@/lib/workspace"
import type { BacktestResult, MarketId, Outcome, RangeId, Run, SortKey, Tape, TapeCandle, Timeframe, Trade, Venue } from "@/lib/types"
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
  const [tapeRetry, setTapeRetry] = useState(0)
  const tapeTries = useRef(new Map<string, number>())
  const [running, setRunning] = useState(false)
  const [stale, setStale] = useState(false)
  const [panes, setPanes] = useState<PaneSizes>(() => loadPanes())
  const [setupOpen, setSetupOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [drawToken, setDrawToken] = useState(0)
  const [page, setPage] = useState<DeskPage>("desk")
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [daily, setDaily] = useState<Record<string, TapeCandle[]>>({})
  const [dailyPending, setDailyPending] = useState(false)
  const [nudge, setNudge] = useState<{ runId: string; rows: NudgeReturn[] } | null>(null)
  const [nudging, setNudging] = useState(false)
  const [focusTrade, setFocusTrade] = useState<Trade | null>(null)
  const workspaceRef = useRef(workspace)
  const tapesRef = useRef(tapes)
  const outcomesRef = useRef(outcomes)
  const requestGen = useRef(new Map<string, number>())
  workspaceRef.current = workspace
  tapesRef.current = tapes
  outcomesRef.current = outcomes

  const active = workspace.slots.find((slot) => slot.id === workspace.activeId) ?? workspace.slots[0]
  const selected = active?.runs.find((run) => run.id === active.selectedId) ?? active?.runs[0]
  useEffect(() => {
    setFocusTrade(null)
  }, [active?.id, active?.symbol, active?.venue, selected?.id])
  const shown = visibleSlots(workspace)
  const spanBook = useSpanBook() && shown.length === 1

  useEffect(() => {
    saveWorkspace(workspace)
  }, [workspace])

  useEffect(() => {
    savePanes(panes)
  }, [panes])

  const account = useAccountSync(workspace, panes, setWorkspace, setPanes)

  const held = workspace.slots
    .map((slot) => `${slot.venue}:${pinsOf(slot).slice().sort().join(",")}`)
    .join("|")
  const bookHolds = useRef(new Map<string, () => void>())
  useEffect(() => {
    const wanted = new Set<string>()
    for (const slot of workspaceRef.current.slots) {
      for (const symbol of pinsOf(slot)) {
        const key = `${slot.venue}:${symbol}`
        wanted.add(key)
        if (!bookHolds.current.has(key)) bookHolds.current.set(key, holdBook(symbol, slot.venue, true))
      }
    }
    for (const [key, release] of bookHolds.current) {
      if (wanted.has(key)) continue
      release()
      bookHolds.current.delete(key)
    }
  }, [held])

  const slotKeys = workspace.slots.map((slot) => `${slot.id}:${tapeKey(slot)}`).join("|")
  async function biasTapeFor(run: Run, slot: Slot): Promise<Tape | null> {
    const tf = run.biasTimeframe
    if (!tf || !isHigherTimeframe(tf, slot.timeframe)) return null
    const key = tapeKey({ ...slot, timeframe: tf })
    const cached = tapesRef.current[key]
    if (cached) return cached
    try {
      const tape = await fetchCandles(slot.symbol, tf, { days: rangeDays(slot.range), range: slot.range, venue: slot.venue })
      const next = { ...tapesRef.current, [key]: tape }
      tapesRef.current = next
      setTapes(next)
      return tape
    } catch {
      return null
    }
  }

  async function computeFor(run: Run, slot: Slot, tape: Tape): Promise<Outcome> {
    const aligned = alignRun(run, slot)
    const bias = await biasTapeFor(aligned, slot)
    return computeBacktest(aligned, tape, bias)
  }

  async function stageRuns(slot: Slot, tape: Tape, gen: number, cancelled: () => boolean) {
    const targets = slot.runs.filter((run) => !run.hidden || run.id === slot.selectedId)
    const computed = await Promise.all(targets.map((run) => computeFor(run, slot, tape)))
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
      const attempt = { retry: false }
      setLoadingKey(key)
      void fetchCandles(slot.symbol, slot.timeframe, { days: rangeDays(slot.range), range: slot.range, venue: slot.venue })
        .then(async (tape) => {
          if (cancel || requestGen.current.get(`fetch:${key}`) !== fetchGen) return
          tapeTries.current.delete(key)
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
          const tries = tapeTries.current.get(key) ?? 0
          if (tries < 3) {
            attempt.retry = true
            tapeTries.current.set(key, tries + 1)
            window.setTimeout(() => {
              setTapeRetry((current) => current + 1)
            }, 400 * 2 ** tries)
            return
          }
          // Keep the last good tape on screen. Only surface a hard error when this key is empty.
          if (tapesRef.current[key]?.candles.length) {
            setStale(true)
            return
          }
          const message = requestFailure(reason, "The tape didn't load.")
          setErrors((current) => {
            const patch = { ...current }
            for (const item of workspaceRef.current.slots) {
              if (tapeKey(item) === key) patch[item.id] = message
            }
            return patch
          })
        })
        .finally(() => {
          if (attempt.retry) return
          if (requestGen.current.get(`fetch:${key}`) === fetchGen) {
            setLoadingKey((current) => (current === key ? null : current))
          }
        })
    }
    return () => {
      cancel = true
    }
  }, [slotKeys, tapeRetry])

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
          const outcome = await computeFor(run, slot, merged)
          setOutcomes((prev) => ({ ...prev, [run.id]: outcome }))
        } catch {
          setStale(true)
        }
      }),
    )
  }, [])

  useEffect(() => {
    if (editing || setupOpen) return
    let stop = false
    const poll = async () => {
      if (stop) return
      try {
        const edits = (await fetchBotInbox()).filter((edit) => editConcerns(workspaceRef.current, edit.ops ?? []))
        if (stop || edits.length === 0) return
        const current = workspaceRef.current
        const ops = edits.flatMap((edit) => (Array.isArray(edit.ops) ? edit.ops : []))
        for (const op of ops) {
          if (op.op === "log-trade") await logTradeOp(op)
        }
        const next = applyBotEdits(
          current,
          ops.filter((op) => op.op !== "log-trade"),
        )
        if (next !== current) {
          workspaceRef.current = next
          setWorkspace(next)
          for (const slot of next.slots) {
            const tape = tapesRef.current[tapeKey(slot)]
            if (!tape) continue
            const gen = (requestGen.current.get(slot.id) ?? 0) + 1
            requestGen.current.set(slot.id, gen)
            void stageRuns(slot, tape, gen, () => stop)
          }
        }
        await ackBotEdits(edits.map((edit) => edit.id))
      } catch {
        /* the desk keeps working when the key service is down */
      }
    }
    const timer = window.setInterval(() => void poll(), 2000)
    void poll()
    return () => {
      stop = true
      window.clearInterval(timer)
    }
  }, [editing, setupOpen])

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

  function retryTape(slot: Slot) {
    const key = tapeKey(slot)
    tapeTries.current.delete(key)
    setErrors((current) => {
      const patch = { ...current }
      let changed = false
      for (const item of workspaceRef.current.slots) {
        if (tapeKey(item) !== key || !patch[item.id]) continue
        patch[item.id] = null
        changed = true
      }
      return changed ? patch : current
    })
    setTapeRetry((current) => current + 1)
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
    if (prev?.locked && runParamsChanged(prev, patched)) {
      if (active.runs.length >= MAX_RUNS) return
      const copy = createRun(
        {
          name: uniqueName(patched.name, active.runs),
          symbol,
          rule: patched.rule,
          params: { ...patched.params },
          feeBps: patched.feeBps,
          slippageBps: patched.slippageBps,
          capital: patched.capital,
          leverage: patched.leverage,
          riskPct: patched.riskPct,
          biasTimeframe: patched.biasTimeframe,
          combo: (patched.combo ?? []).map((item) => ({ rule: item.rule, params: { ...item.params } })),
          allowShort: active.venue === "perp" && patched.allowShort,
          locked: false,
        },
        active.runs,
      )
      setWorkspace((current) => ({
        ...current,
        slots: current.slots.map((slot) => {
          if (slot.id !== active.id) return slot
          const pinned = pinSymbol(slot.pins, slot.symbol, symbol)
          return {
            ...slot,
            symbol: pinned.symbol,
            pins: pinned.pins,
            runs: [...slot.runs.map((run) => ({ ...run, symbol })), copy],
            selectedId: copy.id,
          }
        }),
      }))
      const tape = tapesRef.current[tapeKey({ ...active, symbol })]
      if (tape) void computeFor(copy, { ...active, symbol }, tape).then((outcome) => setOutcomes((current) => ({ ...current, [copy.id]: outcome })))
      return
    }
    setWorkspace((current) => ({
      ...current,
      slots: current.slots.map((slot) => {
        if (slot.id !== active.id) return slot
        const runs = slot.runs.map((run) => (run.id === next.id ? { ...patched, symbol } : { ...run, symbol }))
        const pinned = pinSymbol(slot.pins, slot.symbol, symbol)
        return { ...slot, symbol: pinned.symbol, pins: pinned.pins, runs }
      }),
    }))
    if (!prev) return
    const restage =
      prev.allowShort !== patched.allowShort ||
      prev.capital !== patched.capital ||
      prev.leverage !== patched.leverage ||
      prev.riskPct !== patched.riskPct ||
      prev.feeBps !== patched.feeBps ||
      prev.slippageBps !== patched.slippageBps ||
      prev.biasTimeframe !== patched.biasTimeframe ||
      comboKey(prev) !== comboKey(patched)
    if (!restage) return
    const tape = tapesRef.current[tapeKey({ ...active, symbol })]
    if (!tape) return
    void computeFor({ ...patched, symbol }, { ...active, symbol }, tape).then((outcome) => {
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
    void computeFor(run, slot, tape).then((outcome) => {
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
    if (tape) void computeFor(run, active, tape).then((outcome) => setOutcomes((current) => ({ ...current, [run.id]: outcome })))
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
        riskPct: selected.riskPct,
        biasTimeframe: selected.biasTimeframe,
        combo: (selected.combo ?? []).map((item) => ({ rule: item.rule, params: { ...item.params } })),
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
    if (tape) void computeFor(copy, active, tape).then((outcome) => setOutcomes((current) => ({ ...current, [copy.id]: outcome })))
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

  async function runNudge() {
    if (!active || !selected) return
    const aligned = alignRun(selected, active)
    const steps = nudgeFast(aligned)
    if (!steps) return
    setNudging(true)
    setErrors((current) => ({ ...current, [active.id]: null }))
    try {
      const tape = await ensureTape(active)
      const computed = await Promise.all(steps.map((step) => computeFor({ ...aligned, params: step.params }, active, tape)))
      setNudge({
        runId: selected.id,
        rows: steps.map((step, index) => ({
          name: step.name,
          returnPct: computed[index]?.ok ? computed[index].result.metrics.total_return_pct : null,
        })),
      })
      setSetupOpen(false)
    } catch (reason: unknown) {
      setErrors((current) => ({
        ...current,
        [active.id]: reason instanceof Error ? reason.message : "The nudge didn't run.",
      }))
    } finally {
      setNudging(false)
    }
  }

  async function runSelected(run: Run) {
    if (!active) return
    setRunning(true)
    setErrors((current) => ({ ...current, [active.id]: null }))
    try {
      const tape = await ensureTape(active)
      const outcome = await computeFor(run, active, tape)
      setOutcomes((prev) => ({ ...prev, [run.id]: outcome }))
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

  async function runAll(edited: Run) {
    if (!active) return
    setRunning(true)
    setErrors((current) => ({ ...current, [active.id]: null }))
    const slot = active
    try {
      const tape = await ensureTape(slot)
      const runs = slot.runs.map((run) => (run.id === edited.id ? edited : run))
      const computed = await Promise.all(runs.map((run) => computeFor(run, slot, tape)))
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

  function keptMetrics(metrics: BacktestResult["metrics"]) {
    return {
      total_return_pct: metrics.total_return_pct,
      cagr_pct: metrics.cagr_pct,
      max_drawdown_pct: metrics.max_drawdown_pct,
      sharpe: metrics.sharpe,
      win_rate_pct: metrics.win_rate_pct,
      profit_factor: metrics.profit_factor,
      expectancy: metrics.expectancy,
      trades: metrics.trades,
      final_equity: metrics.final_equity,
    }
  }

  function setupMatch() {
    if (!active || !selected) return null
    return {
      symbol: active.symbol,
      market: active.venue,
      timeframe: active.timeframe,
      range: active.range,
      rule: selected.rule,
      params: selected.params,
    }
  }

  async function keepSelected(note: string) {
    if (!active || !selected || !fitsSlot(active, selectedOutcome)) return
    const outcome = selectedOutcome.result
    await keepDeskRun({
      name: selected.name,
      symbol: active.symbol,
      venue: active.venue,
      timeframe: active.timeframe,
      range: active.range,
      rule: selected.rule,
      params: { ...selected.params },
      combo: (selected.combo ?? []).map((item) => ({ rule: item.rule, params: { ...item.params } })),
      fee: selected.feeBps,
      slippage: selected.slippageBps,
      capital: selected.capital,
      leverage: active.venue === "perp" ? selected.leverage : 1,
      risk: selected.riskPct,
      allowShort: active.venue === "perp" && selected.allowShort,
      note,
      trades: outcome.trades,
      metrics: keptMetrics(outcome.metrics),
      sample: {
        inSample: outcome.in_sample,
        holdout: outcome.holdout,
        windows: outcome.walk_forward.slice(0, 3),
      },
      costs: {
        beforeFees: outcome.metrics.return_before_fees_pct,
        fees: outcome.metrics.fees_paid,
        slippage: outcome.trades.reduce((sum, trade) => sum + (trade.slippage_paid ?? 0), 0),
        afterCosts: outcome.metrics.total_return_pct,
      },
    })
    try {
      await copyShareRun({
        symbol: active.symbol,
        market: active.venue,
        timeframe: active.timeframe,
        rule: selected.rule,
        params: { ...selected.params },
      })
    } catch {
      // Clipboard can fail without a gesture or permissions.
    }
    setPage("saved")
  }

  async function exportSelected(note: string) {
    const match = setupMatch()
    if (!match || !active || !selected) return
    const found = await findRun(match)
    if (found) {
      await exportRunFile(found.run.id)
      return
    }
    if (!fitsSlot(active, selectedOutcome)) return
    const outcome = selectedOutcome.result
    downloadLiveRun({
      name: selected.name,
      symbol: active.symbol,
      venue: active.venue,
      timeframe: active.timeframe,
      range: active.range,
      rule: selected.rule,
      params: { ...selected.params },
      fee: outcome.assumptions.fee_bps,
      slippage: outcome.assumptions.slippage_bps,
      risk: outcome.assumptions.risk_pct,
      note,
      metrics: keptMetrics(outcome.metrics),
      trades: outcome.trades,
    })
  }

  async function exportTradesSelected() {
    const match = setupMatch()
    if (!match || !active) return
    const found = await findRun(match)
    if (found) {
      const rows = await tradesForRun(found.run.id)
      downloadText(`wick-${found.strategy.symbol}-trades.csv`, tradesCsv(rows), "text/csv")
      return
    }
    if (!fitsSlot(active, selectedOutcome)) return
    const trades = selectedOutcome.result.trades
    const shown = active.venue === "spot" ? trades.filter((trade) => trade.side !== "short") : trades
    downloadBacktestCsv(active.symbol, shown)
  }

  async function restoreKept(ids: { strategyId: string; runId: string }) {
    const strategy = await getStrategy(ids.strategyId)
    const run = await getRun(ids.runId)
    if (!strategy || !run || run.strategyId !== strategy.id) return
    openSetup(
      { symbol: strategy.symbol, venue: strategy.market, timeframe: strategy.timeframe, range: run.range },
      { ...runFields(strategy), locked: run.locked === true },
    )
  }

  useEffect(() => {
    const shared = parseShareRun(window.location.search)
    if (!shared) return
    openSetup(
      { symbol: shared.symbol, venue: shared.market, timeframe: shared.timeframe, range: "1Y" },
      {
        symbol: shared.symbol as MarketId,
        rule: normalizeRule(shared.rule),
        params: ruleParams(normalizeRule(shared.rule), shared.params),
        allowShort: shared.market === "perp",
      },
    )
    const url = new URL(window.location.href)
    url.search = ""
    window.history.replaceState({}, "", url.pathname)
  }, [])

  function openSetup(seed: { symbol: string; venue: Venue; timeframe: string; range: string }, partial: Partial<Run>) {
    const run = createRun(partial)
    setPage("desk")
    setWorkspace((current) => placeKept(current, seed, run))
  }

  function runFields(strategy: StrategyRecord): Partial<Run> {
    return {
      name: strategy.name,
      symbol: strategy.symbol as MarketId,
      rule: normalizeRule(strategy.rule),
      params: { ...strategy.params },
      combo: strategy.combo.map((item) => ({ rule: normalizeRule(item.rule), params: { ...item.params } })),
      feeBps: strategy.fee,
      slippageBps: strategy.slippage,
      capital: strategy.capital,
      leverage: strategy.market === "perp" ? strategy.leverage : 1,
      riskPct: strategy.risk,
      allowShort: strategy.market === "perp" && strategy.allowShort,
    }
  }

  const activeKey = active ? tapeKey(active) : ""
  const activeTape = active ? tapes[activeKey] : undefined
  const selectedOutcome = selected ? outcomes[selected.id] : undefined
  const result = active && fitsSlot(active, selectedOutcome) ? selectedOutcome.result : null
  const overlays = useMemo<OverlaySeries[]>(() => {
    if (!active) return []
    return active.runs.flatMap((run, index) => {
      if (run.hidden) return []
      const outcome = outcomes[run.id]
      if (!fitsSlot(active, outcome)) return []
      return [
        {
          id: run.id,
          name: `${run.name} · ${strategyLabel(run)}`,
          color: runColor(index),
          equity: outcome.result.equity.map((point) => ({ time: point.time, equity: point.equity })),
        },
      ]
    })
  }, [active, outcomes])
  const reading = useMemo(() => {
    if (!focusTrade || !activeTape || !selected) return []
    return ruleReading(normalizeRule(selected.rule), activeTape.candles, selected.params, focusTrade.entry_time)
  }, [activeTape, focusTrade, selected])
  const activeTapeReady = active ? Boolean(tapeForSlot(tapes, active)?.candles.length) : false
  const error = active && !activeTapeReady ? errors[active.id] : null
  function rememberPosition(trade: TradeRecord) {
    if (trade.exitTime != null) return
    setWorkspace((current) => ({
      ...current,
      positions: upsertPosition(current.positions, {
        symbol: trade.symbol,
        market: trade.market,
        side: trade.side,
        size: trade.size,
        entry: trade.entryPrice,
        stop: trade.stop,
        tradeId: trade.id,
      }),
    }))
  }

  function forgetPosition(tradeId: string) {
    setWorkspace((current) => ({ ...current, positions: dropPosition(current.positions, tradeId) }))
  }

  async function flatTrade(trade: TradeRecord, price: number) {
    if (price > 0) {
      await closeJournalTrade(trade.id, price, {
        feeBps: selected?.feeBps ?? 10,
        slippageBps: selected?.slippageBps ?? 5,
      })
    }
    forgetPosition(trade.id)
  }

  async function flatMarket(symbol: string, market: Venue, price: number) {
    const position = workspaceRef.current.positions.find((item) => item.symbol === symbol && item.market === market)
    if (!position) return
    if (price > 0) {
      await closeJournalTrade(position.tradeId, price, {
        feeBps: selected?.feeBps ?? 10,
        slippageBps: selected?.slippageBps ?? 5,
      })
    }
    forgetPosition(position.tradeId)
  }

  /** Close the open desk position at the mark, disarm Arm, journal the close. Stand-down unchanged. */
  async function flattenSlot(slot: Slot) {
    const mark = liveMark(peekBook(slot.symbol, slot.venue))?.price ?? 0
    await flatMarket(slot.symbol, slot.venue, mark)
    setWorkspace((current) => ({
      ...current,
      slots: current.slots.map((item) => (item.id === slot.id ? { ...item, alert: null, armGate: null } : item)),
    }))
  }

  async function promoteTicket(id: string) {
    const promoted = await promoteWorkingTicket(id)
    if (!promoted) return
    const gate: ArmGate = {
      ticketId: promoted.ticket.id,
      symbol: promoted.ticket.symbol,
      market: promoted.ticket.market,
      side: promoted.ticket.side,
      entry: promoted.ticket.entry,
      stop: promoted.ticket.stop,
      size: promoted.ticket.size,
      r: promoted.ticket.r,
    }
    setWorkspace((current) => ({
      ...current,
      slots: current.slots.map((slot) =>
        slot.venue === gate.market && pinsOf(slot).includes(gate.symbol) ? { ...slot, armGate: gate } : slot,
      ),
    }))
    if (promoted.trade.exitTime == null) rememberPosition(promoted.trade)
  }

  async function fillTicket(ticket: WorkingTicket, price: number) {
    const filled = await fillWorkingTicket(ticket.id, price)
    if (!filled || filled.trade.exitTime != null) return
    rememberPosition(filled.trade)
  }

  const phrase = phraseFor(active?.timeframe ?? "1d")
  const openTrades = useOpenJournal()
  const journalTrades = useJournalTrades()
  const streak = lossStreak(journalTrades, workspace.lossHaltAck)
  const lossHalted = workspace.lossHalt || streak >= workspace.lossLimit
  useEffect(() => {
    if (streak < workspace.lossLimit || workspace.lossHalt) return
    setWorkspace((current) => (current.lossHalt ? current : { ...current, lossHalt: true }))
  }, [streak, workspace.lossLimit, workspace.lossHalt])
  const session = lossHalted ? "stand-down" : resolveSession(workspace.session)
  const tapeNow = useTapeNow()
  const correlationKey = `${active?.venue ?? "spot"}:${workspace.correlationSymbols.join(",")}`
  const scoredCandle = useRef(new Map<string, string>())

  function slotCandleGrace(slot: Slot): number {
    return Math.max(15_000, pollIntervalMs(slot.timeframe))
  }

  function slotTapeStale(slot: Slot): boolean {
    return isTapeStale(bookHeardAt(slot.symbol, slot.venue), clocks[slot.id]?.getTime() ?? null, tapeNow, slotCandleGrace(slot))
  }

  function slotArmTapeBlocked(slot: Slot): boolean {
    return armTapeBlocked(bookHeardAt(slot.symbol, slot.venue), clocks[slot.id]?.getTime() ?? null, tapeNow, slotCandleGrace(slot))
  }
  useEffect(() => {
    let cancel = false
    void (async () => {
      const kept = await listRuns()
      if (cancel) return
      for (const row of kept) {
        if (!row.run.paper || !row.run.paperSince) continue
        const tape = Object.values(tapesRef.current).find(
          (item) => item.symbol === row.strategy.symbol && item.venue === row.strategy.market && item.interval === row.strategy.timeframe,
        )
        const last = tape?.candles.at(-1)?.time
        if (!tape || !last || tape.candles.length < 3) continue
        if (scoredCandle.current.get(row.run.id) === last) continue
        const paperRun = runFromKept(row)
        const paperSlot = {
          symbol: row.strategy.symbol as MarketId,
          venue: row.strategy.market,
          timeframe: row.strategy.timeframe as Timeframe,
          range: row.run.range as RangeId,
        }
        const bias =
          paperRun.biasTimeframe && isHigherTimeframe(paperRun.biasTimeframe, paperSlot.timeframe)
            ? Object.values(tapesRef.current).find(
                (item) =>
                  item.symbol === paperSlot.symbol &&
                  item.venue === paperSlot.venue &&
                  item.interval === paperRun.biasTimeframe,
              ) ?? null
            : null
        const outcome = await computeBacktest(paperRun, tape, bias)
        if (cancel || !outcome.ok) continue
        scoredCandle.current.set(row.run.id, last)
        await syncPaperTrades({
          runId: row.run.id,
          strategyId: row.strategy.id,
          symbol: row.strategy.symbol,
          market: row.strategy.market,
          since: row.run.paperSince,
          trades: outcome.result.trades,
        })
      }
    })()
    return () => {
      cancel = true
    }
  }, [tapes])
  useEffect(() => {
    if (page !== "correlation") return
    const symbols = workspace.correlationSymbols
    if (symbols.length === 0) {
      setDaily({})
      setDailyPending(false)
      return
    }
    let cancel = false
    const venue = active?.venue ?? "spot"
    setDailyPending(true)
    void Promise.all(symbols.map((symbol) => fetchCandles(symbol, "1d", { days: 45, venue }).catch(() => null))).then((rows) => {
      if (cancel) return
      const next: Record<string, TapeCandle[]> = {}
      symbols.forEach((symbol, index) => {
        const tape = rows[index]
        if (tape) next[symbol] = tape.candles
      })
      setDaily(next)
      setDailyPending(false)
    })
    return () => {
      cancel = true
    }
  }, [page, correlationKey, active?.venue, workspace.correlationSymbols])

  function slotBias(slot: Slot): "with trend" | "against" | null {
    const run = slot.runs.find((item) => item.id === slot.selectedId)
    const tf = run?.biasTimeframe
    if (!tf || !isHigherTimeframe(tf, slot.timeframe)) return null
    const biasTape = tapes[tapeKey({ ...slot, timeframe: tf })]
    if (!biasTape) return null
    return biasLabel(latestBias(biasTape.candles))
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!commandPaletteHotkey(event)) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return
      event.preventDefault()
      setPaletteOpen((open) => !open)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <div className="desk-shell flex min-h-svh flex-col lg:h-svh lg:min-h-0">
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        venue={active?.venue ?? "spot"}
        onPage={(next) => {
          setPage(next)
          if (next !== "desk") {
            setSetupOpen(false)
            setEditing(false)
          }
        }}
        onSymbol={(symbol) => {
          if (!active) return
          setPage("desk")
          patchSlot(active.id, { symbol })
        }}
        onKeep={() => {
          if (!result) return
          void keepSelected("")
        }}
        canKeep={Boolean(result)}
      />
      {pinKeys(workspace).map((key) => {
        const [venue, symbol] = key.split(":") as [Venue, string]
        return <PinFill key={key} symbol={symbol} venue={venue} onFill={(ticket, price) => void fillTicket(ticket, price)} />
      })}
      {openTrades.map((trade) => (
        <OpenTradeWatch
          key={trade.id}
          trade={trade}
          timeframe={
            workspace.slots.find((slot) => slot.symbol === trade.symbol && slot.venue === trade.market)?.timeframe ??
            active?.timeframe ??
            "1d"
          }
          maxBarsOpen={workspace.maxBarsOpen}
          timeStopClose={workspace.timeStopClose}
          feeBps={selected?.feeBps ?? 10}
          slippageBps={selected?.slippageBps ?? 5}
          onScaled={(runner) => {
            forgetPosition(trade.id)
            if (runner.exitTime == null) rememberPosition(runner)
          }}
          onTimedClose={(closed) => forgetPosition(closed.id)}
        />
      ))}
      {active && selected ? (
        <DeskBar
          symbol={active.symbol}
          timeframe={active.timeframe}
          range={active.range}
          venue={active.venue}
          tape={activeTape ?? null}
          loading={!activeTape && !error}
          stale={stale}
          lastFetchAt={clocks[active.id] ?? null}
          session={session}
          onSession={() => {
            if (lossHalted) return
            setWorkspace((current) => ({ ...current, session: nextSession(resolveSession(current.session)) }))
          }}
          lossCount={streak}
          lossLimit={workspace.lossLimit}
          lossHalted={lossHalted}
          onClearHalt={() => {
            const newest = journalTrades
              .filter((trade) => trade.runId == null && trade.source !== "paper" && trade.exitTime && trade.pnl != null && trade.pnl < 0)
              .map((trade) => trade.exitTime ?? "")
              .sort()
              .at(-1)
            setWorkspace((current) => ({ ...current, lossHalt: false, lossHaltAck: newest || new Date().toISOString() }))
          }}
          onSymbol={(symbol) => patchSlot(active.id, { symbol })}
          onTimeframe={(timeframe) => patchSlot(active.id, { timeframe })}
          onVenue={(venue) => patchSlot(active.id, { venue })}
          page={page}
          accountSession={account.session}
          accountStatus={account.status}
          onCreateAccount={account.create}
          onSignInAccount={account.signIn}
          onSignOutAccount={account.signOut}
          onPage={(next) => {
            setPage(next)
            if (next !== "desk") {
              setSetupOpen(false)
              setEditing(false)
            }
          }}
        />
      ) : null}
      {page === "journal" ? (
        <JournalPage
          symbol={active?.symbol ?? "BTCUSDT"}
          venue={active?.venue ?? "spot"}
          timeframe={active?.timeframe ?? "1d"}
          riskMode={workspace.riskMode}
          session={session}
          positions={workspace.positions}
          maxBarsOpen={workspace.maxBarsOpen}
          feeBps={selected?.feeBps ?? 10}
          slippageBps={selected?.slippageBps ?? 5}
          onLogged={(trade) => {
            if (trade.exitTime == null) rememberPosition(trade)
          }}
          onCloseTrade={(trade, price) => void flatTrade(trade, price)}
          onPromote={(id) => void promoteTicket(id)}
        />
      ) : page === "windows" ? (
        <WindowsPage result={result} runName={selected?.name ?? "Run"} symbol={active?.symbol ?? ""} venue={active?.venue ?? "spot"} />
      ) : page === "replay" ? (
        <ReplayPage
          candles={activeTape?.candles ?? EMPTY_CANDLES}
          trades={selectedOutcome?.ok ? selectedOutcome.result.trades : []}
          venue={active?.venue ?? "spot"}
          name={selected ? `${selected.name} · ${strategyLabel(selected)}` : "No run"}
          pending={!activeTape && !error}
        />
      ) : page === "paper" ? (
        <PaperPage
          sinceFor={(symbol, venue, timeframe) => {
            const tape = Object.values(tapes).find((item) => item.symbol === symbol && item.venue === venue && item.interval === timeframe)
            return tape?.candles.at(-1)?.time ?? new Date().toISOString()
          }}
        />
      ) : page === "correlation" ? (
        <CorrelationPage
          pending={dailyPending}
          symbols={workspace.correlationSymbols}
          venue={active?.venue ?? "spot"}
          onSymbols={(correlationSymbols) => setWorkspace((current) => ({ ...current, correlationSymbols }))}
          series={workspace.correlationSymbols.map((symbol) => ({ symbol, candles: daily[symbol] ?? [] }))}
        />
      ) : page === "cross" ? (
        <CrossBookPage
          run={selected}
          venue={active?.venue ?? "spot"}
          timeframe={active?.timeframe ?? "1d"}
          range={active?.range ?? "1Y"}
          symbols={workspace.crossSymbols}
          onSymbols={(crossSymbols) => setWorkspace((current) => ({ ...current, crossSymbols }))}
          closedTrades={result?.metrics.trades ?? null}
        />
      ) : page === "diff" ? (
        <DiffPage />
      ) : page === "saved" ? (
        <SavedPage onRestore={restoreKept} />
      ) : (
      <>
      <WorkspaceBar
        slots={workspace.slots}
        activeId={workspace.activeId}
        pinnedId={workspace.pinnedId}
        onFocus={focusSlot}
        onPin={pinSlot}
        onClose={closeSlot}
        onAdd={addSlot}
        onSymbol={(id, symbol) => patchSlot(id, { symbol })}
        biasFor={slotBias}
        staleFor={slotTapeStale}
        positions={workspace.positions}
        openTrades={openTrades}
      />
      <div className="desk-stack flex flex-col lg:min-h-0 lg:flex-1 lg:flex-row">
        <Watchlist
          slots={workspace.slots}
          activeId={workspace.activeId}
          width={panes.slots}
          onWidth={(slots) => setPanes((current) => ({ ...current, slots }))}
          onFocus={focusSlot}
          onOpen={openSymbol}
          onSymbol={(id, symbol) => patchSlot(id, { symbol })}
          onFlat={(symbol, venue, price) => void flatMarket(symbol, venue, price)}
          positions={workspace.positions}
          openTrades={openTrades}
          tapes={tapes}
          giveBack={workspace.giveBack}
          maxBarsOpen={workspace.maxBarsOpen}
        />
        <div className="desk-column flex min-w-0 flex-col lg:min-h-0 lg:flex-1">
          {error ? (
            <div role="alert" className="bezel mx-3 mt-3 shrink-0 px-4 py-3 text-sm text-down">
              {error}{" "}
              <button type="button" className="font-semibold tracking-widest text-foreground uppercase underline" onClick={() => active && retryTape(active)}>
                Retry
              </button>
            </div>
          ) : null}
          {result ? (
            <RunStrip
              result={result}
              sortKey={sortKey}
              sortDir={sortDir}
              onKeep={(note) => void keepSelected(note)}
              onExport={(note) => void exportSelected(note)}
              onExportTrades={() => void exportTradesSelected()}
              onSort={(key) => {
                if (sortKey === key) setSortDir((dir) => (dir === "desc" ? "asc" : "desc"))
                else {
                  setSortKey(key)
                  setSortDir("desc")
                }
              }}
            />
          ) : null}
          <div className={cn("desk-stack flex min-w-0 flex-col lg:min-h-0 lg:flex-1", spanBook && "desk-span flex-row items-stretch")}>
          <div className="desk-stack flex min-w-0 flex-col lg:min-h-0 lg:flex-1">
          <div
            className={cn("price-split flex min-h-0 min-w-0", shown.length > 1 && "price-split-pair flex-col lg:flex-row")}
            style={{ flexGrow: panes.chart, flexShrink: 1, flexBasis: 0 }}
          >
            {shown.map((slot) => (
              <div key={slot.id} className="flex min-w-0 flex-col p-3 lg:min-h-0 lg:flex-1">
                <MarketPane
                  symbol={slot.symbol}
                  candles={tapeForSlot(tapes, slot)?.candles ?? EMPTY_CANDLES}
                  trades={tradesFor(slot, outcomes)}
                  interval={slot.timeframe}
                  venue={slot.venue}
                  bookWidth={panes.book}
                  candleClock={clocks[slot.id] ?? null}
                  showCaption={shown.length > 1}
                  alert={slot.alert}
                  deltaAlert={slot.deltaAlert}
                  session={session}
                  riskMode={workspace.riskMode}
                  arm={slot.armGate}
                  onRisk={(riskMode) => setWorkspace((current) => ({ ...current, riskMode }))}
                  funding={tapes[tapeKey(slot)]?.funding}
                  fundingStale={tapes[tapeKey(slot)]?.fundingStale === true}
                  focusTime={slot.id === workspace.activeId ? (focusTrade?.entry_time ?? null) : null}
                  reading={slot.id === workspace.activeId ? reading : []}
                  range={slot.range}
                  onRange={(range) => patchSlot(slot.id, { range })}
                  onClearFocus={() => setFocusTrade(null)}
                  onAlert={(alert) => patchSlot(slot.id, { alert })}
                  onArmPrice={(price, mid) => {
                    const kind = mid != null && price < mid ? "below" : "above"
                    patchSlot(slot.id, { alert: { kind, value: price } })
                  }}
                  onBookWidth={(book) => setPanes((current) => ({ ...current, book }))}
                  onEnlarge={() => {
                    if (slot.id !== workspace.activeId) focusSlot(slot.id)
                    setWorkspace((current) => ({ ...current, enlarged: true }))
                  }}
                  showBook={!spanBook}
                  barsPending={!errors[slot.id] && !tapeForSlot(tapes, slot)}
                  onRetry={() => retryTape(slot)}
                  smoothed={normalizeRule(slot.runs.find((run) => run.id === slot.selectedId)?.rule ?? "sma_cross") === "heikin_ashi"}
                  biasBadge={slotBias(slot)}
                  tapeStale={slotTapeStale(slot)}
                  armBlocked={slotArmTapeBlocked(slot)}
                  onFlatten={() => void flattenSlot(slot)}
                />
              </div>
            ))}
          </div>
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize the results pane"
            aria-valuemin={Math.round(CHART_MIN * 100)}
            aria-valuemax={Math.round(CHART_MAX * 100)}
            aria-valuenow={Math.round(panes.chart * 100)}
            tabIndex={0}
            className="relative z-10 hidden h-3 shrink-0 cursor-row-resize items-center lg:flex before:absolute before:inset-x-0 before:top-1/2 before:h-px before:bg-border"
            onPointerDown={(event) => dragChart(event, (chart) => setPanes((current) => ({ ...current, chart })))}
            onKeyDown={(event) => {
              if (event.key === "ArrowUp") setPanes((current) => ({ ...current, chart: clampChart(current.chart - 0.03) }))
              if (event.key === "ArrowDown") setPanes((current) => ({ ...current, chart: clampChart(current.chart + 0.03) }))
            }}
          />
          <div className="results-pane flex min-h-0 flex-col overflow-auto px-3 pb-24 lg:min-h-44 lg:overflow-hidden lg:pb-3" style={{ flexGrow: Math.max(0.2, 1 - panes.chart), flexShrink: 1, flexBasis: 0 }}>
            {loadingKey === activeKey && !activeTape ? (
              <p className="py-4 text-sm text-muted-foreground">Pulling the {phrase} tape. The first look at a pair can take a few seconds.</p>
            ) : null}
            {selectedOutcome && !selectedOutcome.ok ? <p className="py-2 font-heading text-2xl">{selectedOutcome.error}</p> : null}
            {result && active && selected ? (
              <div className="results-body min-h-0 flex-1">
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
                onFocusTrade={setFocusTrade}
                drawToken={drawToken}
                nudge={nudge && selected && nudge.runId === selected.id ? nudge.rows : null}
                giveBack={workspace.giveBack}
              />
              </div>
            ) : null}
            {running ? (
              <p className="mt-3 font-mono text-xs tracking-wide text-muted-foreground uppercase">Running the next pass…</p>
            ) : null}
          </div>
          </div>
          {spanBook && active ? (
            <BookSpan
              symbol={active.symbol}
              venue={active.venue}
              preferred={panes.book}
              onWidth={(book) => setPanes((current) => ({ ...current, book }))}
              onArmPrice={(price, mid) => {
                const kind = mid != null && price < mid ? "below" : "above"
                patchSlot(active.id, { alert: { kind, value: price } })
              }}
            />
          ) : null}
          </div>
        </div>
        <aside className="runs-rail hidden w-72 shrink-0 overflow-y-auto border-l border-border lg:block">
          <div className="p-3">
            {active && selected ? (
              <Controls
                idPrefix="desk"
                runs={active.runs}
                selected={selected}
                venue={active.venue}
                timeframe={active.timeframe}
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
                onRun={(run) => void runSelected(run)}
                onRunAll={(run) => void runAll(run)}
                onEditing={setEditing}
                deltaAlert={active.deltaAlert}
                onDeltaAlert={(deltaAlert) => patchSlot(active.id, { deltaAlert })}
                nudging={nudging}
                onNudge={() => void runNudge()}
                lossLimit={workspace.lossLimit}
                onLossLimit={(lossLimit) => setWorkspace((current) => ({ ...current, lossLimit }))}
                giveBack={workspace.giveBack}
                onGiveBack={(giveBack) => setWorkspace((current) => ({ ...current, giveBack }))}
                maxBarsOpen={workspace.maxBarsOpen}
                onMaxBarsOpen={(maxBarsOpen) => setWorkspace((current) => ({ ...current, maxBarsOpen }))}
                timeStopClose={workspace.timeStopClose}
                onTimeStopClose={(timeStopClose) => setWorkspace((current) => ({ ...current, timeStopClose }))}
              />
            ) : (
              <EmptyRuns onAdd={addSlot} />
            )}
          </div>
        </aside>
      </div>

      <div className="setup-bar fixed inset-x-0 bottom-0 z-40 border-t border-border bg-[#fffaf4]/90 p-3 lg:hidden">
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
                  timeframe={active.timeframe}
                  running={running}
                  onSelect={selectRun}
                  onChange={updateRun}
                  onToggleHidden={() => undefined}
                  onRemove={removeRun}
                  onAdd={addRun}
                  onDuplicate={duplicateRun}
                  onRun={(run) => void runSelected(run)}
                  onRunAll={(run) => void runAll(run)}
                  onEditing={setEditing}
                  deltaAlert={active.deltaAlert}
                  onDeltaAlert={(deltaAlert) => patchSlot(active.id, { deltaAlert })}
                  nudging={nudging}
                  onNudge={() => void runNudge()}
                  lossLimit={workspace.lossLimit}
                  onLossLimit={(lossLimit) => setWorkspace((current) => ({ ...current, lossLimit }))}
                  giveBack={workspace.giveBack}
                  onGiveBack={(giveBack) => setWorkspace((current) => ({ ...current, giveBack }))}
                  maxBarsOpen={workspace.maxBarsOpen}
                  onMaxBarsOpen={(maxBarsOpen) => setWorkspace((current) => ({ ...current, maxBarsOpen }))}
                  timeStopClose={workspace.timeStopClose}
                  onTimeStopClose={(timeStopClose) => setWorkspace((current) => ({ ...current, timeStopClose }))}
                />
              ) : null}
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {workspace.enlarged && active ? (
        <ResearchChart
          candles={activeTape?.candles ?? EMPTY_CANDLES}
          trades={tradesFor(active, outcomes)}
          interval={active.timeframe}
          symbol={active.symbol}
          venue={active.venue}
          metrics={result?.metrics ?? null}
          runName={selected?.name ?? "Run"}
          smoothed={selected ? normalizeRule(selected.rule) === "heikin_ashi" : false}
          onClose={() => setWorkspace((current) => ({ ...current, enlarged: false }))}
        />
      ) : null}
      </>
      )}
    </div>
  )
}

function pinKeys(workspace: Workspace): string[] {
  return [...new Set(workspace.slots.flatMap((slot) => pinsOf(slot).map((symbol) => `${slot.venue}:${symbol}`)))]
}

/** Tick once a second and on book repaints so the 15s stale badge can clear. */
function useTapeNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    const stop = subscribeBooks(() => setNow(Date.now()))
    return () => {
      window.clearInterval(id)
      stop()
    }
  }, [])
  return now
}

function useJournalTrades(): TradeRecord[] {
  const [rows, setRows] = useState<TradeRecord[]>([])
  useEffect(() => {
    let cancel = false
    const load = () => {
      void matchingTrades(emptyQuery()).then((next) => {
        if (!cancel) setRows(next)
      })
    }
    load()
    const stop = watchBook(load)
    return () => {
      cancel = true
      stop()
    }
  }, [])
  return rows
}

function useOpenJournal(): TradeRecord[] {
  const [rows, setRows] = useState<TradeRecord[]>([])
  useEffect(() => {
    let cancel = false
    const load = () => {
      void matchingTrades({ ...emptyQuery(), state: "open" }).then((next) => {
        if (!cancel) setRows(next)
      })
    }
    load()
    const stop = watchBook(load)
    return () => {
      cancel = true
      stop()
    }
  }, [])
  return rows
}

function PinFill({
  symbol,
  venue,
  onFill,
}: {
  symbol: string
  venue: Venue
  onFill: (ticket: WorkingTicket, price: number) => void
}) {
  const book = useBookView(symbol, venue)
  const price = book.last?.price ?? null
  const pending = useRef(new Set<string>())
  const fillRef = useRef(onFill)
  fillRef.current = onFill
  useEffect(() => {
    if (price == null) return
    let cancel = false
    void liveTicket(symbol, venue).then((ticket) => {
      if (cancel || !ticket || pending.current.has(ticket.id)) return
      if (!ticketFills(ticket.side, ticket.entry, price)) return
      pending.current.add(ticket.id)
      fillRef.current(ticket, price)
    })
    return () => {
      cancel = true
    }
  }, [price, symbol, venue])
  return null
}

function OpenTradeWatch({
  trade,
  timeframe,
  maxBarsOpen,
  timeStopClose,
  feeBps,
  slippageBps,
  onScaled,
  onTimedClose,
}: {
  trade: TradeRecord
  timeframe: Timeframe
  maxBarsOpen: number | null
  timeStopClose: boolean
  feeBps: number
  slippageBps: number
  onScaled: (runner: TradeRecord) => void
  onTimedClose: (trade: TradeRecord) => void
}) {
  const book = useBookView(trade.symbol, trade.market)
  const mark = liveMark(book)?.price ?? null
  const busy = useRef(false)
  const scaledRef = useRef(onScaled)
  const timedRef = useRef(onTimedClose)
  scaledRef.current = onScaled
  timedRef.current = onTimedClose

  useEffect(() => {
    if (mark == null || !(mark > 0) || busy.current || trade.exitTime != null) return
    let cancel = false
    void (async () => {
      if (trade.scaleOutR != null && trade.scaleOutPct != null && trade.leg !== "partial" && trade.leg !== "runner") {
        busy.current = true
        const result = await applyScaleOut(trade.id, mark)
        busy.current = false
        if (cancel || !result) return
        scaledRef.current(result.runner)
        return
      }
      if (timeStopClose && timeStopDue(trade.entryTime, timeframe, maxBarsOpen)) {
        busy.current = true
        const closed = await closeJournalTrade(trade.id, mark, { feeBps, slippageBps })
        busy.current = false
        if (cancel || !closed) return
        timedRef.current(closed)
      }
    })()
    return () => {
      cancel = true
    }
  }, [feeBps, mark, maxBarsOpen, slippageBps, timeStopClose, timeframe, trade.exitTime, trade.id, trade.leg, trade.scaleOutPct, trade.scaleOutR, trade.entryTime])

  return null
}

function applySlotPatch(slot: Slot, patch: Partial<Slot>): Slot {
  const venue = patch.venue ?? slot.venue
  const requested = patch.symbol ?? slot.symbol
  const pinned = patch.pins ?? pinSymbol(slot.pins, slot.symbol, requested).pins
  const symbol = patch.pins ? requested : pinSymbol(slot.pins, slot.symbol, requested).symbol
  const timeframe = patch.timeframe ?? slot.timeframe
  const range = patch.range ?? slot.range
  const venueChanged = patch.venue != null && patch.venue !== slot.venue
  const runs = (patch.runs ?? slot.runs).map((run) => ({
    ...run,
    symbol,
    allowShort: venue === "spot" ? false : venueChanged ? true : run.allowShort,
  }))
  return { ...slot, ...patch, venue, symbol, pins: pinned, timeframe, range, runs }
}

function alignRun(run: Run, slot: Pick<Slot, "symbol" | "venue">): Run {
  return { ...run, symbol: slot.symbol, allowShort: slot.venue === "perp" ? run.allowShort !== false : false }
}

function placeKept(current: Workspace, kept: { symbol: string; venue: Venue; timeframe: string; range: string }, run: Run): Workspace {
  const timeframe = kept.timeframe as Timeframe
  const range = kept.range as RangeId
  const existing = current.slots.find((slot) => slot.symbol === kept.symbol && slot.venue === kept.venue)
  if (existing) {
    const replacing = existing.runs.length >= MAX_RUNS
    const runs = replacing
      ? existing.runs.map((item) => (item.id === existing.selectedId ? { ...run, id: item.id } : item))
      : [...existing.runs, run]
    return {
      ...current,
      activeId: existing.id,
      slots: current.slots.map((slot) =>
        slot.id === existing.id ? { ...slot, timeframe, range, runs, selectedId: replacing ? existing.selectedId : run.id } : slot,
      ),
    }
  }
  const slot = { ...createSlot(kept.symbol as MarketId, kept.venue, timeframe, range), runs: [run], selectedId: run.id }
  if (current.slots.length >= MAX_SLOTS) {
    return {
      ...current,
      slots: current.slots.map((item) => (item.id === current.activeId ? { ...slot, id: item.id } : item)),
    }
  }
  return { ...current, slots: [...current.slots, slot], activeId: slot.id }
}

function fitsSlot(slot: Slot, outcome: Outcome | undefined): outcome is Extract<Outcome, { ok: true }> {
  if (!outcome?.ok) return false
  if (outcome.result.assumptions.venue !== slot.venue || outcome.result.symbol !== slot.symbol) return false
  if (slot.venue === "spot" && (outcome.result.assumptions.allow_short || outcome.result.trades.some((trade) => trade.side === "short"))) return false
  return true
}

function tradesFor(slot: Slot, outcomes: Record<string, Outcome>): Trade[] {
  const outcome = outcomes[slot.selectedId]
  if (!fitsSlot(slot, outcome)) return []
  return spotTrades(outcome.result.trades, slot.venue)
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

/** Book runs the full column only for a mouse on a tall, wide window. A touch
    screen and a short landscape window keep the ladder beside the price chart. */
function useSpanBook(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const wide = window.matchMedia("(min-width: 1024px)")
      const tall = window.matchMedia("(min-height: 861px)")
      const mouse = window.matchMedia("(hover: hover) and (pointer: fine)")
      wide.addEventListener("change", notify)
      tall.addEventListener("change", notify)
      mouse.addEventListener("change", notify)
      return () => {
        wide.removeEventListener("change", notify)
        tall.removeEventListener("change", notify)
        mouse.removeEventListener("change", notify)
      }
    },
    () =>
      window.matchMedia("(min-width: 1024px)").matches &&
      window.matchMedia("(min-height: 861px)").matches &&
      window.matchMedia("(hover: hover) and (pointer: fine)").matches,
    () => false,
  )
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
