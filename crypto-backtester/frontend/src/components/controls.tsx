import type { ReactNode } from "react"

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
import { Switch } from "@/components/ui/switch"
import { daysAgoUtc, todayUtc } from "@/lib/format"
import type { Draft, Meta, ParamSpec } from "@/lib/types"

const presets = [
  { id: "90", label: "90D", days: 90 },
  { id: "1y", label: "1Y", days: 365 },
  { id: "2y", label: "2Y", days: 730 },
  { id: "all", label: "All", days: null },
] as const

type ControlsProps = {
  idPrefix: string
  meta: Meta
  draft: Draft
  running: boolean
  onChange: (draft: Draft) => void
  onRun: () => void
}

export function Controls({ idPrefix, meta, draft, running, onChange, onRun }: ControlsProps) {
  const strategy = meta.strategies.find((item) => item.id === draft.strategy)

  function setStrategy(strategyId: string) {
    const next = meta.strategies.find((item) => item.id === strategyId)
    onChange({
      ...draft,
      strategy: strategyId,
      params: Object.fromEntries((next?.params ?? []).map((param) => [param.key, param.default])),
    })
  }

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault()
        onRun()
      }}
    >
      <Field label="Market" htmlFor={`${idPrefix}-symbol`}>
        <Select value={draft.symbol} onValueChange={(symbol) => onChange({ ...draft, symbol })}>
          <SelectTrigger id={`${idPrefix}-symbol`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {meta.symbols.map((symbol) => (
              <SelectItem key={symbol.id} value={symbol.id}>
                {symbol.name}
                <span className="text-muted-foreground"> {symbol.base}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Interval" htmlFor={`${idPrefix}-interval`}>
        <Select value={draft.interval} onValueChange={(interval) => onChange({ ...draft, interval })}>
          <SelectTrigger id={`${idPrefix}-interval`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {meta.intervals.map((interval) => (
              <SelectItem key={interval.id} value={interval.id}>
                {interval.label}
                <span className="text-muted-foreground"> · {interval.detail}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Window</span>
        <div className="flex flex-wrap gap-2">
          {presets.map((preset) => (
            <Button
              key={preset.id}
              type="button"
              variant="outline"
              size="xs"
              onClick={() =>
                onChange({
                  ...draft,
                  start: preset.days == null ? "" : daysAgoUtc(preset.days),
                  end: todayUtc(),
                })
              }
            >
              {preset.label}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Start" htmlFor={`${idPrefix}-start`}>
            <Input
              id={`${idPrefix}-start`}
              type="date"
              value={draft.start}
              max={draft.end || undefined}
              onChange={(event) => onChange({ ...draft, start: event.target.value })}
            />
          </Field>
          <Field label="End" htmlFor={`${idPrefix}-end`}>
            <Input
              id={`${idPrefix}-end`}
              type="date"
              value={draft.end}
              min={draft.start || undefined}
              onChange={(event) => onChange({ ...draft, end: event.target.value })}
            />
          </Field>
        </div>
      </div>

      <Separator />

      <Field label="Rule" htmlFor={`${idPrefix}-strategy`}>
        <Select value={draft.strategy} onValueChange={setStrategy}>
          <SelectTrigger id={`${idPrefix}-strategy`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {meta.strategies.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {strategy ? <p className="text-sm leading-relaxed text-muted-foreground">{strategy.summary}</p> : null}

      {strategy && strategy.params.length > 0 ? (
        <div className="grid grid-cols-2 gap-4">
          {strategy.params.map((param) => (
            <ParamField
              key={param.key}
              idPrefix={idPrefix}
              param={param}
              value={draft.params[param.key] ?? param.default}
              onValue={(value) => onChange({ ...draft, params: { ...draft.params, [param.key]: value } })}
            />
          ))}
        </div>
      ) : null}

      {draft.strategy !== "buy_hold" ? (
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor={`${idPrefix}-short`} className="normal-case tracking-normal">
            Allow shorts
          </Label>
          <Switch
            id={`${idPrefix}-short`}
            checked={draft.allow_short}
            onCheckedChange={(allow_short) => onChange({ ...draft, allow_short })}
          />
        </div>
      ) : null}

      <Separator />

      <div className="grid grid-cols-2 gap-4">
        <Field label="Capital" htmlFor={`${idPrefix}-capital`}>
          <Input
            id={`${idPrefix}-capital`}
            type="number"
            inputMode="decimal"
            min={100}
            step={100}
            value={draft.initial_capital}
            onChange={(event) => onChange({ ...draft, initial_capital: numberOr(event.target.value, draft.initial_capital) })}
          />
        </Field>
        <Field label="Fee (bps)" htmlFor={`${idPrefix}-fee`}>
          <Input
            id={`${idPrefix}-fee`}
            type="number"
            inputMode="decimal"
            min={0}
            max={1000}
            step={1}
            value={draft.fee_bps}
            onChange={(event) => onChange({ ...draft, fee_bps: numberOr(event.target.value, draft.fee_bps) })}
          />
        </Field>
        <Field label="Slippage (bps)" htmlFor={`${idPrefix}-slip`}>
          <Input
            id={`${idPrefix}-slip`}
            type="number"
            inputMode="decimal"
            min={0}
            max={1000}
            step={1}
            value={draft.slippage_bps}
            onChange={(event) => onChange({ ...draft, slippage_bps: numberOr(event.target.value, draft.slippage_bps) })}
          />
        </Field>
      </div>

      <Button type="submit" disabled={running} className="w-full">
        {running ? "Running" : "Run backtest"}
      </Button>
      <p className="text-xs leading-relaxed break-words text-muted-foreground">
        A signal is fixed on the close and filled on the next bar’s open. Ten basis points is 0.10%.
      </p>
    </form>
  )
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  )
}

function ParamField({
  idPrefix,
  param,
  value,
  onValue,
}: {
  idPrefix: string
  param: ParamSpec
  value: number
  onValue: (value: number) => void
}) {
  return (
    <Field label={param.label} htmlFor={`${idPrefix}-${param.key}`}>
      <Input
        id={`${idPrefix}-${param.key}`}
        type="number"
        inputMode="decimal"
        min={param.min}
        max={param.max}
        step={param.step}
        value={value}
        onChange={(event) => onValue(numberOr(event.target.value, value))}
      />
    </Field>
  )
}

function numberOr(raw: string, fallback: number): number {
  if (raw.trim() === "") return fallback
  const value = Number(raw)
  return Number.isFinite(value) ? value : fallback
}
