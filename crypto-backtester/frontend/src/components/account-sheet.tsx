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
        <Button
          type="button"
          size="xs"
          variant="outline"
          className="max-w-40 truncate normal-case tracking-normal"
          aria-label={session ? `Account, ${session.name}` : "Account, local only"}
        >
          {session ? session.name : "Account · local"}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{session ? session.name : "Account · local"}</SheetTitle>
          <SheetDescription>
            {session
              ? "Saved runs and journal trades are stored on this user id. Another browser that signs in with the same name loads them after a refresh."
              : "Local only until you sign in. Saved runs and journal trades stay in this browser. Create or sign in to store them on one user id."}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 px-4 pb-8">
          {session ? (
            session.id ? (
              <p className="font-mono text-[10px] tracking-wide text-muted-foreground" role="status">
                User id {session.id}
              </p>
            ) : null
          ) : (
            <p className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase" role="status">
              local-only
            </p>
          )}
          {session ? (
            <>
              <p className="text-sm leading-relaxed">
                Signed in as <span className="font-medium">{session.name}</span>. This user id is the same on every browser that uses this name. Keep this run and a logged trade write to the server. Export JSON on the desk stays a backup.
              </p>
              <p className="font-mono text-xs text-muted-foreground" role="status">
                {status || "On this account"}
              </p>
              <Button type="button" variant="outline" disabled={busy} onClick={() => void run(onSignOut)}>
                Sign out
              </Button>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Signing out leaves a copy on this browser and stops sending changes. The account stays on this server.
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
                Create stores this browser's Saved runs and journal trades on a new user id. Sign in loads that user's rows. Until then the book stays here. The password is stored as a hash.
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
