export type SpotMarket = {
  id: string
  base: string
  quote: string
  tickSize: string
  stepSize: string
  name?: string
  lastPrice?: string
}

const NAMES: Record<string, string> = {
  BTC: "Bitcoin",
  ETH: "Ethereum",
  SOL: "Solana",
  XRP: "XRP",
  DOGE: "Dogecoin",
  BNB: "BNB",
  ADA: "Cardano",
  AVAX: "Avalanche",
  LINK: "Chainlink",
  LTC: "Litecoin",
}

export const SEED_MARKETS: SpotMarket[] = [
  { id: "BTCUSDT", base: "BTC", quote: "USDT", tickSize: "0.01", stepSize: "0.00001" },
  { id: "ETHUSDT", base: "ETH", quote: "USDT", tickSize: "0.01", stepSize: "0.0001" },
  { id: "SOLUSDT", base: "SOL", quote: "USDT", tickSize: "0.01", stepSize: "0.001" },
  { id: "XRPUSDT", base: "XRP", quote: "USDT", tickSize: "0.0001", stepSize: "0.1" },
  { id: "DOGEUSDT", base: "DOGE", quote: "USDT", tickSize: "0.00001", stepSize: "1" },
]

let markets = SEED_MARKETS
const listeners = new Set<() => void>()

export function getMarkets(): SpotMarket[] {
  return markets
}

export function replaceMarkets(next: SpotMarket[]): void {
  if (next.length === 0) return
  markets = next
  for (const listener of listeners) listener()
}

export function subscribeMarkets(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function marketSpec(symbol: string): SpotMarket | undefined {
  return markets.find((market) => market.id === symbol)
}

export function marketName(base: string): string {
  return NAMES[base] ?? base
}

export function normalizeSymbol(value: string): string | null {
  const raw = value.toUpperCase().replace(/[^A-Z0-9]/g, "")
  if (!raw) return null
  if (raw.endsWith("USDT")) return raw
  if (raw.endsWith("USD")) return `${raw.slice(0, -3)}USDT`
  return null
}
