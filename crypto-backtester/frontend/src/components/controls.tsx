import { useRef, useState, type ReactNode } from "react"
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
import { formatMoney } from "@/lib/format"
import type { RuleId, Run, Venue } from "@/lib/types"
import { MAX_RUNS, RULES, clampRisk, clampSlippage, nudgeFast, paramsForRule, ruleName, ruleParams, runColor, runProblem } from "@/lib/runs"

type ControlsProps = {
  idPrefix: string
  runs: Run[]
  selected: Run
  venue: Venue
  running: boolean
  onSelect: (id: string) => void
  onChange: (run: Run) => void
  onToggleHidden: (id: string) => void
  onRemove: (id: string) => void
  onAdd: () => void
  onDuplicate: () => void
  onRun: (run: Run) => void
  onRunAll: (run: Run) => void
  onEditing: (editing: boolean) => void
  deltaAlert: number | null
  onDeltaAlert: (value: number | null) => void
  nudging: boolean
  onNudge: () => void
  lossLimit: number
  onLossLimit: (limit: number) => void
  giveBack: number
  onGiveBack: (percent: number) => void
  maxBarsOpen: number | null
  onMaxBarsOpen: (bars: number | null) => void
  timeStopClose: boolean
  onTimeStopClose: (on: boolean) => void
}

