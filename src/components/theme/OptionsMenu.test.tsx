import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { resolveTheme, THEME_STORAGE_KEY } from '@/lib/theme'
import { OptionsMenu } from './OptionsMenu'

describe('resolveTheme', () => {
  it('follows the device only when the preference is system', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})

describe('OptionsMenu', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
  })

  function openMenu() {
    render(<MemoryRouter><OptionsMenu /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Profile options' }))
  }

  it('switches the whole document to night mode and persists the choice', () => {
    openMenu()
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /day mode/i }))

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(screen.getByRole('menuitemcheckbox', { name: /night mode/i })).toHaveAttribute('aria-checked', 'true')
  })

  it('picks an explicit theme from the Light / Dark / System segments', () => {
    openMenu()
    fireEvent.click(screen.getByRole('menuitemradio', { name: /light/i }))

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
    expect(screen.getByRole('menuitemradio', { name: /light/i })).toHaveAttribute('aria-checked', 'true')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('toggles day/night with Ctrl+Shift+L from anywhere', () => {
    render(<MemoryRouter><OptionsMenu /></MemoryRouter>)
    fireEvent.keyDown(window, { key: 'L', ctrlKey: true, shiftKey: true })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    fireEvent.keyDown(window, { key: 'L', ctrlKey: true, shiftKey: true })
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('opens Settings from the menu', () => {
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: /settings/i }))
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /DMS Settings/ })).toHaveAttribute('href', '/settings/dms')
    expect(screen.getByRole('link', { name: /Tender websites/ })).toHaveAttribute('href', '/settings/tender-websites')
    expect(screen.queryByRole('radiogroup', { name: 'Theme' })).not.toBeInTheDocument()
    expect(screen.queryByText('Keyboard shortcuts')).not.toBeInTheDocument()
  })
})
