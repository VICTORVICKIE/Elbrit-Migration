'use client'

import { useEffect, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { auth } from '../lib/firebase'

export interface AuthState {
  loading: boolean
  user: User | null
}

// Sign-in happens on the main app's /login page (separate domain since the
// multi-zone split). Both apps share the same Firebase project and
// `authDomain`, so Firebase Auth's cross-origin session sync (via that
// authDomain's iframe) makes a session started there visible here too via
// onAuthStateChanged — no sign-in UI or duplicate auth flow needed in this app.
export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ loading: true, user: null })

  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      setState({ loading: false, user })
    })
  }, [])

  return state
}
