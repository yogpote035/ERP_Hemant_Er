import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from './config.js'
import { errorMiddleware } from './lib/http.js'
import { requestLogger } from './lib/logging.js'
import { ping, getVersion } from './db/repository.js'
import { authRouter } from './modules/auth/auth.routes.js'
import { mastersRouter } from './modules/masters/masters.routes.js'
import { ratesRouter } from './modules/rates/rates.routes.js'
import { inwardRouter } from './modules/inward/inward.routes.js'
import { dispatchRouter } from './modules/dispatch/dispatch.routes.js'
import { invoicesRouter } from './modules/invoices/invoices.routes.js'
import { paymentsRouter } from './modules/payments/payments.routes.js'
import { stockRouter } from './modules/stock/stock.routes.js'
import { scrapRouter } from './modules/scrap/scrap.routes.js'
import { expensesRouter } from './modules/expenses/expenses.routes.js'
import { rejectionRouter } from './modules/rejection/rejection.routes.js'
import { attendanceRouter } from './modules/attendance/attendance.routes.js'
import { reportsRouter } from './modules/reports/reports.routes.js'
import { usersRouter } from './modules/users/users.routes.js'
import { rolesRouter } from './modules/roles/roles.routes.js'
import { importRouter } from './modules/import/import.routes.js'
import { systemRouter } from './modules/system/system.routes.js'

export function createApp() {
  const app = express()
  app.set('trust proxy', 1) // correct client IPs behind a reverse proxy (for rate-limit)
  app.use(helmet())
  app.use(requestLogger)
  // In production CORS is locked to the configured origins; dev allows any.
  // Expose X-State-Version so the browser can read it for optimistic concurrency.
  app.use(cors({
    origin: config.isProd ? config.corsOrigins : config.corsOrigins.length ? config.corsOrigins : true,
    exposedHeaders: ['X-State-Version'],
  }))
  app.use(express.json({ limit: '20mb' }))

  // Stamp the current datastore version on every JSON response. The client tracks
  // it on each request, so a full-state snapshot can send `baseVersion` and the
  // server's 409 guard fires only when ANOTHER session has advanced the version.
  app.use((_req, res, next) => {
    const sendJson = res.json.bind(res)
    res.json = (body: unknown) => {
      if (!res.headersSent) res.setHeader('X-State-Version', String(getVersion()))
      return sendJson(body)
    }
    next()
  })

  // Throttle credential-guessing on the auth endpoints.
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: config.authRateMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts — please wait and try again.' },
  })
  // A generous global ceiling to blunt abuse/runaway clients (per IP).
  const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: config.apiRateMax, standardHeaders: true, legacyHeaders: false })

  // Liveness (cheap) vs readiness (checks the datastore — for load balancers / k8s).
  app.get('/api/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }))
  app.get('/api/ready', async (_req, res) => {
    const db = await ping()
    res.status(db ? 200 : 503).json({ ready: db, db })
  })

  app.use('/api', apiLimiter)
  app.use('/api/auth/login', authLimiter)
  app.use('/api/auth', authRouter)
  app.use('/api/masters', mastersRouter)
  app.use('/api/rates', ratesRouter)
  app.use('/api/inward', inwardRouter)
  app.use('/api/dispatch', dispatchRouter)
  app.use('/api/invoices', invoicesRouter)
  app.use('/api/payments', paymentsRouter)
  app.use('/api/stock', stockRouter)
  app.use('/api/scrap', scrapRouter)
  app.use('/api/expenses', expensesRouter)
  app.use('/api/rejection', rejectionRouter)
  app.use('/api/attendance', attendanceRouter)
  app.use('/api/reports', reportsRouter)
  app.use('/api/users', usersRouter)
  app.use('/api/roles', rolesRouter)
  app.use('/api/import', importRouter)
  app.use('/api/system', systemRouter)

  // Production deployment is a single conventional Node process: Express serves
  // the compiled React application as well as the API. Vite writes this folder
  // during `npm run build`; in development it is absent/ignored and Vite serves
  // the frontend separately with its /api proxy.
  const frontendDist = resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend_2.0/dist')
  if (existsSync(frontendDist)) {
    app.use(express.static(frontendDist, { index: false, maxAge: config.isProd ? '1d' : 0 }))
    app.get('*', (req, res, next) => {
      if (req.path === '/api' || req.path.startsWith('/api/') || !req.accepts('html')) return next()
      res.sendFile(resolve(frontendDist, 'index.html'))
    })
  }

  app.use(errorMiddleware)
  return app
}
