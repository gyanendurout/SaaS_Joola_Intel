export class ApiRouteError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message)
    this.name = 'ApiRouteError'
  }
}

export function isApiRouteError(e: unknown): e is ApiRouteError {
  return e instanceof ApiRouteError
}

export function toErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  return 'An unexpected error occurred'
}
