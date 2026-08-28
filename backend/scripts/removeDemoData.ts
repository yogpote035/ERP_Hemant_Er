/** Remove only known demo-seed entities while preserving master/security data. */
import { closeRepository, getDb, initRepository, mutate } from '../src/db/repository.js'
import { COLLECTIONS } from '../src/db/persistence.js'
import { removeEntity } from '../src/db/normalized.js'
import { seedState } from '../src/db/seed.js'

const PRESERVED = new Set([
  'masters.units',
  'masters.users',
  'masters.roles',
  'masters.parts',
])

await initRepository()
const demo = seedState()
const removed: Record<string, number> = {}

await mutate((state) => {
  for (const collection of COLLECTIONS) {
    if (PRESERVED.has(collection.path)) continue
    const demoIds = collection.get(demo).allIds
    const live = collection.get(state)
    let count = 0
    for (const id of demoIds) {
      if (!(id in live.byId)) continue
      removeEntity(live, id)
      count++
    }
    if (count) removed[collection.path] = count
  }
})

const remaining = Object.fromEntries(
  COLLECTIONS
    .map((collection) => [collection.path, collection.get(getDb()).allIds.length] as const)
    .filter(([, count]) => count > 0)
)

console.log(JSON.stringify({ removed, remaining }, null, 2))
await closeRepository()

