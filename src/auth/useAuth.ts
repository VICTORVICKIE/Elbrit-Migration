'use client'

import { useEffect, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { auth } from '../lib/firebase'

export interface AuthState {
  loading: boolean
  user: User | null
}

// Sign-in happens on netstar's own /login page. Because this app is served
// from the same origin (Multi-Zones) and the same Firebase project, a
// session started there is already visible here via onAuthStateChanged —
// no sign-in UI or duplicate auth flow needed in this zone.
export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ loading: true, user: null })

  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      setState({ loading: false, user })
    })
  }, [])

  return state
}
