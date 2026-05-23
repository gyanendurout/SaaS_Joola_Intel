import type { Metadata } from 'next'
import '../v2.css'
import { V2Sidebar } from '@/components/v2/Sidebar'
import { FooterLinks } from '@/components/v2/FooterLinks'
import { BrandFilterProvider } from '@/lib/v2/BrandFilterContext'
import { BrandFilterDropdown } from '@/components/v2/BrandFilterDropdown'
import { DateRangeProvider } from '@/lib/v2/DateRangeContext'
import { DateRangePicker } from '@/components/v2/DateRangePicker'

export const metadata: Metadata = {
  title: 'JOOLA INTEL — Executive Briefing',
  description: 'Pickleball competitive intelligence — Executive design',
}

export default function V2Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="v2-root">
      <div className="app-bg" />
      <div className="dot-grid" />
      <BrandFilterProvider>
       <DateRangeProvider>
        <div className="topbar">
          <DateRangePicker />
          <BrandFilterDropdown />
        </div>
        <div className="shell">
          <V2Sidebar />
          <main className="main">
            <div className="main-inner">
              {children}
              <footer className="foot">
                <div>
                  <strong style={{ color: 'var(--fg-2)' }}>JOOLA INTEL</strong> · live · 17 tables ·
                  refreshed Mondays 7:00 AM IST
                </div>
                <FooterLinks />
              </footer>
            </div>
          </main>
        </div>
       </DateRangeProvider>
      </BrandFilterProvider>
    </div>
  )
}
