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
  it.each(['Shubham Mehra', 'Asha Rao'])('puts every gear option under the profile for %s', async (name) => {
    firebase.onAuthStateChanged.mockImplementation((_auth, callback) => {
      callback({ email: 'user@example.com', displayName: name, photoURL: null })
      return () => {}
    })
    render(<MemoryRouter><AuthStatus /></MemoryRouter>)
    expect(screen.getByRole('button', { name: 'Profile options' })).toHaveTextContent(name)
    expect(screen.queryByRole('button', { name: 'Options' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Profile options' }))
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument()
    expect(screen.getByRole('menuitemcheckbox', { name: /Day mode|Night mode/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('menuitem', { name: /Settings/ }))
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /DMS Settings/ })).toHaveAttribute('href', '/settings/dms')
    expect(screen.getByRole('link', { name: /Tender websites/ })).toHaveAttribute('href', '/settings/tender-websites')
  })
  it('keeps the gear and Sign in for signed-out users', () => {
    firebase.onAuthStateChanged.mockImplementation((_auth, callback) => { callback(null); return () => {} })
    render(<MemoryRouter><AuthStatus /></MemoryRouter>)
    expect(screen.getByRole('button', { name: 'Options' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Profile options' })).not.toBeInTheDocument()
  })
})
