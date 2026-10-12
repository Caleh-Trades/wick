import { isThinSample } from "./backtest.ts"

/**
 * Chance of a 20% drawdown from win rate and per-trade risk, as a percent 0–100.
 * Equal 1R wins and losses: units = ceil(drawdown / risk), RoR = ((1-w)/w)^units.
 * Thin samples (under 10 closed trades) return null — the strip still shows the thin label.
 */
export function riskOfRuinPct(
  winRatePct: number | null | undefined,
  riskPct: number,
  closedTrades: number,
  drawdownPct = 20,
): number | null {
  if (isThinSample(closedTrades)) return null
  if (winRatePct == null || !Number.isFinite(winRatePct)) return null
  if (!(riskPct > 0) || !(drawdownPct > 0)) return null
  const win = winRatePct / 100
  if (!(win > 0) || win >= 1) return win >= 1 ? 0 : 100
  const units = Math.max(1, Math.ceil(drawdownPct / riskPct))
  const ratio = (1 - win) / win
  const chance = ratio ** units * 100
  if (!Number.isFinite(chance)) return 100
  return Math.min(100, Math.max(0, chance))
}