export function Controls({
  idPrefix,
  runs,
  selected,
  venue,
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
  deltaAlert,
  onDeltaAlert,
  nudging,
  onNudge,
  lossLimit,
  onLossLimit,
  giveBack,
  onGiveBack,
  maxBarsOpen,
  onMaxBarsOpen,
  timeStopClose,
  onTimeStopClose,
}: ControlsProps) {
  const full = runs.length >= MAX_RUNS
  const rule = RULES.find((item) => item.id === selected.rule)
  const problem = runProblem(selected)
  const selectedRef = useRef(selected)
  selectedRef.current = selected

  function patch(next: Partial<Run>) {
    const run = { ...selectedRef.current, ...next }
    selectedRef.current = run
    onChange(run)
  }

  return (
    <form
      className="bezel flex flex-col gap-6 p-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        onRun(selectedRef.current)
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
              <li key={run.id} className="flex items-center gap-2 border-t border-border transition-[border-color] duration-150 hover:border-[#c56a32]">
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
          venue={venue}
          onChange={(symbol) => patch({ symbol })}
        />
      </Field>

      <Field label="Rule" htmlFor={`${idPrefix}-rule`}>
        <Select
          value={selected.rule}
          onValueChange={(ruleId) =>
            patch({
              rule: ruleId as RuleId,
              params: paramsForRule(ruleId as RuleId, selected.params),
              combo: (selected.combo ?? []).filter((item) => item.rule !== ruleId),
            })
          }
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
            ) : param.options ? (
              <div key={param.key} className="flex flex-col gap-1">
                <Label htmlFor={`${idPrefix}-${param.key}`}>{param.label}</Label>
                <Select
                  value={String(selected.params[param.key] ?? param.default)}
                  onValueChange={(value) => patch({ params: { ...selectedRef.current.params, [param.key]: Number(value) } })}
                >
                  <SelectTrigger id={`${idPrefix}-${param.key}`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {param.options.map((option) => (
                      <SelectItem key={option.value} value={String(option.value)}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <DecimalField
                key={param.key}
                id={`${idPrefix}-${param.key}`}
                label={param.label}
                value={selected.params[param.key] ?? param.default}
                min={param.min}
                max={param.max}
                integer={param.integer}
                onValue={(value) => patch({ params: { ...selectedRef.current.params, [param.key]: value } })}
              />
            ),
          )}
        </div>
      ) : null}

      <ComboEditor
        idPrefix={idPrefix}
        selected={selected}
        onChange={(combo) => patch({ combo })}
      />

      {problem ? <p className="text-sm text-down">{problem}</p> : null}

      <DecimalField
        id={`${idPrefix}-capital`}
        label="Base balance"
        value={selected.capital}
        min={1}
        max={1_000_000_000}
        onValue={(capital) => patch({ capital })}
      />

      <DecimalField
        id={`${idPrefix}-risk`}
        label="Risk per trade (%)"
        value={clampRisk(selected.riskPct)}
        min={0.1}
        max={5}
        onValue={(riskPct) => patch({ riskPct })}
        hint={<p className="text-xs leading-relaxed text-muted-foreground">{riskCopy(selected.capital, clampRisk(selected.riskPct))}</p>}
      />

      <DecimalField
        id={`${idPrefix}-loss-limit`}
        label="Loss halt"
        value={lossLimit}
        min={1}
        max={20}
        integer
        onValue={onLossLimit}
        hint={<p className="text-xs leading-relaxed text-muted-foreground">Closed journal losses in a row. The session stands down and Arm stays dark until you clear it.</p>}
      />

      <DecimalField
        id={`${idPrefix}-give-back`}
        label="Give-back (%)"
        value={giveBack}
        min={1}
        max={100}
        integer
        onValue={onGiveBack}
        hint={<p className="text-xs leading-relaxed text-muted-foreground">If open profit falls below this share of the best open profit, the row is marked give-back. Nothing closes on its own.</p>}
      />

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-max-bars`}>Max bars open</Label>
        <Input
          id={`${idPrefix}-max-bars`}
          inputMode="numeric"
          placeholder="Blank"
          value={maxBarsOpen == null ? "" : String(maxBarsOpen)}
          onChange={(event) => {
            const raw = event.target.value.trim()
            if (!raw) {
              onMaxBarsOpen(null)
              return
            }
            const next = Math.round(Number(raw))
            onMaxBarsOpen(Number.isFinite(next) && next > 0 ? Math.min(10_000, next) : null)
          }}
        />
        <p className="text-xs leading-relaxed text-muted-foreground">
          An open trade past this bar count gets a time badge. Leave blank to turn it off.
        </p>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={`${idPrefix}-time-close`}>Close on time stop</Label>
          <Switch id={`${idPrefix}-time-close`} checked={timeStopClose} onCheckedChange={onTimeStopClose} />
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">Off by default. When on, a due trade closes at the mark.</p>
      </div>

      {venue === "perp" ? (
        <DecimalField
          id={`${idPrefix}-leverage`}
          label="Leverage"
          value={selected.leverage}
          min={1}
          max={20}
          onValue={(leverage) => patch({ leverage })}
        />
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <DecimalField
          id={`${idPrefix}-fee`}
          label="Fee (bps)"
          value={selected.feeBps}
          min={0}
          max={1000}
          onValue={(feeBps) => patch({ feeBps })}
        />
        <DecimalField
          id={`${idPrefix}-slippage`}
          label="Slippage (bps)"
          value={clampSlippage(selected.slippageBps)}
          min={0}
          max={1000}
          onValue={(slippageBps) => patch({ slippageBps })}
        />
      </div>

      <DecimalField
        id={`${idPrefix}-delta`}
        label="60s delta"
        value={deltaAlert ?? 0}
        min={0}
        max={1_000_000_000}
        onValue={(value) => onDeltaAlert(value > 0 ? value : null)}
        hint={<p className="text-xs leading-relaxed text-muted-foreground">The book fires when 60-second buy-minus-sell crosses this size. Zero stays idle.</p>}
      />

      {venue === "perp" ? (
        <Button
          type="button"
          variant={selected.allowShort ? "default" : "outline"}
          aria-pressed={selected.allowShort}
          className="w-full"
          onClick={() => patch({ allowShort: !selected.allowShort })}
        >
          {selected.allowShort ? "Shorts on" : "Shorts off"}
        </Button>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <Button type="submit" disabled={running || problem != null}>
          {running ? "Running" : "Run"}
        </Button>
        <Button type="button" variant="outline" disabled={running} onClick={() => onRunAll(selectedRef.current)}>
          Run all
        </Button>
      </div>
      <Button type="button" variant="outline" disabled={running || nudging || nudgeFast(selected) == null} onClick={onNudge}>
        {nudging ? "Nudging" : "Nudge"}
      </Button>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {nudgeFast(selected)
          ? "Reruns this rule at fast−1, fast, and fast+1. The three returns land in Comparison."
          : "This rule has no fast length to nudge."}
      </p>
      <p className="text-xs leading-relaxed break-words text-muted-foreground">
        A signal is fixed on the close and filled on the next bar’s open. Fee and slippage are charged on the entry and
        the exit. Ten basis points is 0.10%. Risk per trade is the equity lost if the stop is hit, and the position is
        that amount divided by the stop. The stop is the 14-bar average true range at the signal, or 2% of price when
        the range is flat.
        {venue === "perp"
          ? " Perps size the position with this leverage, up to 20×, deduct funding, and liquidate through a 0.40% maintenance margin. Perp candles and funding come from the Kraken USD perpetual."
          : " Spot stays long or flat."}
      </p>
    </form>
  )
}

function ComboEditor({
  idPrefix,
  selected,
  onChange,
}: {
  idPrefix: string
  selected: Run
  onChange: (combo: Run["combo"]) => void
}) {
  const combo = selected.combo ?? []
  const taken = new Set([selected.rule, ...combo.map((item) => item.rule)])
  const available = RULES.filter((item) => !taken.has(item.id))
  const [pendingRule, setPendingRule] = useState<RuleId>("supertrend")
  const pending = available.some((item) => item.id === pendingRule) ? pendingRule : available[0]?.id

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Combined</span>
        <span className="font-mono text-[10px] text-muted-foreground">{combo.length}</span>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        A position opens only when this rule and every strategy below want the same side.
      </p>
      {combo.map((item) => {
        const spec = RULES.find((rule) => rule.id === item.rule)
        return (
          <div key={item.rule} className="flex flex-col gap-3 border-t border-border pt-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm">{spec?.name ?? item.rule}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`Remove ${spec?.name ?? item.rule}`}
                onClick={() => onChange(combo.filter((entry) => entry.rule !== item.rule))}
              >
                <Trash2 />
              </Button>
            </div>
            {spec && spec.params.length > 0 ? (
              <div className={spec.params.length > 1 ? "grid grid-cols-2 gap-3" : "flex flex-col gap-3"}>
                {spec.params.map((param) =>
                  param.toggle ? (
                    <div key={param.key} className="col-span-2 flex items-center justify-between gap-3">
                      <Label htmlFor={`${idPrefix}-combo-${item.rule}-${param.key}`}>{param.label}</Label>
                      <Switch
                        id={`${idPrefix}-combo-${item.rule}-${param.key}`}
                        checked={(item.params[param.key] ?? param.default) >= 1}
                        onCheckedChange={(checked) =>
                          onChange(
                            combo.map((entry) =>
                              entry.rule === item.rule
                                ? { ...entry, params: { ...entry.params, [param.key]: checked ? 1 : 0 } }
                                : entry,
                            ),
                          )
                        }
                      />
                    </div>
                  ) : param.options ? (
                    <div key={param.key} className="flex flex-col gap-1">
                      <Label htmlFor={`${idPrefix}-combo-${item.rule}-${param.key}`}>{param.label}</Label>
                      <Select
                        value={String(item.params[param.key] ?? param.default)}
                        onValueChange={(value) =>
                          onChange(
                            combo.map((entry) =>
                              entry.rule === item.rule ? { ...entry, params: { ...entry.params, [param.key]: Number(value) } } : entry,
                            ),
                          )
                        }
                      >
                        <SelectTrigger id={`${idPrefix}-combo-${item.rule}-${param.key}`} className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {param.options.map((option) => (
                            <SelectItem key={option.value} value={String(option.value)}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <DecimalField
                      key={param.key}
                      id={`${idPrefix}-combo-${item.rule}-${param.key}`}
                      label={param.label}
                      value={item.params[param.key] ?? param.default}
                      min={param.min}
                      max={param.max}
                      integer={param.integer}
                      onValue={(value) =>
                        onChange(
                          combo.map((entry) =>
                            entry.rule === item.rule ? { ...entry, params: { ...entry.params, [param.key]: value } } : entry,
                          ),
                        )
                      }
                    />
                  ),
                )}
              </div>
            ) : null}
          </div>
        )
      })}
      {pending ? (
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Select value={pending} onValueChange={(ruleId) => setPendingRule(ruleId as RuleId)}>
              <SelectTrigger id={`${idPrefix}-combo-add`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {available.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => onChange([...combo, { rule: pending, params: ruleParams(pending) }])}
          >
            Add
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function DecimalField({
  id,
  label,
  value,
  min,
  max,
  integer = false,
  onValue,
  hint,
}: {
  id: string
  label: string
  value: number
  min: number
  max: number
  integer?: boolean
  onValue: (value: number) => void
  hint?: ReactNode
}) {
  const [text, setText] = useState<string | null>(null)

  function commit(raw: string) {
    const trimmed = raw.trim()
    const parsed = trimmed === "" || trimmed === "." || trimmed === "-" ? Number.NaN : Number(trimmed)
    const next = Number.isFinite(parsed) ? Math.min(max, Math.max(min, integer ? Math.round(parsed) : parsed)) : value
    setText(null)
    if (next !== value) onValue(next)
  }

  return (
    <Field label={label} htmlFor={id}>
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        value={text ?? String(value)}
        onFocus={() => setText((current) => current ?? String(value))}
        onChange={(event) => {
          const raw = event.target.value
          setText(raw)
          const trimmed = raw.trim()
          if (trimmed === "" || trimmed === "." || trimmed === "-" || trimmed.endsWith(".")) return
          const parsed = Number(trimmed)
          if (!Number.isFinite(parsed) || parsed < min || parsed > max) return
          const next = integer ? Math.round(parsed) : parsed
          if (next !== value) onValue(next)
        }}
        onBlur={(event) => commit(event.currentTarget.value)}
      />
      {hint}
    </Field>
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

function riskCopy(capital: number, riskPct: number): string {
  const stake = capital * (riskPct / 100)
  const money = formatMoney(stake, 2)
  return `${money} of equity is lost if the stop is hit. Size is that amount divided by the stop distance.`
}

