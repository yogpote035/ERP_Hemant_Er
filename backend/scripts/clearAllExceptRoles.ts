import { initRepository, getDb, replaceState, closeRepository } from '../src/db/repository.js'
import { createEmptyState } from '../src/db/state.js'

await initRepository()
try {
  const current = getDb()
  const next = createEmptyState()
  next.masters.roles = structuredClone(current.masters.roles)
  next.system.seeded = true
  next.system.seedVersion = current.system.seedVersion
  next.system.schemaVersion = current.system.schemaVersion
  await replaceState(next)
  console.log(`Database cleared. Preserved ${next.masters.roles.allIds.length} role(s); all other records deleted.`)
} finally {
  await closeRepository()
}
