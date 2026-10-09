import { useEffect, useSyncExternalStore } from "react"

import { fetchMarkets } from "@/lib/api"
import { getMarkets, replaceMarkets, subscribeMarkets, type SpotMarket } from "@/lib/markets"
import type { Venue } from "@/lib/types"

const started = new Set<Venue>()

export function useMarkets(venue: Venue): SpotMarket[] {
  const markets = useSyncExternalStore(subscribeMarkets, () => getMarkets(venue), () => getMarkets(venue))
  useEffect(() => {
    if (started.has(venue)) return
    started.add(venue)
    fetchMarkets(venue)
      .then((next) => replaceMarkets(next, venue))
      .catch(() => {
        started.delete(venue)
      })
  }, [venue])
  return markets
}
