/**
 * Rotate a user's password against the live datastore (Postgres or the file store,
 * per DATABASE_URL). Usage:  npm run set-password -- <email> <new-password>
 */
import bcrypt from 'bcryptjs'
import { initRepository, closeRepository, getDb, mutate } from '../src/db/repository.js'
import { values, putEntity } from '../src/db/normalized.js'

const [email, password] = process.argv.slice(2)
if (!email || !password) {
  console.error('Usage: npm run set-password -- <email> <new-password>')
  process.exit(1)
}
if (password.length < 8) {
  console.error('Password must be at least 8 characters.')
  process.exit(1)
}

await initRepository()
const user = values(getDb().masters.users).find((u) => u.email.toLowerCase() === email.toLowerCase())
if (!user) {
  console.error(`No user found with email "${email}".`)
  await closeRepository()
  process.exit(1)
}
await mutate((s) => {
  putEntity(s.masters.users, { ...user, passwordHash: bcrypt.hashSync(password, 10) })
})
console.log(`✓ Password updated for ${user.email} (${user.role}).`)
await closeRepository()
process.exit(0)
