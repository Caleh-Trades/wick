import { useEffect, useState, useSyncExternalStore } from "react"

import { krakenProduct, projectLadder, rollingFlow, streamNames, takerSide, tickerName, TAPE_LENGTH, type FlowSide, type Level, type Print } from "@/lib/book"
import { barSeconds, mergeForming } from "@/lib/forming"
import type { TapeCandle, Venue } from "@/lib/types"

const SOCKET_URL: Record<Venue, string> = {
  spot: "wss://data-stream.binance.vision/ws",
  perp: "wss://futures.kraken.com/ws/v1",
}
/** Depth on fstream `/ws` is live. Trades and the 24h ticker only arrive on `/market`. */
const PERP_TAPE_URL = "wss://fstream.binance.com/market/ws"
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
  quote: number | null
  changePct: number | null
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
  quote: null,
  changePct: null,
  prints: [],
  freshIds: [],
  delta: 0,
  buy: 0,
  sell: 0,
}

type BookConn = {
  key: string
  symbol: string
  venue: Venue
  refs: number
  depthRefs: number
  socket: WebSocket | null
  tapeSocket: WebSocket | null
  accept: boolean
  tapeAccept: boolean
  attempt: number
  retry: number
  tapeRetry: number
  silence: number
  requestId: number
  pendingUnsub: number | null
  pendingSub: number | null
  tapePending: number | null
  activeParams: string[]
  tapeActive: string[]
  latest: { bids: [string, string][]; asks: [string, string][] } | null
  prints: Print[]
  seen: Set<string>
  sizes: Map<string, number>
  publishedPrice: number | null
  sawGood: boolean
  primed: boolean
  heardAt: number | null
  quote: number | null
  changePct: number | null
  bookBids: Map<string, number>
  bookAsks: Map<string, number>
  view: LiveView
}

const books = new Map<string, BookConn>()
const listeners = new Set<() => void>()
let repaint = 0

function bookKey(symbol: string, venue: Venue): string {
  return `${venue}:${symbol.toUpperCase()}`
}

function emit() {
  for (const listener of listeners) listener()
}

const blanks = new Map<string, LiveView>()

function blank(symbol: string, venue: Venue, status: BookStatus): LiveView {
  const key = `${venue}:${symbol}:${status}`
  const cached = blanks.get(key)
  if (cached) return cached
  const view = { ...EMPTY, symbol, venue, status }
  blanks.set(key, view)
  return view
}

