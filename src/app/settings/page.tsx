import { Suspense } from 'react'
import { SettingsPage } from '../../features/settings/SettingsPage'

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SettingsPage />
    </Suspense>
  )
}
