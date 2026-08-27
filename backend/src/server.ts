import { config, assertProdConfig } from './config.js'
import { initRepository, closeRepository } from './db/repository.js'
import { createApp } from './app.js'
import { log } from './lib/logging.js'

// Never let an unhandled error silently take the process down without a trace.
process.on('uncaughtException', (err) => log.error('uncaughtException', { error: err.message, stack: err.stack }))
process.on('unhandledRejection', (reason) => log.error('unhandledRejection', { reason: String(reason) }))

assertProdConfig() // fail fast on unsafe prod settings
await initRepository()
const app = createApp()
const server = app.listen(config.port, () => {
  log.info('listening', { url: `http://localhost:${config.port}/api`, persistence: config.databaseUrl ? 'postgres' : 'file', env: config.nodeEnv })
})

// Graceful shutdown: stop accepting connections, drain, close the DB pool, then exit.
let shuttingDown = false
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  log.info('shutting down', { signal })
  const timer = setTimeout(() => { log.error('forced exit (drain timeout)'); process.exit(1) }, 10_000)
  server.close(async () => {
    await closeRepository().catch(() => {})
    clearTimeout(timer)
    log.info('shutdown complete')
    process.exit(0)
  })
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