function getView(symbol: string | null, venue: Venue): LiveView {
  const id = (symbol ?? "").toUpperCase()
  if (!id) return EMPTY
  return books.get(bookKey(id, venue))?.view ?? blank(id, venue, id.endsWith("USDT") ? "connecting" : "stale")
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function ensure(symbol: string, venue: Venue): BookConn | null {
  const id = symbol.toUpperCase()
  if (!id.endsWith("USDT")) return null
  const key = bookKey(id, venue)
  const existing = books.get(key)
  if (existing) return existing
  const conn: BookConn = {
    key,
    symbol: id,
    venue,
    refs: 0,
    depthRefs: 0,
    socket: null,
    tapeSocket: null,
    accept: false,
    tapeAccept: false,
    attempt: 0,
    retry: 0,
    tapeRetry: 0,
    silence: 0,
    requestId: 0,
    pendingUnsub: null,
    pendingSub: null,
    tapePending: null,
    activeParams: [],
    tapeActive: [],
    latest: null,
    prints: [],
    seen: new Set(),
    sizes: new Map(),
    publishedPrice: null,
    sawGood: false,
    primed: false,
    heardAt: null,
    quote: null,
    changePct: null,
    bookBids: new Map(),
    bookAsks: new Map(),
    view: blank(id, venue, "connecting"),
  }
  books.set(key, conn)
  return conn
}

/** Keep a socket for this contract. Depth stays up while any holder asks for the book. */
export function holdBook(symbol: string | null, venue: Venue, depth: boolean): () => void {
  const conn = symbol ? ensure(symbol, venue) : null
  if (!conn) return () => undefined
  conn.refs += 1
  if (depth) conn.depthRefs += 1
  syncSocket(conn)
  return () => release(conn, depth)
}

function release(conn: BookConn, depth: boolean) {
  conn.refs = Math.max(0, conn.refs - 1)
  if (depth) conn.depthRefs = Math.max(0, conn.depthRefs - 1)
  if (conn.refs <= 0) {
    dropSocket(conn)
    books.delete(conn.key)
    emit()
    return
  }
  syncSocket(conn)
}

function depthParams(conn: BookConn): string[] {
  if (conn.venue === "perp") {
    if (conn.depthRefs <= 0) return []
    return [`${conn.symbol.toLowerCase()}@depth20@100ms`]
  }
  if (conn.depthRefs <= 0) return [tickerName(conn.symbol)]
  return streamNames(conn.symbol, "spot")
}

function tapeStreamParams(conn: BookConn): string[] {
  if (conn.venue !== "perp") return []
  const pair = conn.symbol.toLowerCase()
  if (conn.depthRefs > 0) return [`${pair}@aggTrade`, tickerName(conn.symbol)]
  return [tickerName(conn.symbol)]
}

function syncSocket(conn: BookConn) {
  if (!repaint) repaint = window.setInterval(republish, REPAINT_MS)
  if (conn.venue === "perp") {
    syncKraken(conn)
    return
  }
  const next = depthParams(conn)
  if (next.length === 0) {
    if (conn.socket) {
      const ws = conn.socket
      conn.socket = null
      conn.accept = false
      conn.activeParams = []
      ws.close()
    }
  } else if (!conn.socket || (conn.socket.readyState !== WebSocket.OPEN && conn.socket.readyState !== WebSocket.CONNECTING)) {
    openSocket(conn)
  } else if (conn.socket.readyState === WebSocket.OPEN && !sameParams(conn.activeParams, next)) {
    if (conn.activeParams.length > 0) {
      const idNum = ++conn.requestId
      conn.pendingUnsub = idNum
      conn.pendingSub = null
      conn.socket.send(JSON.stringify({ method: "UNSUBSCRIBE", params: conn.activeParams, id: idNum }))
    } else {
      sendSubscribe(conn)
    }
  }
  syncTape(conn)
}

function sameParams(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

export function useLiveBook(symbolId: string | null, nextVenue: Venue = "spot"): LiveView {
  const live = useSyncExternalStore(subscribe, () => getView(symbolId, nextVenue), () => getView(symbolId, nextVenue))
  useEffect(() => holdBook(symbolId, nextVenue, true), [symbolId, nextVenue])
  return live
}

/** Read a slot or favourite quote without opening a second socket. */
export function useBookView(symbolId: string | null, nextVenue: Venue = "spot"): LiveView {
  return useSyncExternalStore(subscribe, () => getView(symbolId, nextVenue), () => getView(symbolId, nextVenue))
}

export function useFormingCandles(
  candles: TapeCandle[],
  interval: string,
  symbolId: string | null,
  nextVenue: Venue = "spot",
): TapeCandle[] {
  const [live, setLive] = useState(candles)
  const [fetchedAt, setFetchedAt] = useState(() => Date.now())
  const [source, setSource] = useState(candles)

  if (source !== candles) {
    setSource(candles)
    setLive(candles)
    setFetchedAt(Date.now())
  }

  useEffect(() => {
    return subscribe(() => {
      const id = symbolId?.toUpperCase()
      if (!id) return
      const conn = books.get(bookKey(id, nextVenue))
      if (!conn) return
      const next = mergeForming(candles, conn.prints, barSeconds(interval), fetchedAt)
      setLive((current) => (next === candles || sameTail(current, next) ? current : next))
    })
  }, [candles, fetchedAt, interval, nextVenue, symbolId])

  return source !== candles ? candles : live
}

function sameTail(left: TapeCandle[], right: TapeCandle[]): boolean {
  if (left.length !== right.length) return false
  const a = left[left.length - 1]
  const b = right[right.length - 1]
  if (!a || !b) return false
  return a.t === b.t && a.open === b.open && a.high === b.high && a.low === b.low && a.close === b.close && a.volume === b.volume
}

function syncKraken(conn: BookConn) {
  closeTape(conn)
  if (!conn.socket || (conn.socket.readyState !== WebSocket.OPEN && conn.socket.readyState !== WebSocket.CONNECTING)) {
    openKraken(conn)
  }
}

function openKraken(conn: BookConn) {
  window.clearTimeout(conn.retry)
  if (conn.socket && (conn.socket.readyState === WebSocket.OPEN || conn.socket.readyState === WebSocket.CONNECTING)) return
  const product = krakenProduct(conn.symbol)
  if (!product) {
    conn.view = { ...conn.view, status: "stale" }
    emit()
    return
  }
  const ws = new WebSocket(SOCKET_URL.perp)
  conn.socket = ws
  ws.onopen = () => {
    if (conn.socket !== ws) return
    conn.attempt = 0
    conn.accept = true
    armSilence(conn)
    for (const feed of ["book", "trade", "ticker"]) {
      ws.send(JSON.stringify({ event: "subscribe", feed, product_ids: [product] }))
    }
  }
  ws.onmessage = (event) => {
    if (conn.socket !== ws) return
    handleKraken(conn, String(event.data), product)
  }
  ws.onerror = () => ws.close()
  ws.onclose = () => {
    if (conn.socket !== ws) return
    conn.socket = null
    window.clearTimeout(conn.silence)
    conn.accept = false
    if (conn.refs <= 0) return
    if (conn.sawGood || conn.quote != null || conn.view.bids.length > 0) {
      conn.view = { ...conn.view, status: "stale", heardAt: conn.heardAt }
    }
    emit()
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(conn.attempt, 5))
    conn.attempt += 1
    conn.retry = window.setTimeout(() => {
      if (conn.refs > 0) openKraken(conn)
    }, delay)
  }
}

function handleKraken(conn: BookConn, raw: string, product: string) {
  armSilence(conn)
  conn.heardAt = Date.now()
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return
  }
  if (typeof payload.event === "string") return
  const feed = payload.feed
  if (feed === "heartbeat") return
  if (typeof payload.product_id === "string" && payload.product_id !== product) return
  if (feed === "ticker") {
    takeKrakenTicker(conn, payload)
    publish(conn)
    return
  }
  if (feed === "trade_snapshot") {
    const trades = Array.isArray(payload.trades) ? payload.trades : []
    for (const row of trades) {
      if (row && typeof row === "object") takeKrakenTrade(conn, row as Record<string, unknown>)
    }
    publish(conn)
    return
  }
  if (feed === "trade") {
    takeKrakenTrade(conn, payload)
    publish(conn)
    return
  }
  if (feed === "book_snapshot") {
    conn.bookBids = krakenLevels(payload.bids)
    conn.bookAsks = krakenLevels(payload.asks)
    conn.latest = mapsToTuples(conn.bookBids, conn.bookAsks)
    if (!conn.primed) {
      conn.primed = true
      publish(conn)
    }
    return
  }
  if (feed === "book") {
    applyKrakenDelta(conn, payload)
  }
}

