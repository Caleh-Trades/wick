import { backtest } from "./backtest.ts"
import { fingerprint } from "./runs.ts"
import type { BacktestResult, Outcome, Run, Tape } from "./types.ts"

let worker: Worker | null = null
let workerBroken = false
let seq = 0
const pending = new Map<number, (reply: { ok: boolean; result?: BacktestResult; error?: string }) => void>()

function getWorker(): Worker | null {
  if (workerBroken) return null
  if (worker) return worker
  if (typeof Worker === "undefined") return null
  try {
    worker = new Worker(new URL("./backtest.worker.ts", import.meta.url), { type: "module" })
  } catch {
    workerBroken = true
    return null
  }
  worker.onmessage = (event: MessageEvent<{ ok: boolean; result?: BacktestResult; error?: string; id: number }>) => {
    const resolve = pending.get(event.data.id)
    pending.delete(event.data.id)
    resolve?.(event.data)
  }
  worker.onerror = () => {
    workerBroken = true
    worker?.terminate()
    worker = null
    const waiting = [...pending.values()]
    pending.clear()
    for (const resolve of waiting) resolve({ ok: false, error: "worker" })
  }
  return worker
}

/** Run the strategy off the desk thread so the book can keep repainting. */
export function computeBacktest(run: Run, tape: Tape, biasTape?: Tape | null): Promise<Outcome> {
  const mark = fingerprint(run)
  const biasCandles = biasTape && biasTape.candles.length >= 3 ? biasTape.candles : null
  const engine = getWorker()
  if (!engine) return Promise.resolve(localBacktest(run, tape, mark, biasCandles))
  const id = ++seq
  return new Promise((resolve) => {
    pending.set(id, (reply) => {
      if (reply.error === "worker") {
        resolve(localBacktest(run, tape, mark, biasCandles))
        return
      }
      if (!reply.ok || !reply.result) {
        resolve({ ok: false, error: reply.error ?? "This run didn't compute.", fingerprint: mark })
        return
      }
      reply.result.interval = tape.interval
      reply.result.source = tape.source
      resolve({ ok: true, result: reply.result, fingerprint: mark })
    })
    engine.postMessage({
      id,
      candles: tape.candles,
      run,
      periodsPerYear: tape.periodsPerYear,
      venue: tape.venue,
      funding: tape.funding ?? null,
      fundingStale: tape.fundingStale === true,
      biasCandles,
    })
  })
}

function localBacktest(run: Run, tape: Tape, mark: string, biasCandles: Tape["candles"] | null): Outcome {
  try {
    const result = backtest(tape.candles, run, tape.periodsPerYear, {
      venue: tape.venue,
      funding: tape.funding,
      fundingStale: tape.fundingStale,
      biasCandles,
    })
    result.interval = tape.interval
    result.source = tape.source
    return { ok: true, result, fingerprint: mark }
  } catch (reason: unknown) {
    return {
      ok: false,
      error: reason instanceof Error ? reason.message : "This run didn't compute.",
      fingerprint: mark,
    }
  }
}
