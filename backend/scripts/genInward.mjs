/* Generate test inward challans so the Inward register has enough rows to page/search.
   Usage: API=http://localhost:4000/api COUNT=180 node scripts/genInward.mjs
   (reset-demo clears them; re-run to regenerate.) */
const API = process.env.API ?? 'http://localhost:4000/api'
const COUNT = Number(process.env.COUNT ?? 180)

// part → its unit (from the seed: p1..p11 in u1, p12/p13 in u2)
const PARTS = [
  ...Array.from({ length: 11 }, (_, i) => ({ partId: `p${i + 1}`, unitId: 'u1' })),
  { partId: 'p12', unitId: 'u2' },
  { partId: 'p13', unitId: 'u2' },
]
const VENDORS = ['v1', undefined]
const CUSTOMERS = ['c1', 'c2', 'c3']

async function login() {
  const r = await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@hew.in', password: 'demo' }) })
  return (await r.json()).token
}

async function main() {
  const token = await login()
  if (!token) throw new Error('login failed')
  const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  let ok = 0
  let fail = 0
  for (let i = 0; i < COUNT; i++) {
    const part = PARTS[i % PARTS.length]
    const day = (i % 27) + 1
    const month = (i % 12) + 1
    const body = {
      unitId: part.unitId,
      partId: part.partId,
      vendorId: VENDORS[i % VENDORS.length],
      customerId: CUSTOMERS[i % CUSTOMERS.length],
      challanNo: `820245${String(10000 + i)}`,
      challanDate: `2025-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      poNo: `PO-${2025}-${String(1000 + i)}`,
      batchHeatNo: `109${String(1000 + (i % 400))}-SUN-${55000 + (i % 99)}`,
      receivedQty: 500 + ((i * 137) % 9500),
    }
    const res = await fetch(API + '/inward', { method: 'POST', headers: auth, body: JSON.stringify(body) })
    if (res.status === 201) ok++
    else { fail++; if (fail <= 3) console.log('fail', res.status, (await res.json()).error) }
  }
  // report the new total
  const list = await fetch(API + '/inward?page=1&pageSize=1', { headers: auth }).then((r) => r.json())
  console.log(`created ${ok} inward challans (${fail} failed). Inward total now: ${list.total}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
