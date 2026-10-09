import { normalizeSymbol } from "./markets.ts"
import {
  MAX_RUNS,
  clampRisk,
  createRun,
  isRange,
  isTimeframe,
  isVenue,
  normalizeCombo,
  normalizeRule,
  ruleParams,
  uniqueName,
} from "./runs.ts"
import type { ComboRule, MarketId, Run, RunParams, Venue } from "./types.ts"
import type { Slot, Workspace } from "./workspace.ts"

export type BotOp = { op: string } & Record<string, unknown>

export function applyBotEdits(workspace: Workspace, ops: BotOp[]): Workspace {
  let next = workspace
  for (const op of ops) {
    next = applyOne(next, op)
  }
  return next
}

function applyOne(workspace: Workspace, op: BotOp): Workspace {
  if (op.op === "focus") return focusSlot(workspace, text(op.symbol))
  if (op.op === "pin") return pinSlot(workspace, text(op.symbol))
  if (op.op === "unpin") return workspace.pinnedId == null ? workspace : { ...workspace, pinnedId: null }
  if (op.op === "set-slot") return setSlot(workspace, op)
  if (op.op === "patch-run") return patchRun(workspace, op)
  if (op.op === "select-run") return selectRun(workspace, op)
  if (op.op === "add-run") return addRun(workspace, op)
  if (op.op === "remove-run") return removeRun(workspace, op)
  return workspace
}

function focusSlot(workspace: Workspace, symbol: string | null): Workspace {
  const slot = symbol ? findSlot(workspace, symbol) : null
  if (!slot || slot.id === workspace.activeId) return workspace
  return { ...workspace, activeId: slot.id }
}

function pinSlot(workspace: Workspace, symbol: string | null): Workspace {
  const slot = symbol ? findSlot(workspace, symbol) : null
  if (!slot || slot.id === workspace.pinnedId) return workspace
  return { ...workspace, pinnedId: slot.id }
}

function setSlot(workspace: Workspace, op: BotOp): Workspace {
  const current = targetSlot(workspace, op)
  if (!current) return workspace
  const requested = text(op.symbol)
  const symbol = requested ? (asSymbol(requested) ?? current.symbol) : current.symbol
  const venue = isVenue(op.venue) ? op.venue : current.venue
  const timeframe = isTimeframe(op.timeframe) ? op.timeframe : current.timeframe
  const range = isRange(op.range) ? op.range : current.range
  if (symbol === current.symbol && venue === current.venue && timeframe === current.timeframe && range === current.range) {
    return workspace
  }
  const runs = current.runs.map((run) => alignRun(run, symbol, venue))
  return replaceSlot(workspace, { ...current, symbol, venue, timeframe, range, runs })
}

function patchRun(workspace: Workspace, op: BotOp): Workspace {
  const slot = targetSlot(workspace, op)
  if (!slot) return workspace
  const run = targetRun(slot, op)
  if (!run) return workspace
  const rule = text(op.rule) ? normalizeRule(text(op.rule)!) : run.rule
  const params = ruleParams(rule, { ...run.params, ...numberParams(op.params) })
  const name = text(op.name)?.slice(0, 48) || run.name
  const combo = op.combo == null ? run.combo : normalizeCombo(comboItems(op.combo), rule)
  const patched = alignRun(
    {
      ...run,
      name,
      rule,
      params,
      combo,
      feeBps: numberIn(op.feeBps, 0, 1000, run.feeBps, true),
      capital: numberIn(op.capital, 1, 1_000_000_000, run.capital, false),
      leverage: numberIn(op.leverage, 1, 20, run.leverage, false),
      riskPct: op.riskPct == null ? run.riskPct : clampRisk(Number(op.riskPct)),
      allowShort: typeof op.allowShort === "boolean" ? op.allowShort : run.allowShort,
      hidden: typeof op.hidden === "boolean" ? op.hidden : run.hidden,
    },
    slot.symbol,
    slot.venue,
  )
  return replaceSlot(workspace, { ...slot, runs: slot.runs.map((item) => (item.id === run.id ? patched : item)) })
}

