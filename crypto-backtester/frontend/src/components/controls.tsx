import type { ReactNode } from "react"
import { Eye, EyeOff, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { SymbolSelect } from "@/components/symbol-select"
import type { RuleId, Run } from "@/lib/types"
import { MAX_RUNS, RULES, paramsForRule, ruleName, runColor, runProblem } from "@/lib/runs"

type ControlsProps = {
  idPrefix: string
  runs: Run[]
  selected: Run
  running: boolean
  onSelect: (id: string) => void
  onChange: (run: Run) => void
  onToggleHidden: (id: string) => void
  onRemove: (id: string) => void
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
  onRemove,
  onAdd,
  onDuplicate,
  onRun,
  onRunAll,
  onEditing,
}: ControlsProps) {
  const full = runs.length >= MAX_RUNS
  const rule = RULES.find((item) => item.id === selected.rule)
  const problem = runProblem(selected)

  function patch(next: Partial<Run>) {
    onChange({ ...selected, ...next })
  }

  return (
    <form
      className="bezel flex flex-col gap-6 p-4"
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
              <li key={run.id} className="flex items-center gap-2 border-t border-border transition-[border-color] duration-150 hover:border-[#39e7ff]">
                <button
                  type="button"
                  className={`flex min-w-0 flex-1 items-center gap-2 py-2 text-left ${active ? "text-foreground" : "text-muted-foreground"}`}
                  onClick={() => onSelect(run.id)}
                >
                  <span className="size-2 shrink-0" style={{ backgroundColor: runColor(index) }} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{run.name}</span>
                    <span className="block truncate font-mono text-[10px] text-muted-foreground uppercase">{ruleName(run.rule)}</span>
                  </span>
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
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remove ${run.name}`}
                  onClick={() => onRemove(run.id)}
                >
                  <Trash2 />
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
        <SymbolSelect
          id={`${idPrefix}-symbol`}
          className="w-full"
          value={selected.symbol}
          onChange={(symbol) => patch({ symbol })}
        />
      </Field>

      <Field label="Rule" htmlFor={`${idPrefix}-rule`}>
        <Select
          value={selected.rule}
          onValueChange={(ruleId) => patch({ rule: ruleId as RuleId, params: paramsForRule(ruleId as RuleId, selected.params) })}
        >
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

      {rule && rule.params.length > 0 ? (
        <div className={rule.params.length > 1 ? "grid grid-cols-2 gap-4" : "flex flex-col gap-4"}>
          {rule.params.map((param) =>
            param.toggle ? (
              <div key={param.key} className="col-span-2 flex items-center justify-between gap-3 border-t border-border pt-3">
                <Label htmlFor={`${idPrefix}-${param.key}`}>{param.label}</Label>
                <Switch
                  id={`${idPrefix}-${param.key}`}
                  checked={(selected.params[param.key] ?? param.default) >= 1}
                  onCheckedChange={(checked) =>
                    patch({
                      params: { ...selected.params, [param.key]: checked ? 1 : 0 },
                    })
                  }
                />
              </div>
            ) : (
              <Field key={param.key} label={param.label} htmlFor={`${idPrefix}-${param.key}`}>
                <Input
                  id={`${idPrefix}-${param.key}`}
                  type="number"
                  inputMode="decimal"
                  min={param.min}
                  max={param.max}
                  step={param.step}
                  value={selected.params[param.key] ?? param.default}
                  onChange={(event) =>
                    patch({
                      params: {
                        ...selected.params,
                        [param.key]: numberOr(event.target.value, selected.params[param.key] ?? param.default),
                      },
                    })
                  }
                />
              </Field>
            ),
          )}
        </div>
      ) : null}

      {problem ? <p className="text-sm text-down">{problem}</p> : null}

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
        <Button type="submit" disabled={running || problem != null}>
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
