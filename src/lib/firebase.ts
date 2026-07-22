import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'
// Lite SDK: this app only ever does one-shot getDoc/getDocs/setDoc/deleteDoc/
// writeBatch reads+writes, never onSnapshot — the full SDK's Watch/Listen
// gRPC-Web channel (visible in devtools as repeated "channel?...RID=..."
// long-poll requests) is real-time-listener machinery this app doesn't need,
// and every one-shot call still gets routed through that shared channel by
// the full SDK. Lite issues plain REST calls instead, with no persistent
// channel at all.
import { getFirestore, type Firestore } from 'firebase/firestore/lite'

// Same Firebase project as netstar (elbrit-sso), shared so login/session and
// Firestore data are one logical system across both zones.
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

const app: FirebaseApp = getApps()[0] ?? initializeApp(firebaseConfig)

export const auth: Auth = getAuth(app)
export const db: Firestore = getFirestore(app, process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID || 'elbrit')
