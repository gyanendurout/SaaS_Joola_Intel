'use client'

import { useRouter } from 'next/navigation'

// ← Back navigation button — used on all brand/player detail pages.
export function BackButton({ label = '← Back' }: { label?: string }) {
  const router = useRouter()
  return (
    <button
      onClick={() => router.back()}
      style={{
        background: 'var(--wb-6)',
        border: '1px solid var(--wb-12)',
        borderRadius: 8,
        padding: '6px 14px',
        color: 'var(--fg-3)',
        fontSize: 12,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
      }}>
      {label}
    </button>
  )
}
