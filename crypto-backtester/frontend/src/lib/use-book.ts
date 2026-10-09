import { useEffect, useState, useSyncExternalStore } from "react"

import { projectLadder, rollingFlow, streamNames, takerSide, TAPE_LENGTH, type FlowSide, type Level, type Print } from "@/lib/book"
import { barSeconds, mergeForming } from "@/lib/forming"
import type { TapeCandle, Venue } from "@/lib/types"

const SOCKET_URL: Record<Venue, string> = {
  spot: "wss://data-stream.binance.vision/ws",
  perp: "wss://fstream.binance.com/ws",
}
const REPAINT_MS = 1000
const STALE_MS = 3_000
const SILENCE_MS = 10_000
const PRINT_MEMORY = 500

export type BookStatus = "connecting" | "connected" | "stale"

export type LiveView = {
  symbol: string
  venue: Venue
  status: BookStatus
  asOf: number | null
  heardAt: number | null
  bids: Level[]
  asks: Level[]
  spread: number | null
  mid: number | null
  last: { price: number; side: FlowSide; changed: boolean } | null
  prints: Print[]
  freshIds: string[]
  delta: number
  buy: number
  sell: number
}

const EMPTY: LiveView = {
  symbol: "",
  venue: "spot",
  status: "connecting",
  asOf: null,
  heardAt: null,
  bids: [],
  asks: [],
  spread: null,
  mid: null,
  last: null,
  prints: [],
  freshIds: [],
  delta: 0,
  buy: 0,
  sell: 0,
}

let view: LiveView = EMPTY
const listeners = new Set<() => void>()
let socket: WebSocket | null = null
let symbol = ""
let venue: Venue = "spot"
let accept = false
let attempt = 0
let retry = 0
let silence = 0
let requestId = 0
let pendingUnsub: number | null = null
let pendingSub: number | null = null
let activeParams: string[] = []
let latest: { bids: [string, string][]; asks: [string, string][] } | null = null
let prints: Print[] = []
let seen = new Set<string>()
let sizes = new Map<string, number>()
let publishedPrice: number | null = null
let sawGood = false
let primed = false
let heardAt: number | null = null
let repaint = 0

function emit(next: LiveView) {
  view = next
  for (const listener of listeners) listener()
}

function clearBook(nextSymbol: string, status: BookStatus) {
  latest = null
  prints = []
  seen = new Set()
  sizes = new Map()
  publishedPrice = null
  sawGood = false
  primed = false
  heardAt = null
  accept = false
  emit({ ...EMPTY, symbol: nextSymbol, venue, status })
}

export function retainBook(next: string | null, nextVenue: Venue = "spot") {
  const id = (next ?? "").toUpperCase()
  const venueChanged = nextVenue !== venue
  if (!id.endsWith("USDT")) {
    venue = nextVenue
    symbol = ""
    clearBook("", "stale")
    return
  }
  if (
    id === symbol &&
    !venueChanged &&
    socket &&
    (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
  ) {
    return
  }
  const previous = activeParams.slice()
  symbol = id
  venue = nextVenue
  clearBook(id, "connecting")
  if (venueChanged) {
    dropSocket()
    openSocket()
    return
  }
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    openSocket()
    return
  }
  if (previous.length > 0) {
    const idNum = ++requestId
    pendingUnsub = idNum
    pendingSub = null
    socket.send(JSON.stringify({ method: "UNSUBSCRIBE", params: previous, id: idNum }))
    return
  }
  sendSubscribe()
}

function dropSocket() {
  const ws = socket
  socket = null
  window.clearTimeout(silence)
  accept = false
  activeParams = []
  pendingSub = null
  pendingUnsub = null
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.close()
    } catch {
      /* the next socket replaces it */
    }
  } else {
    ws?.close()
  }
}

export function getLive(): LiveView {
  return view
}

