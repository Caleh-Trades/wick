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
import { watchJournal, watchKept } from "@/lib/journal"
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
    const stopJournal = watchJournal(bump)
    const stopKept = watchKept(bump)
    const stopFavourites = subscribeFavourites(bump)
    return () => {
      stopJournal()
      stopKept()
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
        const local = canonicalDesk(captureDesk())
        const remoteJson = canonicalDesk(remote.desk)
        revision.current = remote.revision
        if (remote.revision > (readSession()?.revision ?? 0) && local !== remoteJson) {
          take(remote.desk, remote.revision)
          return
        }
        if (local !== remoteJson) {
          ready.current = true
          held.current = local
          await push(token, captureDesk())
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
    const desk = captureDesk()
    const json = canonicalDesk(desk)
    if (json === held.current) return
    const handle = window.setTimeout(() => {
      void push(token, desk)
    }, 600)
    return () => window.clearTimeout(handle)
  }, [workspace, panes, tick, token])

  function take(desk: DeskBlob, nextRevision: number) {
    const loaded = applyDesk(desk)
    held.current = canonicalDesk(desk)
    ready.current = true
    remember(nextRevision)
    setWorkspace(loaded.workspace)
    setPanes(loaded.panes)
    setStatus("Updated from the other device.")
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
      const remoteJson = canonicalDesk(remote.desk)
      if (remote.revision === revision.current && remoteJson === held.current) return
      if (canonicalDesk(captureDesk()) !== held.current) return
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
        take(result.desk, result.revision)
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
      const desk = captureDesk()
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
      const loaded = applyDesk(result.desk)
      held.current = canonicalDesk(result.desk)
      revision.current = result.session.revision
      ready.current = true
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
