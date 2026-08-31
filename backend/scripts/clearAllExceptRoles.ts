import { initRepository, getDb, replaceState, closeRepository } from '../src/db/repository.js'
import { createEmptyState } from '../src/db/state.js'

await initRepository()
try {
  const current = getDb()
  const next = createEmptyState()

  next.masters.units = structuredClone(current.masters.units)
  next.masters.users = structuredClone(current.masters.users)
  next.masters.roles = structuredClone(current.masters.roles)

  next.system.seeded = true
  next.system.seedVersion = current.system.seedVersion
  next.system.schemaVersion = current.system.schemaVersion

  await replaceState(next)

  const preserved = {
    units: next.masters.units.allIds.length,
    users: next.masters.users.allIds.length,
    roles: next.masters.roles.allIds.length,
  }

  console.log(
    `Database cleared. Preserved ${preserved.units} unit(s), ${preserved.users} user(s), and ${preserved.roles} role(s) with permissions; all other records deleted.`
  )
} finally {
  await closeRepository()
}
