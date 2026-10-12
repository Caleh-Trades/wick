/// <reference lib="webworker" />

import { backtest } from "./backtest.ts"
import type { FundingRate, Run, TapeCandle, Venue } from "./types.ts"

type Job = {
  id: number
  candles: TapeCandle[]
  run: Run
  periodsPerYear: number
  venue: Venue
  funding: FundingRate[] | null
  fundingStale: boolean
  biasCandles?: TapeCandle[] | null
}

addEventListener("message", (event: MessageEvent<Job>) => {
  const job = event.data
  try {
    const result = backtest(job.candles, job.run, job.periodsPerYear, {
      venue: job.venue,
      funding: job.funding,
      fundingStale: job.fundingStale,
      biasCandles: job.biasCandles,
    })
    postMessage({ id: job.id, ok: true, result })
  } catch (reason) {
    postMessage({
      id: job.id,
      ok: false,
      error: reason instanceof Error ? reason.message : "This run didn't compute.",
    })
  }
})
