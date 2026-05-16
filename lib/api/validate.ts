import { NextRequest } from 'next/server'
import { ApiRouteError } from './errors'

export function requireMethod(
  req: NextRequest,
  ...methods: string[]
): void {
  if (!methods.includes(req.method)) {
    throw new ApiRouteError(
      `Method ${req.method} not allowed. Expected: ${methods.join(', ')}`,
      405,
      'METHOD_NOT_ALLOWED'
    )
  }
}

export function requireEnv(key: string): string {
  const val = process.env[key]
  if (!val) {
    throw new ApiRouteError(`Missing required env var: ${key}`, 500, 'CONFIG_ERROR')
  }
  return val
}

export async function parseJsonBody<T = Record<string, unknown>>(
  req: NextRequest
): Promise<T> {
  try {
    return (await req.json()) as T
  } catch {
    throw new ApiRouteError('Invalid JSON body', 400, 'BAD_REQUEST')
  }
}
