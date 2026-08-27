/** Central config — env with sensible dev defaults (no dotenv dependency needed). */
const env = process.env

export const config = {
  port: Number(env.PORT ?? 4000),
  nodeEnv: env.NODE_ENV ?? 'development',
  isProd: env.NODE_ENV === 'production',
  jwtSecret: env.JWT_SECRET ?? 'dev-secret-change-me',
  jwtExpiresIn: env.JWT_EXPIRES_IN ?? '12h',
  /** MySQL/TiDB connection. DB_HOST selects SQL persistence; otherwise a JSON file. */
  dbHost: (env.DB_HOST ?? '').trim(),
  dbPort: Number(env.DB_PORT ?? 3306),
  dbUser: env.DB_USER ?? '',
  dbPassword: env.DB_PASSWORD ?? '',
  dbName: env.DB_NAME ?? '',
  dbSsl: env.DB_SSL === 'true',
  dataFile: env.DATA_FILE ?? './data/db.json',
  corsOrigins: (env.CORS_ORIGIN ?? 'http://localhost:5173,http://localhost:5174')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  authRateMax: Number(env.AUTH_RATE_MAX ?? 30),
  apiRateMax: Number(env.API_RATE_MAX ?? 1000),
  /** Load the full demo dataset (incl. `demo`-password users) on an empty DB.
   *  Explicit SEED_DEMO wins; otherwise on in dev, OFF in production. */
  seedDemo: env.SEED_DEMO ? env.SEED_DEMO === 'true' : env.NODE_ENV !== 'production',
  /** First-run admin, used ONLY to bootstrap an empty production DB (no demo users). */
  seedAdminEmail: (env.SEED_ADMIN_EMAIL ?? '').trim(),
  seedAdminPassword: env.SEED_ADMIN_PASSWORD ?? '',
}

interface SafetyConfig {
  isProd: boolean
  dbHost: string
  dbUser: string
  dbPassword: string
  dbName: string
  jwtSecret: string
  corsOrigins: string[]
}

/** Refuse to boot with unsafe settings in production (fail fast, loudly). */
export function assertProdConfig(cfg: SafetyConfig = config): void {
  if (!cfg.isProd) return
  const problems: string[] = []
  if (!cfg.dbHost || !cfg.dbUser || !cfg.dbPassword || !cfg.dbName)
    problems.push('DB_HOST, DB_USER, DB_PASSWORD and DB_NAME must be set')
  if (!cfg.jwtSecret || cfg.jwtSecret === 'dev-secret-change-me' || cfg.jwtSecret.length < 32)
    problems.push('JWT_SECRET must be a strong value (≥ 32 chars), not the dev default')
  if (cfg.corsOrigins.length === 0) problems.push('CORS_ORIGIN must list the allowed web origins')
  if (problems.length) throw new Error('Unsafe production config:\n - ' + problems.join('\n - '))
}
