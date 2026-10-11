import { formatPct, formatPlainPct } from "./format.ts"
import { ruleById } from "./runs.ts"

export type DiffSide = {
  rule: string
  params: Record<string, number>
  totalReturn: number
  maxDrawdown: number
  winRate: number | null
  trades: number
}

export type DiffLine = {
  field: string
  left: string
  right: string
}

/** Params, return, drawdown, win rate, and trade count. A field that matches on both runs stays off the list. */
export function ruleDiff(left: DiffSide, right: DiffSide): DiffLine[] {
  const lines: DiffLine[] = []
  if (left.rule !== right.rule) {
    lines.push({ field: "Rule", left: ruleName(left.rule), right: ruleName(right.rule) })
  }
  const labels = new Map<string, string>()
  for (const rule of [left.rule, right.rule]) {
    for (const param of ruleById(rule)?.params ?? []) labels.set(param.key, param.label)
  }
  const keys = [...new Set([...Object.keys(left.params), ...Object.keys(right.params)])].sort()
  for (const key of keys) {
    const leftValue = formatParam(left.params[key])
    const rightValue = formatParam(right.params[key])
    if (leftValue === rightValue) continue
    lines.push({ field: labels.get(key) ?? key, left: leftValue, right: rightValue })
  }
  pushMetric(lines, "Return", formatPct(left.totalReturn), formatPct(right.totalReturn))
  pushMetric(lines, "Drawdown", formatPct(left.maxDrawdown), formatPct(right.maxDrawdown))
  pushMetric(lines, "Win rate", formatPlainPct(left.winRate, 0), formatPlainPct(right.winRate, 0))
  pushMetric(lines, "Trades", String(left.trades), String(right.trades))
  return lines
}

function ruleName(rule: string): string {
  return ruleById(rule)?.name ?? rule
}

function formatParam(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—"
  if (Number.isInteger(value)) return String(value)
  return String(Math.round(value * 10000) / 10000)
}

function pushMetric(lines: DiffLine[], field: string, left: string, right: string) {
  if (left === right) return
  lines.push({ field, left, right })
}
