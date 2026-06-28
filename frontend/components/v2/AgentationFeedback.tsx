'use client'

import { Agentation } from 'agentation'

export function AgentationFeedback() {
  if (process.env.NODE_ENV !== 'development') return null
  return <Agentation />
}
