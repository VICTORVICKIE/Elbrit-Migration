'use client'

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Spinner } from '../ui/Spinner'

const MAIN_APP_URL = process.env.NEXT_PUBLIC_MAIN_APP_URL || 'https://elbrit-play.netlify.app'

/**
 * This app's Firebase Auth session only exists on the main app's origin
 * (elbrit-play.netlify.app) — direct visits to this app's own domain never
 * see that session, no matter what redirects run afterward, because browser
 * storage is origin-scoped. The supported entry point is the main app's
 * `/migration` Multi-Zone rewrite, which proxies here while keeping the
 * browser on the main app's origin. Bounce anyone who lands here directly
 * (any host but the main app's, skipping localhost so local dev is untouched).
 */
export function ProxyGuard({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const mainHost = new URL(MAIN_APP_URL).hostname
    const { hostname, pathname, search } = window.location

    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === mainHost) {
      setReady(true)
      return
    }

    const path = pathname.startsWith('/migration') ? pathname.slice('/migration'.length) : pathname
    window.location.replace(`${MAIN_APP_URL}/migration${path}${search}`)
  }, [])

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    )
  }

  return <>{children}</>
}
