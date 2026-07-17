'use client'

import type { ReactNode } from 'react'
import { ButtonLink } from '../ui/Button'
import { Card } from '../ui/Card'
import { Spinner } from '../ui/Spinner'
import { Faint, Muted } from '../ui/Text'
import { useAuth } from './useAuth'

const MAIN_APP_URL = process.env.NEXT_PUBLIC_MAIN_APP_URL || 'https://elbrit-play.netlify.app'

/**
 * Authorization guard, not a login flow. Sign-in happens on the main app's
 * /login (a separate deployment on its own domain since the multi-zone split).
 * Firebase Auth shares session state across both origins via the shared
 * `authDomain` (same Firebase project), so signing in there and bouncing back
 * here — via the `redirect` param the main app's /login honors — picks up the
 * session without a duplicate auth flow in this app.
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
    const loginUrl = `${MAIN_APP_URL}/login?redirect=${encodeURIComponent(window.location.href)}`
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Card className="w-90 p-9 text-center">
          <div className="text-lg font-semibold tracking-[0.28em]">ELBRIT</div>
          <Faint className="mb-6 block text-[11px] tracking-[0.18em]">DATA MIGRATION</Faint>
          <Muted className="block text-[12.5px]">You need to sign in first.</Muted>
          <ButtonLink render={<a href={loginUrl} />} variant="primary" className="mt-4 w-full justify-center">
            Go to sign in
          </ButtonLink>
        </Card>
      </div>
    )
  }

  return <>{children}</>
}
