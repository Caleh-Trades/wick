import { useEffect, useState, useSyncExternalStore } from "react"

import { projectLadder, rollingFlow, streamNames, takerSide, TAPE_LENGTH, type FlowSide, type Level, type Print } from "@/lib/book"
import { barSeconds, mergeForming } from "@/lib/forming"
import type { TapeCandle } from "@/lib/types"

const SOCKET_URL = "wss://data-stream.binance.vision/ws"
const REPAINT_MS = 1000
const SILENCE_MS = 10_000
const PRINT_MEMORY = 500

export type BookStatus = "connecting" | "connected" | "stale"

export type LiveView = {
  symbol: string
  status: BookStatus
  asOf: number | null
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
  status: "connecting",
  asOf: null,
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
  accept = false
  emit({ ...EMPTY, symbol: nextSymbol, status })
}

export function retainBook(next: string | null) {
  const id = (next ?? "").toUpperCase()
  if (!id.endsWith("USDT")) {
    symbol = ""
    clearBook("", "stale")
    return
  }
  if (id === symbol && socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return
  }
  const previous = activeParams.slice()
  symbol = id
  clearBook(id, "connecting")
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

export function getLive(): LiveView {
  return view
}

export function subscribeLive(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useLiveBook(symbolId: string | null): LiveView {
  const live = useSyncExternalStore(subscribeLive, getLive, getLive)
  useEffect(() => {
    retainBook(symbolId)
  }, [symbolId])
  const wanted = (symbolId ?? "").toUpperCase()
  if (live.symbol !== wanted) {
    return { ...EMPTY, symbol: wanted, status: wanted.endsWith("USDT") ? "connecting" : "stale" }
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
  const ws = new WebSocket(SOCKET_URL)
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
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(String(event.data)) as Record<string, unknown>
    } catch {
      return
    }
    if (typeof payload.id === "number") {
      onAck(payload.id)
      return
    }
    if (!accept || !symbol) return
    if (payload.e === "trade") {
      takeTrade(payload)
      return
    }
    if (Array.isArray(payload.bids) && Array.isArray(payload.asks)) {
      latest = { bids: payload.bids as [string, string][], asks: payload.asks as [string, string][] }
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
  activeParams = streamNames(symbol)
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
  const id = payload.t == null ? `${t}|${payload.p}|${payload.q}` : String(payload.t)
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
  const flow = rollingFlow(prints, now)
  const tape = prints.slice(-TAPE_LENGTH).reverse()
  if (!latest || !accept) {
    if (view.status === "connected") emit({ ...view, status: "stale", prints: tape, ...flow, freshIds: [] })
    return
  }
  const ladder = projectLadder(latest.bids, latest.asks, sizes)
  if (ladder.crossed) {
    sizes = new Map()
    sawGood = false
    emit({
      ...EMPTY,
      symbol,
      status: "stale",
      asOf: view.asOf,
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
    status: "connected",
    asOf: now,
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
