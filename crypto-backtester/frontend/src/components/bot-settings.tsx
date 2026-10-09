import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { createBotKey, listBotKeys, revokeBotKey, type BotKey } from "@/lib/bot-api"

export function BotSettings() {
  const [open, setOpen] = useState(false)
  const [keys, setKeys] = useState<BotKey[]>([])
  const [name, setName] = useState("Research bot")
  const [secret, setSecret] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const origin = typeof window === "undefined" ? "http://127.0.0.1:43123" : window.location.origin

  useEffect(() => {
    if (!open) return
    let cancel = false
    listBotKeys()
      .then((next) => {
        if (!cancel) setKeys(next)
      })
      .catch((reason: unknown) => {
        if (!cancel) setError(reason instanceof Error ? reason.message : "The key list didn't load.")
      })
    return () => {
      cancel = true
    }
  }, [open])

  async function create() {
    setBusy(true)
    setError(null)
    try {
      const created = await createBotKey(name)
      setSecret(created.secret)
      setKeys(await listBotKeys())
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "The key wasn't created.")
    } finally {
      setBusy(false)
    }
  }

  async function revoke(id: string) {
    setError(null)
    try {
      await revokeBotKey(id)
      setKeys((current) => current.filter((item) => item.id !== id))
      setSecret(null)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "That key is still active.")
    }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      setError("Select the key and copy it yourself.")
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" size="xs" variant="outline" className="normal-case tracking-normal">
          Settings
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Bot keys</SheetTitle>
          <SheetDescription>
            A key lets a Grok bot change this desk: the market, the rule, combined strategies, and risk. It does not rewrite the app. Copy the key when you create it. Wick keeps only a hash.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 px-4 pb-8">
          <div className="flex flex-col gap-2">
            <Label htmlFor="bot-key-name">Key name</Label>
            <Input id="bot-key-name" value={name} maxLength={40} onChange={(event) => setName(event.target.value)} />
            <Button type="button" disabled={busy || name.trim() === ""} onClick={() => void create()}>
              {busy ? "Creating" : "Create key"}
            </Button>
          </div>
          {secret ? (
            <div className="flex flex-col gap-2 border border-border p-3">
              <p className="text-sm">Copy this key now. It will not be shown again.</p>
              <Input readOnly value={secret} aria-label="New bot key" onFocus={(event) => event.currentTarget.select()} />
              <Button type="button" variant="outline" onClick={() => void copy(secret)}>
                Copy key
              </Button>
            </div>
          ) : null}
          {error ? <p className="text-sm text-down">{error}</p> : null}
          <ul className="flex flex-col gap-3">
            {keys.length === 0 ? <li className="text-sm text-muted-foreground">No keys yet.</li> : null}
            {keys.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-3 border-t border-border pt-3">
                <div>
                  <p className="text-sm">{item.name}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {item.prefix}…
                    {item.last_used ? ` · used ${item.last_used}` : " · not used yet"}
                  </p>
                </div>
                <Button type="button" variant="ghost" size="xs" aria-label={`Revoke ${item.name}`} onClick={() => void revoke(item.id)}>
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">What a bot sends</p>
            <pre className="overflow-x-auto border border-border p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">{`curl -X POST ${origin}/api/bot/edit \\
  -H "Authorization: Bearer wick_…" \\
  -H "Content-Type: application/json" \\
  -d '{"ops":[{"op":"patch-run","riskPct":25}]}'`}</pre>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Other edits are set-slot, focus, pin, unpin, select-run, add-run, remove-run, and log-trade. log-trade writes a round trip on the journal page: symbol, side, price, size, and an optional exit, strategy, and note. Name the slot with its symbol and the run with its name. Leave both off to change the run that is selected now. Keep this desk on your machine. Anyone who can open it can mint a key.
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
