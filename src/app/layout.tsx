import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'RepoLight',
  description: 'See how code takes shape.',
  icons: { icon: { url: '/repolight-mark.svg', type: 'image/svg+xml' } },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
