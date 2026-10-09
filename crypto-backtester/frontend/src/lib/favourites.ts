import { useSyncExternalStore } from "react"

const KEY = "wick-favourites"

let ids = read()
const listeners = new Set<() => void>()

export function getFavourites(): string[] {
  return ids
}

export function toggleFavourite(symbol: string): void {
  const id = symbol.toUpperCase()
  ids = ids.includes(id) ? ids.filter((item) => item !== id) : [id, ...ids]
  write(ids)
  for (const listener of listeners) listener()
}

export function subscribeFavourites(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useFavourites(): string[] {
  return useSyncExternalStore(subscribeFavourites, getFavourites, getFavourites)
}

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === "string")
  } catch {
    return []
  }
}

function write(next: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* the list still works for this visit */
  }
}
