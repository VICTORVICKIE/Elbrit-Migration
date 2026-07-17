'use client'

import type { ReactNode } from 'react'
import { ButtonLink } from '../ui/Button'
import { Card } from '../ui/Card'
import { Spinner } from '../ui/Spinner'
import { Faint, Muted } from '../ui/Text'
import { useAuth } from './useAuth'

/**
 * Authorization guard, not a login flow. Sign-in happens on netstar's /login;
 * this only gates access to an already-shared session. A hard navigation
 * (plain href, not next/link) is required because /login lives in a
 * different Multi-Zone application.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { loading, user } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Card className="w-90 p-9 text-center">
          <div className="text-lg font-semibold tracking-[0.28em]">ELBRIT</div>
          <Faint className="mb-6 block text-[11px] tracking-[0.18em]">DATA MIGRATION</Faint>
          <Muted className="block text-[12.5px]">You need to sign in first.</Muted>
          <ButtonLink render={<a href="/login" />} variant="primary" className="mt-4 w-full justify-center">
            Go to sign in
          </ButtonLink>
        </Card>
      </div>
    )
  }

  return <>{children}</>
}
