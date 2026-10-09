export function formatPct(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return "—"
  const sign = value > 0 ? "+" : ""
  return `${sign}${value.toFixed(digits)}%`
}

export function formatPlainPct(value: number | null | undefined, digits = 0): string {
  if (value == null || Number.isNaN(value)) return "—"
  return `${value.toFixed(digits)}%`
}

export function formatMoney(value: number, digits = 0): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function formatCompactMoney(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}m`
  if (abs >= 10_000) return `$${(value / 1_000).toFixed(1)}k`
  return formatMoney(value, abs >= 1000 ? 0 : 2)
}

export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return "—"
  const sign = value < 0 ? "-" : ""
  const abs = Math.abs(value)
  const body =
    abs >= 1_000_000_000
      ? `${(abs / 1_000_000_000).toFixed(2)}B`
      : abs >= 1_000_000
        ? `${(abs / 1_000_000).toFixed(2)}M`
        : abs >= 1_000
          ? `${(abs / 1_000).toFixed(2)}K`
          : abs >= 1
            ? abs.toFixed(2)
            : abs === 0
              ? "0"
              : abs.toFixed(4)
  return `${sign}${body}`
}

/** Ladder size and cumulative size. Keeps a 0.001 step visible once the total is above 1. */
export function formatBookSize(value: number): string {
  if (!Number.isFinite(value)) return "—"
  const abs = Math.abs(value)
  const sign = value < 0 ? "-" : ""
  if (abs === 0) return "0"
  if (abs >= 1000) return formatCompact(value)
  if (abs >= 100) return `${sign}${abs.toFixed(1)}`
  if (abs >= 10) return `${sign}${abs.toFixed(2)}`
  if (abs >= 1) return `${sign}${abs.toFixed(3)}`
  return `${sign}${abs.toFixed(4)}`
}

export function formatSize(value: number): string {
  if (!Number.isFinite(value)) return "—"
  const abs = Math.abs(value)
  if (abs === 0) return "0"
  if (abs >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 })
  if (abs >= 1) return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })
  const digits = Math.min(8, Math.max(4, Math.ceil(-Math.log10(abs)) + 2))
  return value.toFixed(digits)
}

export function formatPrice(value: number, tick?: string): string {
  const digits = tick ? tickDecimals(tick) : priceDigits(value)
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function tickDecimals(step: string): number {
  const text = step.trim()
  const dot = text.indexOf(".")
  if (dot < 0) return 0
  return text.slice(dot + 1).replace(/0+$/, "").length
}

function priceDigits(value: number): number {
  const abs = Math.abs(value)
  if (abs >= 1) return 2
  if (abs >= 0.01) return 4
  if (abs === 0) return 2
  return Math.min(10, Math.max(8, Math.ceil(-Math.log10(abs)) + 2))
}

export function formatStat(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "—"
  return value.toFixed(digits)
}

export function formatFactor(
  value: number | null,
  trades: number,
  winRate: number | null,
): string {
  if (value == null) {
    if (trades > 0 && winRate != null && winRate >= 99.5) return "∞"
    return "—"
  }
  return value.toFixed(2)
}

export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
}

export function formatStamp(iso: string, interval: string): string {
  const date = new Date(iso)
  if (interval === "1d") return formatDay(iso)
  return date.toLocaleString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    hourCycle: "h23",
  })
}

export function formatAxis(iso: string, interval: string): string {
  const date = new Date(iso)
  if (interval === "1d") {
    return date.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" })
  }
  if (interval === "1m" || interval === "3m" || interval === "5m") {
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
      hourCycle: "h23",
    })
  }
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
}

export function formatClock(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "UTC",
    hourCycle: "h23",
  })
}

export function tone(value: number | null | undefined): "up" | "down" | "ink" {
  if (value == null || Math.abs(value) < 0.05) return "ink"
  return value > 0 ? "up" : "down"
}

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

export function daysAgoUtc(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

export function sourceLabel(source: string): string {
  if (source === "binance-perp") return "Binance perp"
  if (source === "kraken-perp") return "Kraken perp"
  if (source === "binance") return "Binance spot"
  if (source === "coinbase") return "Coinbase spot"
  if (source === "kraken") return "Kraken spot"
  return source
}
