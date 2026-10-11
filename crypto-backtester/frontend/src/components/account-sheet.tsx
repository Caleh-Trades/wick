import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import type { AccountSession } from "@/lib/account"

type AccountSheetProps = {
  session: AccountSession | null
  status: string
  onCreate: (name: string, password: string) => Promise<void>
  onSignIn: (name: string, password: string) => Promise<void>
  onSignOut: () => Promise<void>
}

export function AccountSheet({ session, status, onCreate, onSignIn, onSignOut }: AccountSheetProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      setPassword("")
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "The account didn't open.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" size="xs" variant="outline" className="max-w-40 truncate normal-case tracking-normal" aria-label="Account, local only">
          {session ? `${session.name} · local` : "Account · local"}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Account · local</SheetTitle>
          <SheetDescription>
            Local only for now. Journal rows and kept runs stay on this host. The Vercel URL and this preview do not share the same trades until a synced sign-in lands.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 px-4 pb-8">
          <p className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase" role="status">
            local-only
          </p>
          {session ? (
            <>
              <p className="text-sm leading-relaxed">
                Signed in as <span className="font-medium">{session.name}</span> on this host. Another device on the same API can use this name. Preview and production stay separate.
              </p>
              <p className="font-mono text-xs text-muted-foreground" role="status">
                {status || "On this account"}
              </p>
              <Button type="button" variant="outline" disabled={busy} onClick={() => void run(onSignOut)}>
                Sign out
              </Button>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Signing out leaves a copy on this browser and stops sending changes. The account stays on this host.
              </p>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <Label htmlFor="account-name">Name</Label>
                <Input
                  id="account-name"
                  autoComplete="username"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="account-password">Password</Label>
                <Input
                  id="account-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" disabled={busy} onClick={() => void run(() => onCreate(name, password))}>
                  Create
                </Button>
                <Button type="button" variant="outline" disabled={busy} onClick={() => void run(() => onSignIn(name, password))}>
                  Sign in
                </Button>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Create starts the account from the desk on this browser. Sign in replaces this browser with that account on the same host. The password is stored as a hash.
              </p>
            </>
          )}
          {error ? <p className="text-sm text-down">{error}</p> : null}
          {session ? null : status ? (
            <p className="font-mono text-xs text-muted-foreground" role="status">
              {status}
            </p>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}
