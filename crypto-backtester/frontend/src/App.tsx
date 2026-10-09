import { useCallback, useEffect, useRef, useState } from "react"

import { Controls } from "@/components/controls"
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
import { fetchMeta, runBacktest } from "@/lib/api"
import { daysAgoUtc, todayUtc } from "@/lib/format"
import type { BacktestResult, Draft, Meta } from "@/lib/types"

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [result, setResult] = useState<BacktestResult | null>(null)
  const [loadingMeta, setLoadingMeta] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [setupOpen, setSetupOpen] = useState(false)
  const requestId = useRef(0)
  const opened = useRef(false)

  useEffect(() => {
    let cancelled = false
    fetchMeta()
      .then((next) => {
        if (cancelled) return
        const strategy = next.strategies.find((item) => item.id === next.defaults.strategy)
        const initial: Draft = {
          symbol: next.defaults.symbol,
          interval: next.defaults.interval,
          strategy: next.defaults.strategy,
          params: Object.fromEntries((strategy?.params ?? []).map((param) => [param.key, param.default])),
          start: daysAgoUtc(730),
          end: todayUtc(),
          initial_capital: next.defaults.initial_capital,
          fee_bps: next.defaults.fee_bps,
          slippage_bps: next.defaults.slippage_bps,
          allow_short: next.defaults.allow_short,
        }
        setMeta(next)
        setDraft(initial)
        setLoadingMeta(false)
      })
      .catch((reason: unknown) => {
        if (cancelled) return
        setError(reason instanceof Error ? reason.message : "The desk couldn't load.")
        setLoadingMeta(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const run = useCallback(async (next: Draft) => {
    const id = ++requestId.current
    setRunning(true)
    setError(null)
    try {
      const backtest = await runBacktest(next)
      if (id !== requestId.current) return
      setResult(backtest)
      setSetupOpen(false)
    } catch (reason: unknown) {
      if (id !== requestId.current) return
      setError(reason instanceof Error ? reason.message : "The backtest didn't run.")
    } finally {
      if (id === requestId.current) setRunning(false)
    }
  }, [])

  useEffect(() => {
    if (!draft || opened.current) return
    opened.current = true
    void run(draft)
  }, [draft, run])

  const market = meta?.symbols.find((symbol) => symbol.id === draft?.symbol)

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
        <aside className="hidden lg:block">
          <div className="sticky top-6 max-h-[calc(100svh-3rem)] overflow-y-auto pr-2">
            {meta && draft ? (
              <Controls
                idPrefix="desk"
                meta={meta}
                draft={draft}
                running={running}
                onChange={setDraft}
                onRun={() => void run(draft)}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Loading markets…</p>
            )}
          </div>
        </aside>

        <section aria-busy={running} className="min-w-0">
          {error ? (
            <div role="alert" className="mb-6 border border-down/30 bg-down/10 px-4 py-3 text-sm text-down">
              {error}
            </div>
          ) : null}

          {loadingMeta ? <LoadingCopy label="Opening the desk…" /> : null}

          {!loadingMeta && running && !result ? (
            <LoadingCopy
              label={`Pulling ${market?.name ?? "the market"} and walking the rule. The first look at a pair can take a few seconds.`}
            />
          ) : null}

          {result && meta ? <Results result={result} meta={meta} /> : null}

          {!loadingMeta && !running && !result && !error ? (
            <p className="font-heading text-3xl">Set a rule and walk it through the tape.</p>
          ) : null}

          {running && result ? (
            <p className="mt-6 font-mono text-xs tracking-wide text-muted-foreground uppercase">Running the next pass…</p>
          ) : null}
        </section>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 p-3 backdrop-blur lg:hidden">
        <Sheet open={setupOpen} onOpenChange={setSetupOpen}>
          <SheetTrigger asChild>
            <Button className="w-full">Setup</Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="max-h-[88svh] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Setup</SheetTitle>
              <SheetDescription>Market, rule, window, and trading costs.</SheetDescription>
            </SheetHeader>
            <div className="px-8 pb-8">
              {meta && draft ? (
                <Controls
                  idPrefix="sheet"
                  meta={meta}
                  draft={draft}
                  running={running}
                  onChange={setDraft}
                  onRun={() => void run(draft)}
                />
              ) : null}
            </div>
          </SheetContent>
        </Sheet>
      </div>
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
