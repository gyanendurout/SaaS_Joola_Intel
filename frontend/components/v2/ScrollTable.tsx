import type { ReactNode } from 'react'

// Scrollable table wrapper with sticky header support.
// Wrap a <table className="data"> with this to get consistent max-height + overflow behavior.
export function ScrollTable({
  children,
  maxHeight = 520,
  className,
}: {
  children: ReactNode
  maxHeight?: number
  className?: string
}) {
  return (
    <div
      className={'table-wrap' + (className ? ' ' + className : '')}
      style={{ maxHeight, overflowY: 'auto' }}>
      {children}
    </div>
  )
}
