import { useEffect, useRef, useState } from "react"

import {
  applyDesk,
  canonicalDesk,
  captureDesk,
  clearSession,
  createAccount,
  fetchDesk,
  loginAccount,
  logoutAccount,
  readSession,
  saveDesk,
  writeSession,
  type AccountSession,
  type DeskBlob,
} from "@/lib/account"
import { subscribeFavourites } from "@/lib/favourites"
import { watchBook } from "@/lib/records"
import type { PaneSizes } from "@/lib/panes"
import type { Workspace } from "@/lib/workspace"

type Apply = {
  setWorkspace: (workspace: Workspace) => void
  setPanes: (panes: PaneSizes) => void
}

export function useAccountSync(
  workspace: Workspace,
  panes: PaneSizes,
  setWorkspace: Apply["setWorkspace"],
  setPanes: Apply["setPanes"],
) {
  const [session, setSession] = useState<AccountSession | null>(() => readSession())
  const [status, setStatus] = useState("")
  const [tick, setTick] = useState(0)
  const ready = useRef(false)
  const held = useRef("")
  const revision = useRef(session?.revision ?? 0)
  const pushing = useRef(false)
  const token = session?.token ?? ""

  useEffect(() => {
    const bump = () => setTick((current) => current + 1)
    const stopBook = watchBook(bump)
    const stopFavourites = subscribeFavourites(bump)
    return () => {
      stopBook()
      stopFavourites()
    }
  }, [])

  useEffect(() => {
    if (!token) {
      ready.current = false
      return
    }
    let cancel = false
    ready.current = false

    async function boot() {
      try {
        const remote = await fetchDesk(token)
        if (cancel) return
        adopt(remote.account)
        const localDesk = await captureDesk()
        if (cancel) return
        const local = canonicalDesk(localDesk)
        const remoteJson = canonicalDesk(remote.desk)
        revision.current = remote.revision
        if (remote.revision > (readSession()?.revision ?? 0) && local !== remoteJson) {
          await take(remote.desk, remote.revision)
          return
        }
        if (local !== remoteJson) {
          ready.current = true
          held.current = local
          await push(token, localDesk)
          return
        }
        held.current = remoteJson
        ready.current = true
        remember(remote.revision)
        setStatus("Saved")
      } catch (reason: unknown) {
        if (cancel) return
        if (signedOut(reason)) {
          drop()
          return
        }
        ready.current = true
        setStatus(reason instanceof Error ? reason.message : "The account didn't load.")
      }
    }

    void boot()
    const timer = window.setInterval(() => {
      if (!ready.current || pushing.current) return
      void pull(token)
    }, 4000)
    return () => {
      cancel = true
      window.clearInterval(timer)
    }
    // The boot reads the token that just changed. Workspace edits go through the push effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  useEffect(() => {
    if (!token || !ready.current || pushing.current) return
    let cancel = false
    const handle = window.setTimeout(() => {
      void (async () => {
        const desk = await captureDesk()
        if (cancel || !ready.current || pushing.current) return
        const json = canonicalDesk(desk)
        if (json === held.current) return
        await push(token, desk)
      })()
    }, 600)
    return () => {
      cancel = true
      window.clearTimeout(handle)
    }
  }, [workspace, panes, tick, token])

  async function take(desk: DeskBlob, nextRevision: number) {
    const loaded = await applyDesk(desk)
    const stored = await captureDesk()
    const storedJson = canonicalDesk(stored)
    held.current = storedJson
    ready.current = true
    remember(nextRevision)
    setWorkspace(loaded.workspace)
    setPanes(loaded.panes)
    if (storedJson !== canonicalDesk(desk)) {
      await push(token, stored)
      return
    }
    setStatus("Updated from the other device.")
  }

  function adopt(account: { id: string; name: string } | null) {
    if (!account) return
    setSession((current) => {
      if (!current || (current.id === account.id && current.name === account.name)) return current
      const next = { ...current, id: account.id, name: account.name }
      writeSession(next)
      return next
    })
  }

  function remember(nextRevision: number) {
    revision.current = nextRevision
    setSession((current) => {
      if (!current) return current
      const next = { ...current, revision: nextRevision }
      writeSession(next)
      return next
    })
  }

  function drop() {
    ready.current = false
    clearSession()
    setSession(null)
    setStatus("")
  }

  async function pull(active: string) {
    try {
      const remote = await fetchDesk(active)
      if (active !== token) return
      adopt(remote.account)
      const remoteJson = canonicalDesk(remote.desk)
      if (remote.revision === revision.current && remoteJson === held.current) return
      const local = await captureDesk()
      if (active !== token) return
      if (canonicalDesk(local) !== held.current) return
      if (remoteJson === held.current) {
        remember(remote.revision)
        return
      }
      take(remote.desk, remote.revision)
    } catch (reason: unknown) {
      if (signedOut(reason)) drop()
    }
  }

  async function push(active: string, desk: DeskBlob) {
    pushing.current = true
    setStatus("Saving…")
    try {
      let result = await saveDesk(active, revision.current, desk)
      if ("conflict" in result) result = await saveDesk(active, result.revision, desk)
      if (active !== token && token) return
      if ("conflict" in result) {
        await take(result.desk, result.revision)
        return
      }
      held.current = canonicalDesk(desk)
      remember(result.revision)
      setStatus("Saved")
    } catch (reason: unknown) {
      if (signedOut(reason)) {
        drop()
        return
      }
      setStatus(reason instanceof Error ? reason.message : "The account didn't save.")
    } finally {
      pushing.current = false
    }
  }

  async function create(name: string, password: string) {
    setStatus("Creating…")
    try {
      const desk = await captureDesk()
      const next = await createAccount(name, password, desk)
      held.current = canonicalDesk(desk)
      revision.current = next.revision
      ready.current = true
      writeSession(next)
      setSession(next)
      setStatus("Saved")
    } catch (reason: unknown) {
      setStatus("")
      throw reason
    }
  }

  async function signIn(name: string, password: string) {
    setStatus("Signing in…")
    try {
      const result = await loginAccount(name, password)
      const loaded = await applyDesk(result.desk)
      revision.current = result.session.revision
      ready.current = false
      held.current = canonicalDesk(result.desk)
      writeSession(result.session)
      setSession(result.session)
      setWorkspace(loaded.workspace)
      setPanes(loaded.panes)
      setStatus("Saved")
    } catch (reason: unknown) {
      setStatus("")
      throw reason
    }
  }

  async function signOut() {
    const active = token
    drop()
    if (active) {
      try {
        await logoutAccount(active)
      } catch {
        /* this browser is already signed out */
      }
    }
  }

  return { session, status, create, signIn, signOut }
}

function signedOut(reason: unknown): boolean {
  return reason instanceof Error && reason.message === "Sign in again."
}
