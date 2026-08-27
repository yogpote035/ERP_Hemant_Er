# Hemant Engineering Works — Job Work & Billing ERP

A React and Node.js ERP for material inward, dispatch, live stock, GST billing,
payments, scrap, rejection, payroll, and statutory reports.

- `frontend_2.0/` — active Vite + React + TypeScript application.
- `backend/` — Express + TypeScript REST API.
- PostgreSQL is used for production. A JSON-file datastore is available for local development.

## Requirements

- Node.js 20 or newer
- npm
- PostgreSQL 14 or newer for production
- PM2 is optional but recommended for keeping the production process online

## Development

Install dependencies once:

```powershell
cd backend
npm install
cd ../frontend_2.0
npm install
```

Run the API in terminal 1:

```powershell
cd backend
npm run dev
```

Run React in terminal 2:

```powershell
cd frontend_2.0
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` to `http://localhost:4000`,
so no frontend environment file is needed for the normal local setup.

Development demo accounts use password `demo`: `admin@hew.in`, `manager@hew.in`,
`opa@hew.in`, and `opb@hew.in`. When `DATABASE_URL` is not set, API data is saved
to `backend/data/db.json`.

## Production deployment

Production uses one Node process. Express serves `/api` and the compiled React SPA
from the same origin; Docker, nginx, and `vite preview` are not required.

### 1. Prepare PostgreSQL

Create a database and user, then note the connection string, for example:

```text
postgres://hew:strong-password@localhost:5432/hew_erp
```

### 2. Configure the server

Copy `.env.example` to `.env` in the project root and replace every placeholder.
Production startup intentionally fails when `DATABASE_URL`, a strong `JWT_SECRET`,
or `CORS_ORIGIN` is missing.

For a server available at `https://erp.example.com`, use:

```ini
NODE_ENV=production
PORT=4000
DATABASE_URL=postgres://hew:strong-password@localhost:5432/hew_erp
JWT_SECRET=a-random-secret-at-least-32-characters-long
JWT_EXPIRES_IN=12h
CORS_ORIGIN=https://erp.example.com
SEED_ADMIN_EMAIL=admin@example.com
SEED_ADMIN_PASSWORD=a-strong-first-login-password
```

`SEED_ADMIN_*` creates the first administrator only when the database is empty.
Demo users and demo business data are disabled by default in production.

### 3. Install and build

```powershell
cd frontend_2.0
npm install
npm run build

cd ../backend
npm install
npm run build
```

The frontend production build automatically uses same-origin `/api`. The backend
then serves `frontend_2.0/dist` and supports React Router deep links.

### 4. Start

Direct Node start from the project root:

```powershell
node --env-file=.env backend/dist/server.js
```

Or use PM2:

```powershell
npm install --global pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Useful PM2 commands:

```powershell
pm2 status
pm2 logs hew-api
pm2 restart hew-api
```

Open the origin configured in `CORS_ORIGIN`, or `http://localhost:4000` when
running directly on the server. Put a standard HTTPS reverse proxy or hosting
platform load balancer in front of port 4000 when exposing it publicly.

## Health and operations

- `GET /api/health` — process liveness
- `GET /api/ready` — datastore readiness
- Logs are structured JSON in production and include `X-Request-Id` correlation.
- `SIGTERM` and `SIGINT` trigger graceful shutdown.

Change a password:

```powershell
cd backend
npm run set-password -- admin@example.com "new-strong-password"
```

Back up PostgreSQL with its standard tools:

```powershell
pg_dump --no-owner --dbname="postgres://hew:password@localhost:5432/hew_erp" --file=hew_erp.sql
```

Restore with:

```powershell
psql --dbname="postgres://hew:password@localhost:5432/hew_erp" --file=hew_erp.sql
```

## Verification

```powershell
cd backend
npm test
npm run build

cd ../frontend_2.0
npm test
npm run build
```

PostgreSQL durability tests are separate because they require a reachable database:

```powershell
cd backend
npm run test:pg
```

See `backend_status.md` for the endpoint matrix and `docs/PRODUCTION_READINESS.md`
for the broader operational checklist.
