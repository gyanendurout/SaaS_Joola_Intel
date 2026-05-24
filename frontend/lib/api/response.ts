import { NextResponse } from 'next/server'

export type ApiSuccess<T> = {
  data: T
  error: null
}

export type ApiError = {
  data: null
  error: string
  code?: string
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError

export function ok<T>(data: T, status = 200): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ data, error: null }, { status })
}

export function err(
  message: string,
  status = 500,
  code?: string
): NextResponse<ApiError> {
  return NextResponse.json({ data: null, error: message, code }, { status })
}

export function badRequest(message: string): NextResponse<ApiError> {
  return err(message, 400, 'BAD_REQUEST')
}

export function notFound(message = 'Not found'): NextResponse<ApiError> {
  return err(message, 404, 'NOT_FOUND')
}

export function unauthorized(message = 'Unauthorized'): NextResponse<ApiError> {
  return err(message, 401, 'UNAUTHORIZED')
}

export function methodNotAllowed(): NextResponse<ApiError> {
  return err('Method not allowed', 405, 'METHOD_NOT_ALLOWED')
}
