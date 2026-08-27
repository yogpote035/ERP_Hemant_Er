import type { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'
import { log } from './logging.js'

/** A thrown error carrying an HTTP status; the error middleware renders it as JSON. */
export class ApiError extends Error {
  constructor(public status: number, message: string, public detail?: unknown) {
    super(message)
    this.name = 'ApiError'
  }
}

export const badRequest = (msg: string, detail?: unknown) => new ApiError(400, msg, detail)
export const unauthorized = (msg = 'Unauthorized') => new ApiError(401, msg)
export const forbidden = (msg = 'Forbidden') => new ApiError(403, msg)
export const notFound = (msg = 'Not found') => new ApiError(404, msg)
export const conflict = (msg: string) => new ApiError(409, msg)

/** Wrap an async handler so rejected promises reach the error middleware. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next)
  }
}

/** Central error renderer — always returns `{ error, detail? }`. */
export function errorMiddleware(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Validation failed', detail: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`) })
    return
  }
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: err.message, detail: err.detail })
    return
  }
  // JWT errors
  if (err instanceof Error && (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError')) {
    res.status(401).json({ error: 'Invalid or expired token' })
    return
  }
  // Unexpected: log with correlation + stack, return a generic message (don't leak internals).
  log.error('unhandled error', {
    reqId: req.id,
    path: req.originalUrl,
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  })
  res.status(500).json({ error: 'Internal server error', reqId: req.id })
}
