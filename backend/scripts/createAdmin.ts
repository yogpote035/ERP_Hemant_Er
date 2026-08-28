import bcrypt from 'bcryptjs'
import { initRepository, closeRepository, getDb, mutate, values, getById } from '../src/db/repository.js'
import { putEntity } from '../src/db/normalized.js'

const [email, password, ...nameParts] = process.argv.slice(2)
const name = nameParts.join(' ').trim() || 'Hemant Group Admin'
if (!email || !password || password.length < 12) {
  console.error('Usage: npm run create-admin -- <email> <password-12+-chars> [name]')
  process.exit(1)
}

await initRepository()
try {
  if (!getById(getDb().masters.roles, 'admin')) throw new Error('Admin role is missing')
  const existing = values(getDb().masters.users).find((u) => u.email.toLowerCase() === email.toLowerCase())
  const id = existing?.id ?? `usr_admin_${Date.now()}`
  await mutate((state) => putEntity(state.masters.users, {
    id,
    name,
    email: email.trim().toLowerCase(),
    passwordHash: bcrypt.hashSync(password, 12),
    role: 'admin',
    assignedUnitIds: [],
    active: true,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  }))
  console.log(`Admin account ready: ${email.trim().toLowerCase()}`)
} finally {
  await closeRepository()
}
