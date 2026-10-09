import type { ReactNode } from "react"
import { Eye, EyeOff } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import type { MarketId, RuleId, Run } from "@/lib/types"
import { MARKETS, MAX_RUNS, RULES, runColor } from "@/lib/runs"

type ControlsProps = {
  idPrefix: string
  runs: Run[]
  selected: Run
  running: boolean
  onSelect: (id: string) => void
  onChange: (run: Run) => void
  onToggleHidden: (id: string) => void
  onAdd: () => void
  onDuplicate: () => void
  onRun: () => void
  onRunAll: () => void
  onEditing: (editing: boolean) => void
}

export function Controls({
  idPrefix,
  runs,
  selected,
  running,
  onSelect,
  onChange,
  onToggleHidden,
  onAdd,
  onDuplicate,
  onRun,
  onRunAll,
  onEditing,
}: ControlsProps) {
  const full = runs.length >= MAX_RUNS
  const rule = RULES.find((item) => item.id === selected.rule)
  const fastSlowInvalid = selected.rule === "sma_cross" && selected.params.fast >= selected.params.slow

  function patch(next: Partial<Run>) {
    onChange({ ...selected, ...next })
  }

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault()
        onRun()
      }}
      onFocus={(event) => {
        if (isField(event.target)) onEditing(true)
      }}
      onBlur={(event) => {
        const next = event.relatedTarget
        if (next instanceof Node && event.currentTarget.contains(next) && isField(next)) return
        onEditing(false)
      }}
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Runs</span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {runs.length} of {MAX_RUNS}
          </span>
        </div>
        <ul className="flex flex-col">
          {runs.map((run, index) => {
            const active = run.id === selected.id
            return (
              <li key={run.id} className="flex items-center gap-2 border-t border-border">
                <button
                  type="button"
                  className={`flex min-w-0 flex-1 items-center gap-2 py-2 text-left ${active ? "text-foreground" : "text-muted-foreground"}`}
                  onClick={() => onSelect(run.id)}
                >
                  <span className="size-2 shrink-0" style={{ backgroundColor: runColor(index) }} />
                  <span className="truncate text-sm">{run.name}</span>
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-pressed={!run.hidden}
                  aria-label={run.hidden ? `Show ${run.name}` : `Hide ${run.name}`}
                  onClick={() => onToggleHidden(run.id)}
                >
                  {run.hidden ? <EyeOff /> : <Eye />}
                </Button>
              </li>
            )
          })}
        </ul>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" disabled={full || running} onClick={onAdd}>
            Add run
          </Button>
          <Button type="button" variant="outline" disabled={full || running} onClick={onDuplicate}>
            Duplicate
          </Button>
        </div>
        {full ? <p className="text-xs text-muted-foreground">Five runs is the desk limit.</p> : null}
      </div>

      <Separator />

      <Field label="Name" htmlFor={`${idPrefix}-name`}>
        <Input
          id={`${idPrefix}-name`}
          value={selected.name}
          maxLength={48}
          onChange={(event) => patch({ name: event.target.value })}
        />
      </Field>

      <Field label="Market" htmlFor={`${idPrefix}-symbol`}>
        <Select value={selected.symbol} onValueChange={(symbol) => patch({ symbol: symbol as MarketId })}>
          <SelectTrigger id={`${idPrefix}-symbol`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MARKETS.map((symbol) => (
              <SelectItem key={symbol.id} value={symbol.id}>
                {symbol.name}
                <span className="text-muted-foreground"> {symbol.base}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Rule" htmlFor={`${idPrefix}-rule`}>
        <Select value={selected.rule} onValueChange={(ruleId) => patch({ rule: ruleId as RuleId })}>
          <SelectTrigger id={`${idPrefix}-rule`} className="w-full">
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
      </Field>
      {rule ? <p className="text-sm leading-relaxed text-muted-foreground">{rule.summary}</p> : null}

      {selected.rule === "sma_cross" ? (
        <div className="grid grid-cols-2 gap-4">
          <Field label="Fast" htmlFor={`${idPrefix}-fast`}>
            <Input
              id={`${idPrefix}-fast`}
              type="number"
              inputMode="numeric"
              min={2}
              max={200}
              step={1}
              value={selected.params.fast}
              onChange={(event) =>
                patch({ params: { ...selected.params, fast: numberOr(event.target.value, selected.params.fast) } })
              }
            />
          </Field>
          <Field label="Slow" htmlFor={`${idPrefix}-slow`}>
            <Input
              id={`${idPrefix}-slow`}
              type="number"
              inputMode="numeric"
              min={3}
              max={400}
              step={1}
              value={selected.params.slow}
              onChange={(event) =>
                patch({ params: { ...selected.params, slow: numberOr(event.target.value, selected.params.slow) } })
              }
            />
          </Field>
        </div>
      ) : null}

      {selected.rule === "rsi" ? (
        <Field label="RSI length" htmlFor={`${idPrefix}-rsi`}>
          <Input
            id={`${idPrefix}-rsi`}
            type="number"
            inputMode="numeric"
            min={2}
            max={100}
            step={1}
            value={selected.params.rsi}
            onChange={(event) =>
              patch({ params: { ...selected.params, rsi: numberOr(event.target.value, selected.params.rsi) } })
            }
          />
        </Field>
      ) : null}

      {fastSlowInvalid ? (
        <p className="text-sm text-down">The fast period has to be shorter than the slow period.</p>
      ) : null}

      <Field label="Fee (bps)" htmlFor={`${idPrefix}-fee`}>
        <Input
          id={`${idPrefix}-fee`}
          type="number"
          inputMode="decimal"
          min={0}
          max={1000}
          step={1}
          value={selected.feeBps}
          onChange={(event) => patch({ feeBps: numberOr(event.target.value, selected.feeBps) })}
        />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Button type="submit" disabled={running || fastSlowInvalid}>
          {running ? "Running" : "Run"}
        </Button>
        <Button type="button" variant="outline" disabled={running} onClick={onRunAll}>
          Run all
        </Button>
      </div>
      <p className="text-xs leading-relaxed break-words text-muted-foreground">
        A signal is fixed on the close and filled on the next bar’s open. Slippage stays at 5 bps. Ten basis points is
        0.10%.
      </p>
    </form>
  )
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  )
}

function isField(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target instanceof HTMLInputElement || target.getAttribute("role") === "combobox")
}

function numberOr(raw: string, fallback: number): number {
  if (raw.trim() === "") return fallback
  const value = Number(raw)
  return Number.isFinite(value) ? value : fallback
}