function takeKrakenTicker(conn: BookConn, payload: Record<string, unknown>) {
  const last = Number(payload.last)
  const open = Number(payload.open)
  if (Number.isFinite(last) && last > 0) conn.quote = last
  if (Number.isFinite(last) && last > 0 && Number.isFinite(open) && open > 0) {
    conn.changePct = ((last - open) / open) * 100
  }
}

function takeKrakenTrade(conn: BookConn, payload: Record<string, unknown>) {
  const price = Number(payload.price)
  const size = Number(payload.qty ?? payload.size)
  let t = Number(payload.time)
  if (Number.isFinite(t) && t > 0 && t < 1e12) t *= 1000
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(size) || size <= 0 || !Number.isFinite(t)) return
  const id = payload.uid == null ? `${t}|${price}|${size}` : String(payload.uid)
  if (conn.seen.has(id)) return
  conn.seen.add(id)
  const side: FlowSide = payload.side === "sell" ? "sell" : "buy"
  conn.prints.push({ id, t, side, price, size })
  if (conn.prints.length > PRINT_MEMORY) {
    const dropped = conn.prints.splice(0, conn.prints.length - PRINT_MEMORY)
    for (const print of dropped) conn.seen.delete(print.id)
  }
}

function applyKrakenDelta(conn: BookConn, payload: Record<string, unknown>) {
  const price = Number(payload.price)
  const qty = Number(payload.qty)
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(qty) || qty < 0) return
  const book = payload.side === "sell" ? conn.bookAsks : conn.bookBids
  const key = krakenPriceKey(price)
  if (qty === 0) book.delete(key)
  else book.set(key, qty)
  conn.latest = mapsToTuples(conn.bookBids, conn.bookAsks)
  if (!conn.primed) {
    conn.primed = true
    publish(conn)
  }
}

