import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AuthStatus } from './AuthStatus'

const firebase = vi.hoisted(() => ({ onAuthStateChanged: vi.fn(), signOut: vi.fn().mockResolvedValue(undefined) }))
vi.mock('firebase/auth', () => firebase)
afterEach(cleanup)
beforeEach(() => {
  firebase.onAuthStateChanged.mockImplementation((_auth, callback) => {
    callback({ email: 'user@example.com', displayName: 'Signed-in user', photoURL: null })
    return () => {}
  })
})
describe('Profile options navigation', () => {
  it('replaces the gear with the clickable profile and preserves Settings navigation', async () => {
    render(<MemoryRouter><AuthStatus includeOptions /></MemoryRouter>)
    expect(screen.queryByRole('button', { name: 'Options' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Profile options' }))
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('menuitem', { name: /Settings/ }))
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /DMS Settings/ })).toHaveAttribute('href', '/settings/dms')
  })
  it('keeps the gear and Sign in for signed-out users', () => {
    firebase.onAuthStateChanged.mockImplementation((_auth, callback) => { callback(null); return () => {} })
    render(<MemoryRouter><AuthStatus includeOptions /></MemoryRouter>)
    expect(screen.getByRole('button', { name: 'Options' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Profile options' })).not.toBeInTheDocument()
  })
})
