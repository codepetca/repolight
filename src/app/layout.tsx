import type { Metadata } from 'next'
import './globals.css'
import { REPOCAT_TAGLINE } from '@/lib/brand'

export const metadata: Metadata = {
  title: 'Repocat',
  description: REPOCAT_TAGLINE,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
