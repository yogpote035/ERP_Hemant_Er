import { closeRepository, getDb, initRepository, mutate } from '../src/db/repository.js'
import { clientPartCatalog } from '../src/db/partCatalog.js'
import { putEntity, values } from '../src/db/normalized.js'

await initRepository()
const state = getDb()
const unitId = state.masters.units.allIds[0]
if (!unitId) throw new Error('Create a company unit before seeding the part catalogue')

let created = 0
let updated = 0
await mutate((draft) => {
  for (const incoming of clientPartCatalog(unitId)) {
    const existing = values(draft.masters.parts).find(
      (p) => p.unitId === unitId && p.partNo.trim().toLowerCase() === incoming.partNo.trim().toLowerCase()
    )
    if (existing) {
      putEntity(draft.masters.parts, { ...existing, ...incoming, id: existing.id })
      updated++
    } else {
      putEntity(draft.masters.parts, incoming)
      created++
    }
  }
})

console.log(`Part catalogue seeded: ${created} created, ${updated} updated`)
await closeRepository()
