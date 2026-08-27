/**
 * Minimal structured logging + request correlation (no external deps). Emits one
 * JSON line per request on finish (method, path, status, ms, reqId) and exposes a
 * `log` helper for app/error events. In dev it stays readable; in prod it's JSON
 * a log shipper can parse.
 */
import { randomUUID } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { config } from '../config.js'

type Level = 'info' | 'warn' | 'error'

function emit(level: Level, msg: string, meta?: Record<string, unknown>): void {
  const rec = { ts: new Date().toISOString(), level, msg, ...meta }
  const line = config.isProd ? JSON.stringify(rec) : `[${level}] ${msg}${meta ? ' ' + JSON.stringify(meta) : ''}`
  // eslint-disable-next-line no-console
  ;(level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line)
}

export const log = {
  info: (msg: string, meta?: Record<string, unknown>) => emit('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit('error', msg, meta),
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id?: string
    }
  }
}

/** Assign a request id (honour an inbound X-Request-Id) and log each completed request. */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const id = (req.headers['x-request-id'] as string) || randomUUID()
  req.id = id
  res.setHeader('X-Request-Id', id)
  if (config.nodeEnv === 'test') return next() // quiet test output (id header still set)
  const start = process.hrtime.bigint()
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6
    const meta = { reqId: id, method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode, ms: Math.round(ms), userId: req.auth?.user.id }
    if (res.statusCode >= 500) log.error('request', meta)
    else if (res.statusCode >= 400) log.warn('request', meta)
    else log.info('request', meta)
  })
  next()
}