function krakenLevels(rows: unknown): Map<string, number> {
  const map = new Map<string, number>()
  if (!Array.isArray(rows)) return map
  for (const row of rows) {
    let price = Number.NaN
    let qty = Number.NaN
    if (Array.isArray(row)) {
      price = Number(row[0])
      qty = Number(row[1])
    } else if (row && typeof row === "object") {
      const item = row as Record<string, unknown>
      price = Number(item.price)
      qty = Number(item.qty)
    }
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(qty) || qty <= 0) continue
    map.set(krakenPriceKey(price), qty)
  }
  return map
}

function mapsToTuples(bids: Map<string, number>, asks: Map<string, number>): { bids: [string, string][]; asks: [string, string][] } {
  const rows = (map: Map<string, number>, side: "bid" | "ask") =>
    [...map.entries()]
      .sort((left, right) => (side === "bid" ? Number(right[0]) - Number(left[0]) : Number(left[0]) - Number(right[0])))
      .slice(0, 20)
      .map(([price, qty]) => [price, String(qty)] as [string, string])
  return { bids: rows(bids, "bid"), asks: rows(asks, "ask") }
}

function krakenPriceKey(price: number): string {
  return price.toFixed(10).replace(/\.?0+$/, "")
}

function openSocket(conn: BookConn) {
  window.clearTimeout(conn.retry)
  if (conn.socket && (conn.socket.readyState === WebSocket.OPEN || conn.socket.readyState === WebSocket.CONNECTING)) return
  const ws = new WebSocket(SOCKET_URL[conn.venue])
  conn.socket = ws
  ws.onopen = () => {
    if (conn.socket !== ws) return
    conn.attempt = 0
    armSilence(conn)
    sendSubscribe(conn)
  }
  ws.onmessage = (event) => {
    if (conn.socket !== ws) return
    handleFrame(conn, String(event.data), "depth")
  }
  ws.onerror = () => ws.close()
  ws.onclose = () => {
    if (conn.socket !== ws) return
    conn.socket = null
    window.clearTimeout(conn.silence)
    conn.accept = false
    conn.activeParams = []
    if (conn.refs <= 0) return
    if (conn.sawGood || conn.quote != null) conn.view = { ...conn.view, status: "stale", heardAt: conn.heardAt }
    emit()
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(conn.attempt, 5))
    conn.attempt += 1
    conn.retry = window.setTimeout(() => {
      if (conn.refs > 0) openSocket(conn)
    }, delay)
  }
}

function sendSubscribe(conn: BookConn) {
  if (!conn.socket || conn.socket.readyState !== WebSocket.OPEN) return
  conn.activeParams = depthParams(conn)
  if (conn.activeParams.length === 0) return
  const idNum = ++conn.requestId
  conn.pendingSub = idNum
  conn.pendingUnsub = null
  conn.accept = false
  conn.socket.send(JSON.stringify({ method: "SUBSCRIBE", params: conn.activeParams, id: idNum }))
}

function onAck(conn: BookConn, id: number) {
  if (id === conn.pendingUnsub) {
    conn.pendingUnsub = null
    conn.activeParams = []
    sendSubscribe(conn)
    return
  }
  if (id === conn.pendingSub) {
    conn.pendingSub = null
    conn.accept = true
  }
}

function takeTicker(conn: BookConn, payload: Record<string, unknown>) {
  const price = Number(payload.c)
  const change = Number(payload.P)
  if (Number.isFinite(price) && price > 0) conn.quote = price
  if (Number.isFinite(change)) conn.changePct = change
}

