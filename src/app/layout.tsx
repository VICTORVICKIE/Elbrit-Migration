import type { Metadata } from 'next'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '../styles/tokens.css'
import { AppShell } from '../shell/AppShell'
import { ProxyGuard } from '../shell/ProxyGuard'

export const metadata: Metadata = {
  title: 'Elbrit Data Migration',
  description: 'Ecubix → ERPNext migration workspace',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <ProxyGuard>
          <AppShell>{children}</AppShell>
        </ProxyGuard>
      </body>
    </html>
  )
}
