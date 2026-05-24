import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'JOOLA Intel — Pickleball Competitor Intelligence',
  description: 'Real-time competitor intelligence for JOOLA pickleball',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#0a0d12' }}>
        {children}
      </body>
    </html>
  )
}
