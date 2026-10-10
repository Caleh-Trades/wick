import { replaceFavourites } from "@/lib/favourites"
import { replaceJournal, replaceKept, replaceWorking } from "@/lib/journal"
import { loadPanes, type PaneSizes } from "@/lib/panes"
import { loadWorkspace, type Workspace } from "@/lib/workspace"

const SESSION_KEY = "wick-account"
const WORKSPACE_KEY = "wick-runs"
const JOURNAL_KEY = "wick-journal"
const KEPT_KEY = "wick-kept"
const WORKING_KEY = "wick-working"
const FAVOURITES_KEY = "wick-favourites"
const PANES_KEY = "wick-panes"

const base = (import.meta.env.VITE_API_URL as string | undefined) ?? ""

export type AccountSession = {
  token: string
  name: string
  revision: number
}

export type DeskBlob = {
  workspace: unknown
  journal: unknown
  kept: unknown
  working: unknown
  favourites: unknown
  panes: unknown
}

export type DeskConflict = {
  conflict: true
  revision: number
  desk: DeskBlob
}

export function readSession(): AccountSession | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "") as Partial<AccountSession>
    if (!parsed || typeof parsed.token !== "string" || typeof parsed.name !== "string") return null
    const revision = Number(parsed.revision)
    return { token: parsed.token, name: parsed.name, revision: Number.isFinite(revision) ? revision : 0 }
  } catch {
    return null
  }
}

export function writeSession(session: AccountSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY)
}

export function captureDesk(): DeskBlob {
  return {
    workspace: readStored(WORKSPACE_KEY),
    journal: readStored(JOURNAL_KEY) ?? [],
    kept: readStored(KEPT_KEY) ?? [],
    working: readStored(WORKING_KEY) ?? [],
    favourites: readStored(FAVOURITES_KEY) ?? [],
    panes: readStored(PANES_KEY),
  }
}

export function applyDesk(desk: DeskBlob): { workspace: Workspace; panes: PaneSizes } {
  const workspace = outboundWorkspace(desk.workspace)
  if (workspace) localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspace))
  replaceJournal(desk.journal)
  replaceKept(desk.kept)
  replaceWorking(desk.working)
  replaceFavourites(desk.favourites)
  if (desk.panes && typeof desk.panes === "object") localStorage.setItem(PANES_KEY, JSON.stringify(desk.panes))
  return { workspace: loadWorkspace(), panes: loadPanes() }
}

export function canonicalDesk(desk: DeskBlob): string {
  return JSON.stringify(sortValue(forWire(desk)))
}

export function forWire(desk: DeskBlob): DeskBlob {
  return { ...desk, workspace: outboundWorkspace(desk.workspace) }
}

export async function createAccount(name: string, password: string, desk: DeskBlob): Promise<AccountSession> {
  const body = await request<{ token: string; account: { name: string }; revision: number }>("/api/accounts", {
    method: "POST",
    body: JSON.stringify({ name, password, desk: forWire(desk) }),
  })
  return { token: body.token, name: body.account.name, revision: body.revision }
}

export async function loginAccount(name: string, password: string): Promise<{ session: AccountSession; desk: DeskBlob }> {
  const body = await request<{ token: string; account: { name: string }; revision: number; desk: DeskBlob }>("/api/accounts/login", {
    method: "POST",
    body: JSON.stringify({ name, password }),
  })
  return {
    session: { token: body.token, name: body.account.name, revision: body.revision },
    desk: body.desk,
  }
}

export async function fetchDesk(token: string): Promise<{ revision: number; desk: DeskBlob }> {
  return request("/api/accounts/desk", { headers: auth(token) })
}

export async function saveDesk(
  token: string,
  revision: number,
  desk: DeskBlob,
): Promise<{ revision: number } | DeskConflict> {
  const response = await fetch(`${base}/api/accounts/desk`, {
    method: "PUT",
    headers: { Accept: "application/json", "Content-Type": "application/json", ...auth(token) },
    body: JSON.stringify({ revision, desk: forWire(desk) }),
  })
  const body = (await response.json().catch(() => null)) as { detail?: unknown; revision?: number; desk?: DeskBlob } | null
  if (response.status === 409 && body && typeof body.revision === "number" && body.desk) {
    return { conflict: true, revision: body.revision, desk: body.desk }
  }
  if (!response.ok) {
    throw new Error(detailOf(body, "The account didn't save."))
  }
  return { revision: typeof body?.revision === "number" ? body.revision : revision }
}

export async function logoutAccount(token: string): Promise<void> {
  await request("/api/accounts/session", { method: "DELETE", headers: auth(token) })
}

function outboundWorkspace(workspace: unknown): unknown {
  if (!workspace || typeof workspace !== "object" || Array.isArray(workspace)) return workspace ?? null
  return { ...(workspace as Record<string, unknown>), enlarged: false }
}

function readStored(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as unknown) : null
  } catch {
    return null
  }
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(source).sort()) out[key] = sortValue(source[key])
    return out
  }
  return value
}

function auth(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      headers: { Accept: "application/json", "Content-Type": "application/json", ...(init?.headers ?? {}) },
    })
  } catch {
    throw new Error("The desk can't reach the backtester. Start it with uvicorn on port 8000, then try the account again.")
  }
  const body = (await response.json().catch(() => null)) as { detail?: unknown } | null
  if (!response.ok) throw new Error(detailOf(body, "The account didn't open."))
  return body as T
}

function detailOf(body: { detail?: unknown } | null, fallback: string): string {
  return body && typeof body.detail === "string" ? body.detail : fallback
}
