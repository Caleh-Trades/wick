import { playArmBeep } from "./arm-sound.ts"

/** Browser notification when Arm fires. Stand-down must already have blocked the fire. */
export async function notifyArm(input: { symbol: string; side: string; price: number }): Promise<void> {
  playArmBeep()
  if (typeof window === "undefined" || typeof Notification === "undefined") return
  try {
    let permission = Notification.permission
    if (permission === "default") permission = await Notification.requestPermission()
    if (permission !== "granted") return
    const base = input.symbol.replace(/USDT$/, "")
    const price = Number.isFinite(input.price) ? input.price : 0
    new Notification(`Wick · ${base}`, {
      body: `${input.side} ${price}`,
      tag: `wick-arm-${input.symbol}-${input.side}-${price}`,
    })
  } catch {
    // Permission or Notification constructor can fail in private contexts.
  }
}
