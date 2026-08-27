/* Smoke test the running API. Usage: BASE=http://localhost:4000 node scripts/smoke.mjs */
const BASE = process.env.BASE ?? 'http://localhost:4000'
let pass = 0
let fail = 0
const log = (ok, name, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`)
  ok ? pass++ : fail++
}

async function req(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = await res.json() } catch { /* no body */ }
  return { status: res.status, json }
}

async function main() {
  // health
  const h = await req('GET', '/api/health')
  log(h.status === 200 && h.json?.ok === true, 'GET /api/health')

  // login bad creds
  const bad = await req('POST', '/api/auth/login', { body: { email: 'admin@hew.in', password: 'wrong' } })
  log(bad.status === 401, 'POST /api/auth/login rejects bad password')

  // login admin
  const login = await req('POST', '/api/auth/login', { body: { email: 'admin@hew.in', password: 'demo' } })
  const token = login.json?.token
  log(login.status === 200 && !!token, 'POST /api/auth/login (admin)')
  log(login.json?.user && login.json.user.passwordHash === undefined, 'login response hides password hash')

  // me
  const me = await req('GET', '/api/auth/me', { token })
  log(me.status === 200 && me.json?.user?.email === 'admin@hew.in', 'GET /api/auth/me')

  // me without token
  const noTok = await req('GET', '/api/auth/me')
  log(noTok.status === 401, 'GET /api/auth/me requires token')

  // masters: list parts
  const parts = await req('GET', '/api/masters/parts', { token })
  log(parts.status === 200 && Array.isArray(parts.json?.data) && parts.json.data.length >= 13, 'GET /api/masters/parts', `${parts.json?.data?.length} rows`)

  // masters: list customers
  const custs = await req('GET', '/api/masters/customers', { token })
  log(custs.status === 200 && custs.json?.data?.length >= 3, 'GET /api/masters/customers')

  // create a customer
  const created = await req('POST', '/api/masters/customers', { token, body: { name: 'Smoke Test Co', gstin: '27AAAAA0000A1Z5', stateCode: '27', addressLines: ['Pune'] } })
  const newId = created.json?.data?.id
  log(created.status === 201 && !!newId, 'POST /api/masters/customers')

  // update it
  const updated = await req('PUT', `/api/masters/customers/${newId}`, { token, body: { name: 'Smoke Test Co (Edited)', gstin: '27AAAAA0000A1Z5', stateCode: '27', addressLines: ['Pune'], paymentTermsDays: 30 } })
  log(updated.status === 200 && updated.json?.data?.name?.includes('Edited'), 'PUT /api/masters/customers/:id')

  // soft delete it
  const del = await req('DELETE', `/api/masters/customers/${newId}`, { token })
  log(del.status === 200 && del.json?.data?.active === false, 'DELETE /api/masters/customers/:id (soft)')

  // reactivate
  const react = await req('PATCH', `/api/masters/customers/${newId}/active`, { token, body: { active: true } })
  log(react.status === 200 && react.json?.data?.active === true, 'PATCH /api/masters/customers/:id/active')

  // RBAC: operator cannot create a customer (operator masters = view only)
  const opLogin = await req('POST', '/api/auth/login', { body: { email: 'opa@hew.in', password: 'demo' } })
  const opTok = opLogin.json?.token
  const opCreate = await req('POST', '/api/masters/customers', { token: opTok, body: { name: 'Nope', gstin: '', stateCode: '27', addressLines: [] } })
  log(opCreate.status === 403, 'operator forbidden from creating customer (RBAC)')

  // unit scope: operator A (unit u1) should not see unit u2 parts in scoped list
  const opParts = await req('GET', '/api/masters/parts', { token: opTok })
  const hasU2 = (opParts.json?.data ?? []).some((p) => p.unitId === 'u2')
  log(opParts.status === 200 && !hasU2, 'operator A parts list is unit-scoped (no u2)')

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
