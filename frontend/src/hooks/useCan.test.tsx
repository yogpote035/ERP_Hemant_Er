import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import { useStore, login } from '@/store'
import { seedState } from '@/lib/seed'
import { values } from '@/store/normalized'
import { useCan } from './useCan'

function Probe() {
  const can = useCan()
  return <span>{can('billing', 'approve') ? 'YES' : 'NO'}</span>
}

beforeEach(() => {
  useStore.setState(seedState(), true)
  const mgr = values(useStore.getState().masters.users).find((u) => u.role === 'manager')!
  login(mgr.id)
})
afterEach(cleanup)

describe('useCan reactivity', () => {
  it("re-renders gates when the active user's role matrix changes (not just the user)", () => {
    render(<Probe />)
    // Manager preset grants billing:approve.
    expect(screen.getByText('YES')).toBeTruthy()

    // Simulate an admin editing the Manager role — this mutates masters.roles
    // only; currentUser (masters.users) keeps the same reference. The gate must
    // still update without a reload.
    act(() => {
      useStore.setState((s) => {
        const role = s.masters.roles.byId['manager']!
        return {
          masters: {
            ...s.masters,
            roles: {
              ...s.masters.roles,
              byId: {
                ...s.masters.roles.byId,
                manager: { ...role, permissions: { ...role.permissions, billing: ['view', 'create', 'edit', 'export'] } },
              },
            },
          },
        }
      })
    })

    expect(screen.getByText('NO')).toBeTruthy()
  })
})
