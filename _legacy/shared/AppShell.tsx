'use client'

import { usePathname } from 'next/navigation'
import { Sidebar } from '@/components/v1/Sidebar'
import { DesignToggle } from '@/components/shared/DesignToggle'

/**
 * Wraps page children with either the v1 chrome (sidebar + ambient bg)
 * or nothing (v2 routes use their own layout). The DesignToggle is
 * mounted on both branches so users can flip back to v1 from inside v2.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '/'
  const isV2 = pathname === '/v2' || pathname.startsWith('/v2/')

  if (isV2) {
    // v2 layout (app/v2/layout.tsx) renders its own chrome + DesignToggle
    return <>{children}</>
  }

  return (
    <>
      <div className="orb orb-green" />
      <div className="orb orb-indigo" />
      <div className="bg-dot-grid fixed inset-0 pointer-events-none z-0" />
      <Sidebar />
      <main
        className="relative z-10 flex-1 min-h-screen"
        style={{ marginLeft: '228px', padding: '40px 36px' }}
      >
        {children}
      </main>
      <DesignToggle />
    </>
  )
}
