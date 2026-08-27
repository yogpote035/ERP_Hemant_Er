import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useStore } from '@/store'
import { seedState } from '@/lib/seed'
import Login from './Login'

/** Smoke test: the credential sign-in screen mounts with Login ID + Password. */
describe('Login screen', () => {
  beforeEach(() => {
    useStore.setState(seedState(), true) // replace: fresh seeded store, no session
  })

  it('renders the Login ID + Password credential form', () => {
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    )
    expect(screen.getByText(/enter your login id and password/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/you@hew\.in/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })
})
