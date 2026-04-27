import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Repocat',
  description: 'Repository contribution analysis for fair contributor assessment.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
