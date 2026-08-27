/**
 * PM2 process config for the production Node server. Express serves both the API
 * and the compiled React SPA, so no Vite preview or second web process is needed.
 *
 *   Build first:   (cd backend && npm run build) && (cd frontend_2.0 && npm run build)
 *   Start:         pm2 start ecosystem.config.cjs
 *   Status/logs:   pm2 status   |   pm2 logs   |   pm2 logs hew-api
 *   Reload:        pm2 reload ecosystem.config.cjs
 *   Boot on start: pm2 save && pm2 startup
 *
 * Build both applications before starting. Runtime settings and secrets are read
 * from the root .env by Node's built-in --env-file support (Node 20+).
 */
const path = require('path')
const ROOT = __dirname
// Each app's logs live under its own folder (backend/logs, frontend_2.0/logs).
const backendLog = (name) => path.join(ROOT, 'backend', 'logs', name)

module.exports = {
  apps: [
    {
      name: 'hew-api',
      cwd: path.join(ROOT, 'backend'),
      script: 'dist/server.js',
      node_args: '--env-file=../.env',
      instances: 1,
      autorestart: true,
      max_memory_restart: '400M',
      env: {
        NODE_ENV: 'production',
        PORT: '4000',
      },
      out_file: backendLog('api-out.log'),
      error_file: backendLog('api-error.log'),
      time: true, // prefix each line with a timestamp
      merge_logs: true,
    },
  ],
}
