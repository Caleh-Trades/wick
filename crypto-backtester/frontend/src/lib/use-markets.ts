import { useEffect, useSyncExternalStore } from "react"

import { fetchMarkets } from "@/lib/api"
import { getMarkets, replaceMarkets, subscribeMarkets, type SpotMarket } from "@/lib/markets"

let started = false

export function useSpotMarkets(): SpotMarket[] {
  const markets = useSyncExternalStore(subscribeMarkets, getMarkets, getMarkets)
  useEffect(() => {
    if (started) return
    started = true
    fetchMarkets()
      .then((next) => replaceMarkets(next))
      .catch(() => {
        started = false
      })
  }, [])
  return markets
}
