const KEY = "wick-arm-sound"

/** Settings toggle. Default off. */
export function armSoundOn(): boolean {
  if (typeof localStorage === "undefined") return false
  try {
    return localStorage.getItem(KEY) === "1"
  } catch {
    return false
  }
}

export function setArmSoundOn(on: boolean): void {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(KEY, on ? "1" : "0")
  } catch {
    /* private mode */
  }
}

/** Short beep when Arm fires. Stand-down must already have blocked the fire. */
export function playArmBeep(): void {
  if (!armSoundOn() || typeof window === "undefined") return
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = "square"
    osc.frequency.value = 880
    gain.gain.value = 0.05
    osc.connect(gain)
    gain.connect(ctx.destination)
    const start = ctx.currentTime
    osc.start(start)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.12)
    osc.stop(start + 0.14)
    window.setTimeout(() => void ctx.close(), 200)
  } catch {
    /* AudioContext can fail without a gesture or in restricted contexts. */
  }
}
