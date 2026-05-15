export type DateFilterOption =
  | 'today'
  | 'yesterday'
  | 'last3days'
  | 'thisWeek'
  | 'thisMonth'
  | 'thisQuarter'
  | 'last6months'
  | 'thisYear'
  | 'last1year'
  | 'allTime'

export const DATE_FILTER_OPTIONS: { value: DateFilterOption; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last3days', label: 'Last 3 Days' },
  { value: 'thisWeek', label: 'This Week' },
  { value: 'thisMonth', label: 'This Month' },
  { value: 'thisQuarter', label: 'This Quarter' },
  { value: 'last6months', label: 'Last 6 Months' },
  { value: 'thisYear', label: 'This Year' },
  { value: 'last1year', label: 'Last 1 Year' },
  { value: 'allTime', label: 'All Time' },
]

export function getDateRange(filter: DateFilterOption): { from: string | null; to: string | null } {
  if (filter === 'allTime') return { from: null, to: null }

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  if (filter === 'today') {
    return { from: today.toISOString(), to: null }
  }

  if (filter === 'yesterday') {
    const start = new Date(today)
    start.setDate(start.getDate() - 1)
    return { from: start.toISOString(), to: today.toISOString() }
  }

  if (filter === 'last3days') {
    const start = new Date(today)
    start.setDate(start.getDate() - 3)
    return { from: start.toISOString(), to: null }
  }

  if (filter === 'thisWeek') {
    const start = new Date(today)
    const day = start.getDay()
    const diff = start.getDate() - day + (day === 0 ? -6 : 1) // Monday
    start.setDate(diff)
    return { from: start.toISOString(), to: null }
  }

  if (filter === 'thisMonth') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    return { from: start.toISOString(), to: null }
  }

  if (filter === 'thisQuarter') {
    const quarter = Math.floor(now.getMonth() / 3)
    const start = new Date(now.getFullYear(), quarter * 3, 1)
    return { from: start.toISOString(), to: null }
  }

  if (filter === 'last6months') {
    const start = new Date(today)
    start.setMonth(start.getMonth() - 6)
    return { from: start.toISOString(), to: null }
  }

  if (filter === 'thisYear') {
    const start = new Date(now.getFullYear(), 0, 1)
    return { from: start.toISOString(), to: null }
  }

  if (filter === 'last1year') {
    const start = new Date(today)
    start.setFullYear(start.getFullYear() - 1)
    return { from: start.toISOString(), to: null }
  }

  return { from: null, to: null }
}
