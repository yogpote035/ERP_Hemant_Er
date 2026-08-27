/* Full-API smoke with concrete seed assertions. Usage: node scripts/smoke-all.mjs
 * NOTE: ends by calling POST /system/reset-demo, which restores the clean seed
 * (so write-path tests are idempotent across reruns). */
const BASE = process.env.BASE ?? 'http://localhost:4000'
let pass = 0, fail = 0
const log = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); ok ? pass++ : fail++ }

async function req(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = await res.json() } catch { /* */ }
  return { status: res.status, json }
}
const tokenOf = async (email, password = 'demo') => (await req('POST', '/api/auth/login', { body: { email, password } })).json?.token

async function main() {
  const T = await tokenOf('admin@hew.in')
  const op = await tokenOf('opa@hew.in')
  log(!!T, 'admin login')

  // ── reads with concrete assertions ──────────────────────────────────────────
  const inv = await req('GET', '/api/invoices', { token: T })
  const i254 = inv.json?.data?.find((r) => r.invoice.id === 'inv-254')
  const i255 = inv.json?.data?.find((r) => r.invoice.id === 'inv-255')
  log(i254?.invoice?.totals?.assessable === 15157950 && i254?.invoice?.totals?.igst === 1818954 && i254?.grand === 16976900, 'invoice 254 totals (assessable/igst/grand)')
  log(i254?.status === 'paid' && i254?.outstanding === 0, 'invoice 254 status paid, outstanding 0')
  log(i255?.grand === 14862600, 'invoice 255 grand', String(i255?.grand))

  const doc = await req('GET', '/api/invoices/inv-254/doc', { token: T })
  log(doc.status === 200 && !!doc.json?.data, 'GET /invoices/:id/doc')

  const stock = await req('GET', '/api/stock', { token: T })
  const sp = (pid) => stock.json?.data?.find((r) => r.partId === pid)
  log(sp('p6')?.available === 12000 && sp('p6')?.balanced === true, 'stock p6 available 12000, balanced')
  log(sp('p9')?.available === 6000, 'stock p9 available 6000', String(sp('p9')?.available))
  log(sp('p3')?.available === 0, 'stock p3 available 0 (fully dispatched)')

  const rate = await req('GET', '/api/rates/rm/current/p3', { token: T })
  log(rate.json?.data?.ratePaise === 6200, 'rates current p3 = 6200 paise (not superseded)')

  const pays = await req('GET', '/api/payments', { token: T })
  log(pays.json?.data?.length >= 1, 'payments list (seed pay1)')
  const out = await req('GET', '/api/payments/outstanding', { token: T })
  const o255 = out.json?.data?.find((r) => r.id === 'inv-255')
  log(o255?.outstandingPaise === 14862600, 'outstanding inv-255 = 14862600')

  const kpi = await req('GET', '/api/reports/dashboard/kpis', { token: T })
  const k = kpi.json?.data
  log(k?.activeParts === 13 && k?.inwardsTotal === 5 && k?.dispatchesTotal === 8 && k?.piecesDispatched === 50000 && k?.draftInvoices === 1 && k?.reconcileOk === true, 'dashboard KPIs match seed')

  const exp = await req('GET', '/api/expenses', { token: T })
  const e2 = exp.json?.data?.find((x) => x.id === 'exp2')
  log(e2?.balancePaise === 11340000 && e2?.paidPaise === 10000000, 'expense exp2 balance 11340000')

  const prod = await req('GET', '/api/attendance/production', { token: T })
  log(prod.json?.data?.[0]?.earned === 295000, 'production pa1 earned 295000 (1180×₹2.50)')
  const pay = await req('GET', '/api/attendance/payroll', { token: T })
  const e1 = pay.json?.data?.find((r) => r.employeeId === 'e1')
  const e2p = pay.json?.data?.find((r) => r.employeeId === 'e2')
  log(e1?.total === 295000 && e2p?.total === 81000, 'payroll e1 ₹2950, e2 ₹810')

  log((await req('GET', '/api/roles', { token: T })).json?.data?.length === 3, 'roles: 3 builtins')
  const users = await req('GET', '/api/users', { token: T })
  log(users.json?.data?.length === 4 && !users.json.data.some((u) => u.passwordHash !== undefined), 'users list hides password hash')
  log((await req('GET', '/api/scrap', { token: T })).json?.data?.length === 2, 'scrap: 2 bills')
  log((await req('GET', '/api/rejection', { token: T })).json?.data?.length === 2, 'rejection: 2 advices')
  log((await req('GET', '/api/inward', { token: T })).json?.data?.length === 5, 'inward: 5 challans')

  // ── writes ──────────────────────────────────────────────────────────────────
  const newInward = await req('POST', '/api/inward', { token: T, body: { unitId: 'u1', partId: 'p1', vendorId: 'v1', challanNo: 'SMOKE-INW-1', challanDate: '2025-04-10', batchHeatNo: 'SMOKE-HEAT', receivedQty: 500 } })
  log(newInward.status === 201 && !!newInward.json?.data, 'POST /inward')

  const beforeP6 = sp('p6')?.available
  const disp = await req('POST', '/api/dispatch', { token: T, body: { inwardId: 'i4', lines: [{ kind: 'billed', okQty: 100, billNo: 'SMOKE-DC', ratePaise: 6600 }] } })
  log(disp.status === 201 || disp.status === 200, 'POST /dispatch (batch under i4)')
  const dispId = Array.isArray(disp.json?.data) ? disp.json.data[0]?.id : disp.json?.data?.id
  const stock2 = await req('GET', '/api/stock', { token: T })
  const afterP6 = stock2.json?.data?.find((r) => r.partId === 'p6')?.available
  log(afterP6 === beforeP6 - 100, 'dispatch reduced p6 available by 100', `${beforeP6}→${afterP6}`)

  // DELETE the dispatch → stock restored (new endpoint)
  const delDisp = await req('DELETE', `/api/dispatch/${dispId}`, { token: T })
  const stock2b = await req('GET', '/api/stock', { token: T })
  log(delDisp.status === 200 && stock2b.json?.data?.find((r) => r.partId === 'p6')?.available === beforeP6, 'DELETE /dispatch/:id restores p6 stock')

  // Inward PUT + DELETE (new endpoints) on a throwaway challan
  const tInw = await req('POST', '/api/inward', { token: T, body: { unitId: 'u1', partId: 'p1', challanNo: 'SMOKE-INW-RW', challanDate: '2025-04-11', batchHeatNo: 'RW', receivedQty: 300 } })
  const tInwId = tInw.json?.data?.id
  const putInw = await req('PUT', `/api/inward/${tInwId}`, { token: T, body: { unitId: 'u1', partId: 'p1', challanNo: 'SMOKE-INW-RW', challanDate: '2025-04-11', batchHeatNo: 'RW', receivedQty: 650 } })
  log(putInw.status === 200 && putInw.json?.data?.receivedQty === 650, 'PUT /inward/:id edits receivedQty')
  const delInw = await req('DELETE', `/api/inward/${tInwId}`, { token: T })
  const getGone = await req('GET', `/api/inward/${tInwId}`, { token: T })
  log(delInw.status === 200 && getGone.status === 404, 'DELETE /inward/:id removes the challan')
  // delete guard: i4 has the SMOKE dispatch removed but still in-house; deleting i1 (has dispatches) must be blocked
  const blocked = await req('DELETE', '/api/inward/i1', { token: T })
  log(blocked.status === 409, 'DELETE /inward/:id blocked while it has dispatches/rejections')

  const recPay = await req('POST', '/api/payments', { token: T, body: { mode: 'neft', ref: 'SMOKE-UTR', date: '2025-04-12', amountPaise: 1000000, allocations: [{ invoiceId: 'inv-255', amountPaise: 1000000 }] } })
  log(recPay.status === 201 || recPay.status === 200, 'POST /payments')
  const out2 = await req('GET', '/api/payments/outstanding', { token: T })
  log(out2.json?.data?.find((r) => r.id === 'inv-255')?.outstandingPaise === 13862600, 'payment cut inv-255 outstanding to 13862600')

  const rej = await req('POST', '/api/rejection', { token: T, body: { unitId: 'u1', customerId: 'c1', partId: 'p1', sourceInwardId: 'i2', rejDcNo: 'SMOKE-RJ', rejDate: '2025-04-12', mrQty: 10, frQty: 0, weightBasis: 'scrap', weightPerRingMg: 100000 } })
  log((rej.status === 201 || rej.status === 200) && rej.json?.data?.totalWeightGrams === 1000, 'POST /rejection computes totalWeightGrams=1000')

  const scrap = await req('POST', '/api/scrap', { token: T, body: { unitId: 'u1', customerId: 'c1', weightGrams: 1000000, ratePerKgPaise: 3400, gstPct: 18, tcsPct: 1, scrapInvoiceNo: 'SMOKE-SC', invoiceDate: '2025-04-12' } })
  log(scrap.status === 201 || scrap.status === 200, 'POST /scrap')

  const newUser = await req('POST', '/api/users', { token: T, body: { name: 'Smoke User', email: 'smoke@hew.in', password: 'smoke123', role: 'operator', assignedUnitIds: ['u1'] } })
  log(newUser.status === 201 && newUser.json?.data?.passwordHash === undefined, 'POST /users (hash hidden)')
  log(!!(await tokenOf('smoke@hew.in', 'smoke123')), 'new user can log in')

  // RBAC: operator cannot create a user
  const opUser = await req('POST', '/api/users', { token: op, body: { name: 'x', email: 'x@x.in', password: 'x', role: 'operator', assignedUnitIds: [] } })
  log(opUser.status === 403, 'operator forbidden from creating users (RBAC)')

  // ── reset-demo (admin) — cleans up + verifies the reset endpoint ─────────────
  const reset = await req('POST', '/api/system/reset-demo', { token: T })
  log(reset.status === 200 || reset.status === 201, 'POST /system/reset-demo')
  const stock3 = await req('GET', '/api/stock', { token: T })
  log(stock3.json?.data?.find((r) => r.partId === 'p6')?.available === 12000, 'after reset, p6 available back to 12000')

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
