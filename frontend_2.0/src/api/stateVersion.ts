/**
 * The server's datastore version, tracked from the `X-State-Version` response
 * header on every API call. A full-state snapshot (writeThrough.pushFullState)
 * sends this as `baseVersion` so the backend can 409 when another session has
 * advanced the state — instead of silently clobbering it.
 *
 * Standalone (imports nothing) so the api client can update it without a cycle.
 */
let lastVersion = 0
export const getStateVersion = (): number => lastVersion
export const setStateVersion = (v: number): void => {
  if (Number.isFinite(v)) lastVersion = v
}
