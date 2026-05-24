'use client'

import { useState, useEffect, useCallback } from 'react'

type AsyncState<T> =
  | { status: 'idle'; data: null; error: null }
  | { status: 'loading'; data: null; error: null }
  | { status: 'success'; data: T; error: null }
  | { status: 'error'; data: null; error: string }

export function useAsync<T>(
  fn: () => Promise<T>,
  deps: React.DependencyList = []
) {
  const [state, setState] = useState<AsyncState<T>>({
    status: 'idle',
    data: null,
    error: null,
  })

  const run = useCallback(async () => {
    setState({ status: 'loading', data: null, error: null })
    try {
      const data = await fn()
      setState({ status: 'success', data, error: null })
    } catch (e) {
      setState({
        status: 'error',
        data: null,
        error: e instanceof Error ? e.message : 'Unknown error',
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    run()
  }, [run])

  return { ...state, refetch: run }
}
