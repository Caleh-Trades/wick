import { useEffect, useState } from "react"

import { applyFeed, createBook, parseCoinbase, projectBook, type Level, type Print } from "@/lib/book"

const SOCKET_URL = "wss://advanced-trade-ws.coinbase.com"
const BOOK_PRODUCTS = new Set(["BTC-USD", "ETH-USD"])
const REPAINT_MS = 1000
const SILENCE_MS = 20_000

export type BookStatus = "connecting" | "live" | "stale" | "unsupported"

export type BookSnapshot = {
  status: BookStatus
  asOf: number | null
  bids: Level[]
  asks: Level[]
  spread: number | null
  mid: number | null
  prints: Print[]
  delta: number
}

const EMPTY: BookSnapshot = {
  status: "connecting",
  asOf: null,
  bids: [],
  asks: [],
  spread: null,
  mid: null,
  prints: [],
  delta: 0,
}

export function useBook(symbol: string | null): BookSnapshot {
  const [snapshot, setSnapshot] = useState<BookSnapshot>(EMPTY)

  useEffect(() => {
    if (!symbol || !BOOK_PRODUCTS.has(symbol)) {
      setSnapshot({ ...EMPTY, status: "unsupported" })
      return
    }

    const book = createBook()
    let socket: WebSocket | null = null
    let stopped = false
    let attempt = 0
    let retry = 0
    let silence = 0
    let status: BookStatus = "connecting"
    let asOf: number | null = null
    let sawBook = false

    const paint = () => {
      const view = projectBook(book, Date.now())
      const hold = !book.ready && sawBook
      setSnapshot((current) => ({
        status,
        asOf: hold || book.ready ? asOf : null,
        bids: hold ? current.bids : view.bids,
        asks: hold ? current.asks : view.asks,
        spread: hold ? current.spread : view.spread,
        mid: hold ? current.mid : view.mid,
        prints: hold ? current.prints : view.prints,
        delta: hold ? current.delta : view.delta,
      }))
    }

    const armSilence = () => {
      window.clearTimeout(silence)
      silence = window.setTimeout(() => {
        socket?.close()
      }, SILENCE_MS)
    }

    const connect = () => {
      if (stopped) return
      status = sawBook ? "stale" : "connecting"
      book.ready = false
      paint()
      const ws = new WebSocket(SOCKET_URL)
      socket = ws
      ws.onopen = () => {
        if (stopped || socket !== ws) return
        attempt = 0
        armSilence()
        ws.send(JSON.stringify({ type: "subscribe", product_ids: [symbol], channel: "level2" }))
        ws.send(JSON.stringify({ type: "subscribe", product_ids: [symbol], channel: "market_trades" }))
        ws.send(JSON.stringify({ type: "subscribe", product_ids: [symbol], channel: "heartbeats" }))
      }
      ws.onmessage = (event) => {
        if (stopped || socket !== ws) return
        armSilence()
        let payload: unknown
        try {
          payload = JSON.parse(String(event.data))
        } catch {
          return
        }
        const messages = parseCoinbase(payload)
        if (messages.length === 0) return
        let snap = false
        for (const message of messages) {
          applyFeed(book, message)
          if (message.kind === "snapshot") snap = true
        }
        asOf = Date.now()
        if (snap) {
          sawBook = true
          status = "live"
          paint()
        }
      }
      ws.onerror = () => {
        ws.close()
      }
      ws.onclose = () => {
        if (stopped || socket !== ws) return
        window.clearTimeout(silence)
        status = sawBook ? "stale" : "connecting"
        book.ready = false
        paint()
        const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5))
        attempt += 1
        retry = window.setTimeout(connect, delay)
      }
    }

    connect()
    const repaint = window.setInterval(() => paint(), REPAINT_MS)
    return () => {
      stopped = true
      window.clearInterval(repaint)
      window.clearTimeout(retry)
      window.clearTimeout(silence)
      socket?.close()
    }
  }, [symbol])

  return snapshot
}

export function depthScale(levels: Level[]): number {
  let max = 0
  for (const level of levels) max = Math.max(max, level.size)
  return max
}
