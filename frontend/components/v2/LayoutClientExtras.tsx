'use client'

import { CmdKPalette } from '@/components/v2/CmdKPalette'
import { useKeyboardNav } from '@/hooks/useKeyboardNav'

export function LayoutClientExtras() {
  useKeyboardNav()
  return <CmdKPalette />
}
