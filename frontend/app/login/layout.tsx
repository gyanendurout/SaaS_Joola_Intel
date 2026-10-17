import type { Metadata } from 'next'
import '../v2.css'

export const metadata: Metadata = {
  title: 'Sign in — JOOLA INTEL',
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="v2-root">
      <div className="app-bg" />
      <div className="dot-grid" />
      {children}
    </div>
  )
}
