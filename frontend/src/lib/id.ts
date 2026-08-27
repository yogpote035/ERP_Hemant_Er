import { nanoid } from 'nanoid'

/** Generate a unique id, optionally prefixed (`inw_…`, `dsp_…`) for readability. */
export function newId(prefix?: string): string {
  return prefix ? `${prefix}_${nanoid(12)}` : nanoid()
}