function takeTrade(conn: BookConn, payload: Record<string, unknown>) {
  if (payload.s !== conn.symbol) return
  const price = Number(payload.p)
  const size = Number(payload.q)
  const t = Number(payload.T)
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(size) || size <= 0 || !Number.isFinite(t)) return
  const tradeId = payload.a ?? payload.t
  const id = tradeId == null ? `${t}|${payload.p}|${payload.q}` : String(tradeId)
  if (conn.seen.has(id)) return
  conn.seen.add(id)
  conn.prints.push({ id, t, side: takerSide(payload.m === true), price, size })
  if (conn.prints.length > PRINT_MEMORY) {
    const dropped = conn.prints.splice(0, conn.prints.length - PRINT_MEMORY)
    for (const print of dropped) conn.seen.delete(print.id)
  }
}

function armSilence(conn: BookConn) {
  window.clearTimeout(conn.silence)
  conn.silence = window.setTimeout(() => {
    conn.socket?.close()
    conn.tapeSocket?.close()
  }, SILENCE_MS)
}

function dropSocket(conn: BookConn) {
  window.clearTimeout(conn.retry)
  window.clearTimeout(conn.tapeRetry)
  window.clearTimeout(conn.silence)
  const ws = conn.socket
  const tape = conn.tapeSocket
  conn.socket = null
  conn.tapeSocket = null
  conn.accept = false
  conn.tapeAccept = false
  conn.activeParams = []
  conn.tapeActive = []
  conn.pendingSub = null
  conn.pendingUnsub = null
  conn.tapePending = null
  ws?.close()
  tape?.close()
}

function syncTape(conn: BookConn) {
  const next = tapeStreamParams(conn)
  if (next.length === 0) {
    closeTape(conn)
    return
  }
  if (!conn.tapeSocket || (conn.tapeSocket.readyState !== WebSocket.OPEN && conn.tapeSocket.readyState !== WebSocket.CONNECTING)) {
    openTape(conn)
    return
  }
  if (conn.tapeSocket.readyState !== WebSocket.OPEN) return
  if (sameParams(conn.tapeActive, next)) return
  sendTapeSubscribe(conn)
}

function openTape(conn: BookConn) {
  window.clearTimeout(conn.tapeRetry)
  if (conn.tapeSocket && (conn.tapeSocket.readyState === WebSocket.OPEN || conn.tapeSocket.readyState === WebSocket.CONNECTING)) return
  const ws = new WebSocket(PERP_TAPE_URL)
  conn.tapeSocket = ws
  ws.onopen = () => {
    if (conn.tapeSocket !== ws) return
    sendTapeSubscribe(conn)
  }
  ws.onmessage = (event) => {
    if (conn.tapeSocket !== ws) return
    handleFrame(conn, String(event.data), "tape")
  }
  ws.onerror = () => ws.close()
  ws.onclose = () => {
    if (conn.tapeSocket !== ws) return
    conn.tapeSocket = null
    conn.tapeAccept = false
    conn.tapeActive = []
    conn.tapePending = null
    if (conn.refs <= 0 || tapeStreamParams(conn).length === 0) return
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(conn.attempt, 5))
    conn.tapeRetry = window.setTimeout(() => {
      if (conn.refs > 0) openTape(conn)
    }, delay)
  }
}

function sendTapeSubscribe(conn: BookConn) {
  if (!conn.tapeSocket || conn.tapeSocket.readyState !== WebSocket.OPEN) return
  const params = tapeStreamParams(conn)
  if (params.length === 0) return
  conn.tapeActive = params
  const idNum = ++conn.requestId
  conn.tapePending = idNum
  conn.tapeAccept = false
  conn.tapeSocket.send(JSON.stringify({ method: "SUBSCRIBE", params, id: idNum }))
}

function closeTape(conn: BookConn) {
  window.clearTimeout(conn.tapeRetry)
  const ws = conn.tapeSocket
  conn.tapeSocket = null
  conn.tapeAccept = false
  conn.tapeActive = []
  conn.tapePending = null
  ws?.close()
}

