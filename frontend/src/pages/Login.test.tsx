import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useStore } from '@/store'
import { seedState } from '@/lib/seed'
import Login from './Login'

/** Smoke test: the mock-login screen mounts and lists the seeded, active users. */
describe('Login screen', () => {
  beforeEach(() => {
    useStore.setState(seedState(), true) // replace: fresh seeded store, no session
  })

  it('renders the profile picker with the seeded users', () => {
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    )
    expect(screen.getByText(/choose a profile to sign in/i)).toBeInTheDocument()
    expect(screen.getByText(/\(Admin\)/)).toBeInTheDocument()
    expect(screen.getByText(/\(Manager\)/)).toBeInTheDocument()
    // One activation button per active seeded user (4 in the seed).
    expect(screen.getAllByRole('button').length).toBeGreaterThanOrEqual(4)
  })
})