export function subscribeLive(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useLiveBook(symbolId: string | null, nextVenue: Venue = "spot"): LiveView {
  const live = useSyncExternalStore(subscribeLive, getLive, getLive)
  useEffect(() => {
    retainBook(symbolId, nextVenue)
  }, [symbolId, nextVenue])
  const wanted = (symbolId ?? "").toUpperCase()
  if (live.symbol !== wanted || live.venue !== nextVenue) {
    return { ...EMPTY, symbol: wanted, venue: nextVenue, status: wanted.endsWith("USDT") ? "connecting" : "stale" }
  }
  return live
}

export function useFormingCandles(candles: TapeCandle[], interval: string, symbolId: string | null): TapeCandle[] {
  const [live, setLive] = useState(candles)
  const [fetchedAt, setFetchedAt] = useState(() => Date.now())
  const [source, setSource] = useState(candles)

  if (source !== candles) {
    setSource(candles)
    setLive(candles)
    setFetchedAt(Date.now())
  }

  useEffect(() => {
    return subscribeLive(() => {
      if (!symbolId || getLive().symbol !== symbolId.toUpperCase()) return
      const next = mergeForming(candles, prints, barSeconds(interval), fetchedAt)
      setLive((current) => (next === candles || sameTail(current, next) ? current : next))
    })
  }, [candles, fetchedAt, interval, symbolId])

  return source !== candles ? candles : live
}

function sameTail(left: TapeCandle[], right: TapeCandle[]): boolean {
  if (left.length !== right.length) return false
  const a = left[left.length - 1]
  const b = right[right.length - 1]
  if (!a || !b) return false
  return a.t === b.t && a.open === b.open && a.high === b.high && a.low === b.low && a.close === b.close && a.volume === b.volume
}

function openSocket() {
  window.clearTimeout(retry)
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return
  const ws = new WebSocket(SOCKET_URL[venue])
  socket = ws
  ws.onopen = () => {
    if (socket !== ws) return
    attempt = 0
    armSilence()
    sendSubscribe()
    if (!repaint) repaint = window.setInterval(publish, REPAINT_MS)
  }
  ws.onmessage = (event) => {
    if (socket !== ws) return
    armSilence()
    heardAt = Date.now()
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(String(event.data)) as Record<string, unknown>
    } catch {
      return
    }
    const nested = payload.data
    if (nested && typeof nested === "object") payload = nested as Record<string, unknown>
    if (typeof payload.id === "number") {
      onAck(payload.id)
      return
    }
    if (!accept || !symbol) return
    if (typeof payload.s === "string" && payload.s !== symbol) return
    if (payload.e === "trade" || payload.e === "aggTrade") {
      takeTrade(payload)
      return
    }
    const bids = Array.isArray(payload.bids) ? payload.bids : Array.isArray(payload.b) ? payload.b : null
    const asks = Array.isArray(payload.asks) ? payload.asks : Array.isArray(payload.a) ? payload.a : null
    if (bids && asks) {
      latest = { bids: bids as [string, string][], asks: asks as [string, string][] }
      if (!primed) {
        primed = true
        publish()
      }
    }
  }
  ws.onerror = () => ws.close()
  ws.onclose = () => {
    if (socket !== ws) return
    socket = null
    window.clearTimeout(silence)
    accept = false
    activeParams = []
    if (sawGood) emit({ ...view, status: "stale" })
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5))
    attempt += 1
    retry = window.setTimeout(openSocket, delay)
  }
}

function sendSubscribe() {
  if (!socket || socket.readyState !== WebSocket.OPEN || !symbol) return
  activeParams = streamNames(symbol, venue)
  const idNum = ++requestId
  pendingSub = idNum
  pendingUnsub = null
  accept = false
  socket.send(JSON.stringify({ method: "SUBSCRIBE", params: activeParams, id: idNum }))
}

function onAck(id: number) {
  if (id === pendingUnsub) {
    pendingUnsub = null
    activeParams = []
    sendSubscribe()
    return
  }
  if (id === pendingSub) {
    pendingSub = null
    accept = true
  }
}

function takeTrade(payload: Record<string, unknown>) {
  if (payload.s !== symbol) return
  const price = Number(payload.p)
  const size = Number(payload.q)
  const t = Number(payload.T)
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(size) || size <= 0 || !Number.isFinite(t)) return
  const tradeId = payload.a ?? payload.t
  const id = tradeId == null ? `${t}|${payload.p}|${payload.q}` : String(tradeId)
  if (seen.has(id)) return
  seen.add(id)
  prints.push({ id, t, side: takerSide(payload.m === true), price, size })
  if (prints.length > PRINT_MEMORY) {
    const dropped = prints.splice(0, prints.length - PRINT_MEMORY)
    for (const print of dropped) seen.delete(print.id)
  }
}

function armSilence() {
  window.clearTimeout(silence)
  silence = window.setTimeout(() => socket?.close(), SILENCE_MS)
}

function publish() {
  if (!symbol) return
  const now = Date.now()
  const quiet = heardAt == null || now - heardAt > STALE_MS
  const flow = rollingFlow(prints, now)
  const tape = prints.slice(-TAPE_LENGTH).reverse()
  if (!latest || !accept) {
    if (view.bids.length > 0 || view.asks.length > 0 || sawGood) {
      emit({ ...view, status: "stale", heardAt, prints: tape, ...flow, freshIds: [] })
    }
    return
  }
  const ladder = projectLadder(latest.bids, latest.asks, sizes)
  if (ladder.crossed) {
    sizes = new Map()
    sawGood = false
    emit({
      ...EMPTY,
      symbol,
      venue,
      status: "stale",
      asOf: view.asOf,
      heardAt,
      prints: tape,
      ...flow,
      last: view.last ? { ...view.last, changed: false } : null,
    })
    return
  }
  const nextSizes = new Map<string, number>()
  for (const level of ladder.bids) nextSizes.set(`bid:${level.priceKey}`, level.size)
  for (const level of ladder.asks) nextSizes.set(`ask:${level.priceKey}`, level.size)
  const lastPrint = prints[prints.length - 1]
  const priceChanged = lastPrint != null && lastPrint.price !== publishedPrice
  const freshIds = tape.filter((print) => !view.prints.some((row) => row.id === print.id)).map((print) => print.id)
  sizes = nextSizes
  if (lastPrint) publishedPrice = lastPrint.price
  sawGood = true
  emit({
    symbol,
    venue,
    status: quiet ? "stale" : "connected",
    asOf: now,
    heardAt,
    bids: ladder.bids,
    asks: ladder.asks,
    spread: ladder.spread,
    mid: ladder.mid,
    last: lastPrint ? { price: lastPrint.price, side: lastPrint.side, changed: priceChanged } : view.last,
    prints: tape,
    freshIds,
    delta: flow.delta,
    buy: flow.buy,
    sell: flow.sell,
  })
}