function handleFrame(conn: BookConn, raw: string, kind: "depth" | "tape") {
  armSilence(conn)
  conn.heardAt = Date.now()
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return
  }
  const nested = payload.data
  if (nested && typeof nested === "object") payload = nested as Record<string, unknown>
  if (typeof payload.id === "number") {
    if (kind === "tape") {
      if (payload.id === conn.tapePending) {
        conn.tapePending = null
        conn.tapeAccept = true
      }
      return
    }
    onAck(conn, payload.id)
    return
  }
  if (kind === "tape" ? !conn.tapeAccept : !conn.accept) return
  if (typeof payload.s === "string" && payload.s !== conn.symbol) return
  if (payload.e === "24hrTicker") {
    takeTicker(conn, payload)
    publish(conn)
    return
  }
  if (payload.e === "trade" || payload.e === "aggTrade") {
    takeTrade(conn, payload)
    publish(conn)
    return
  }
  if (kind !== "depth" || conn.depthRefs <= 0) return
  const bids = Array.isArray(payload.bids) ? payload.bids : Array.isArray(payload.b) ? payload.b : null
  const asks = Array.isArray(payload.asks) ? payload.asks : Array.isArray(payload.a) ? payload.a : null
  if (bids && asks) {
    conn.latest = { bids: bids as [string, string][], asks: asks as [string, string][] }
    if (!conn.primed) {
      conn.primed = true
      publish(conn)
    }
  }
}

function republish() {
  let changed = false
  for (const conn of books.values()) {
    if (conn.refs <= 0) continue
    publish(conn, false)
    changed = true
  }
  if (changed) {
    for (const listener of listeners) listener()
  }
}

function printedLast(conn: BookConn): LiveView["last"] {
  const lastPrint = conn.prints[conn.prints.length - 1]
  if (!lastPrint) return null
  const changed = lastPrint.price !== conn.publishedPrice
  conn.publishedPrice = lastPrint.price
  return { price: lastPrint.price, side: lastPrint.side, changed }
}

function publish(conn: BookConn, notify = true) {
  const now = Date.now()
  const socketDown = conn.venue === "perp" && conn.socket?.readyState !== WebSocket.OPEN
  const quiet = conn.heardAt == null || now - conn.heardAt > STALE_MS || socketDown
  const flow = rollingFlow(conn.prints, now)
  const tape = conn.prints.slice(-TAPE_LENGTH).reverse()
  const last = printedLast(conn)
  const quoteFields = { quote: conn.quote, changePct: conn.changePct, last }
  if (!conn.latest || !conn.accept || conn.depthRefs <= 0) {
    if (conn.view.bids.length > 0 || conn.view.asks.length > 0 || conn.sawGood || conn.quote != null || last) {
      conn.view = {
        ...conn.view,
        ...quoteFields,
        status: quiet ? "stale" : conn.view.bids.length > 0 || conn.quote != null || last ? "connected" : "stale",
        heardAt: conn.heardAt,
        prints: tape,
        ...flow,
        freshIds: [],
      }
      if (quiet && (conn.sawGood || conn.view.bids.length > 0)) conn.view = { ...conn.view, status: "stale" }
    }
    if (notify) emit()
    return
  }
  const ladder = projectLadder(conn.latest.bids, conn.latest.asks, conn.sizes)
  if (ladder.crossed) {
    conn.sizes = new Map()
    conn.view = {
      ...conn.view,
      ...quoteFields,
      status: "stale",
      heardAt: conn.heardAt,
      prints: tape,
      ...flow,
      freshIds: [],
    }
    if (notify) emit()
    return
  }
  const nextSizes = new Map<string, number>()
  for (const level of ladder.bids) nextSizes.set(`bid:${level.priceKey}`, level.size)
  for (const level of ladder.asks) nextSizes.set(`ask:${level.priceKey}`, level.size)
  const freshIds = tape.filter((print) => !conn.view.prints.some((row) => row.id === print.id)).map((print) => print.id)
  conn.sizes = nextSizes
  conn.sawGood = true
  conn.view = {
    symbol: conn.symbol,
    venue: conn.venue,
    status: quiet ? "stale" : "connected",
    asOf: now,
    heardAt: conn.heardAt,
    bids: ladder.bids,
    asks: ladder.asks,
    spread: ladder.spread,
    mid: ladder.mid,
    last,
    quote: conn.quote,
    changePct: conn.changePct,
    prints: tape,
    freshIds,
    delta: flow.delta,
    buy: flow.buy,
    sell: flow.sell,
  }
  if (notify) emit()
}
