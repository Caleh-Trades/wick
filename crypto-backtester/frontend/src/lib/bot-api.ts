import type { BotOp } from "./bot-edits.ts"

export type BotKey = {
  id: string
  name: string
  prefix: string
  created: string
  last_used: string | null
}

export type BotEdit = {
  id: string
  at: string
  ops: BotOp[]
}

const base = (import.meta.env.VITE_API_URL as string | undefined) ?? ""

export async function listBotKeys(): Promise<BotKey[]> {
  const body = await request<{ keys: BotKey[] }>("/api/bot/keys")
  return Array.isArray(body.keys) ? body.keys : []
}

export async function createBotKey(name: string): Promise<BotKey & { secret: string }> {
  return request("/api/bot/keys", { method: "POST", body: JSON.stringify({ name }) })
}

export async function revokeBotKey(id: string): Promise<void> {
  await request(`/api/bot/keys/${id}`, { method: "DELETE" })
}

export async function fetchBotInbox(): Promise<BotEdit[]> {
  const body = await request<{ edits: BotEdit[] }>("/api/bot/inbox")
  return Array.isArray(body.edits) ? body.edits : []
}

export async function ackBotEdits(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await request("/api/bot/inbox/ack", { method: "POST", body: JSON.stringify({ ids }) })
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  })
  const body = (await response.json().catch(() => null)) as { detail?: string } | null
  if (!response.ok) {
    const detail = body && typeof body.detail === "string" ? body.detail : `The desk returned ${response.status}.`
    throw new Error(detail)
  }
  return body as T
}
