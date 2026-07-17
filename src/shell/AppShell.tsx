'use client'

import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { RequireAuth } from '../auth/RequireAuth'
import { useAuth } from '../auth/useAuth'
import { applyPrefs } from '../data/applyPrefs'
import { useAppStore } from '../data/appStore'
import { Spinner } from '../ui/Spinner'
import { Sidebar } from './Sidebar'

function Loaded({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const loaded = useAppStore((s) => s.loaded)
  const loadAll = useAppStore((s) => s.loadAll)
  const prefs = useAppStore((s) => s.prefs)

  useEffect(() => {
    if (user && !loaded) void loadAll(user.uid)
  }, [user, loaded, loadAll])

  useEffect(() => applyPrefs(prefs), [prefs])

  if (!loaded) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="min-w-0 flex-1 px-8 pt-7 pb-15 max-[640px]:px-4 max-[640px]:pb-10 max-[860px]:pt-17">
        {children}
      </main>
    </div>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <Loaded>{children}</Loaded>
    </RequireAuth>
  )
}
