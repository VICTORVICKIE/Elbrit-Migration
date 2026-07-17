import { Suspense } from 'react'
import { MappingsPage } from '../../features/mappings/MappingsPage'

export default function Page() {
  return (
    <Suspense fallback={null}>
      <MappingsPage />
    </Suspense>
  )
}
