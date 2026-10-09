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

export function formatPrice(value: number): string {
  const abs = Math.abs(value)
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
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
  if (interval === "1m" || interval === "5m") {
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
  if (source === "coinbase") return "Coinbase spot"
  if (source === "kraken") return "Kraken spot"
  return source
}
