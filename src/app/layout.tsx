import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'RepoLight',
  description: 'Code, revealed.',
  icons: {
    icon: [
      { url: '/repolight-icon-32.png', type: 'image/png', sizes: '32x32' },
      { url: '/repolight-icon-16.png', type: 'image/png', sizes: '16x16' },
    ],
    apple: { url: '/repolight-apple-icon.png', sizes: '180x180' },
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