function selectRun(workspace: Workspace, op: BotOp): Workspace {
  const slot = targetSlot(workspace, op)
  if (!slot) return workspace
  const run = targetRun(slot, op)
  if (!run || run.id === slot.selectedId) return workspace
  return replaceSlot(workspace, { ...slot, selectedId: run.id })
}

function addRun(workspace: Workspace, op: BotOp): Workspace {
  const slot = targetSlot(workspace, op)
  if (!slot || slot.runs.length >= MAX_RUNS) return workspace
  const rule = normalizeRule(text(op.rule) ?? "sma_cross")
  const params = ruleParams(rule, numberParams(op.params))
  const combo = normalizeCombo(comboItems(op.combo), rule)
  const created = createRun(
    {
      symbol: slot.symbol,
      rule,
      params,
      combo,
      name: text(op.name) ?? undefined,
      feeBps: numberIn(op.feeBps, 0, 1000, 10, true),
      capital: numberIn(op.capital, 1, 1_000_000_000, 10_000, false),
      leverage: numberIn(op.leverage, 1, 20, 3, false),
      riskPct: op.riskPct == null ? 100 : clampRisk(Number(op.riskPct)),
      allowShort: slot.venue === "perp" && op.allowShort !== false,
    },
    slot.runs,
  )
  if (text(op.name)) created.name = uniqueName(text(op.name)!.slice(0, 48), slot.runs)
  return replaceSlot(workspace, { ...slot, runs: [...slot.runs, alignRun(created, slot.symbol, slot.venue)], selectedId: created.id })
}

function removeRun(workspace: Workspace, op: BotOp): Workspace {
  const slot = targetSlot(workspace, op)
  if (!slot || slot.runs.length < 2) return workspace
  const run = targetRun(slot, op)
  if (!run) return workspace
  const runs = slot.runs.filter((item) => item.id !== run.id)
  const selectedId = runs.some((item) => item.id === slot.selectedId) ? slot.selectedId : runs[0]!.id
  return replaceSlot(workspace, { ...slot, runs, selectedId })
}

function alignRun(run: Run, symbol: MarketId, venue: Venue): Run {
  return { ...run, symbol, allowShort: venue === "perp" ? run.allowShort !== false : false }
}

function replaceSlot(workspace: Workspace, slot: Slot): Workspace {
  return { ...workspace, slots: workspace.slots.map((item) => (item.id === slot.id ? slot : item)) }
}

function targetSlot(workspace: Workspace, op: BotOp): Slot | undefined {
  const named = text(op.slot)
  if (!named || named.toLowerCase() === "active") return activeSlot(workspace)
  return findSlot(workspace, named) ?? activeSlot(workspace)
}

function activeSlot(workspace: Workspace): Slot | undefined {
  return workspace.slots.find((slot) => slot.id === workspace.activeId) ?? workspace.slots[0]
}

function findSlot(workspace: Workspace, symbol: string): Slot | undefined {
  const id = asSymbol(symbol)
  if (!id) return undefined
  return workspace.slots.find((slot) => slot.symbol.toUpperCase() === id)
}

function targetRun(slot: Slot, op: BotOp): Run | undefined {
  const named = text(op.run)
  if (!named || named.toLowerCase() === "selected") return slot.runs.find((run) => run.id === slot.selectedId) ?? slot.runs[0]
  const needle = named.trim().toLowerCase()
  return slot.runs.find((run) => run.name.trim().toLowerCase() === needle)
}

function asSymbol(value: string): string | null {
  return normalizeSymbol(value) ?? normalizeSymbol(`${value}USDT`)
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function numberParams(value: unknown): RunParams {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const params: RunParams = {}
  for (const [key, item] of Object.entries(value)) {
    const number = Number(item)
    if (Number.isFinite(number)) params[key] = number
  }
  return params
}

function comboItems(value: unknown): ComboRule[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is ComboRule => Boolean(item) && typeof item === "object")
}

function numberIn(value: unknown, min: number, max: number, fallback: number, integer: boolean): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  const clamped = Math.min(max, Math.max(min, number))
  return integer ? Math.round(clamped) : clamped
}
