import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { OptionsMenu } from './OptionsMenu'
import { EyeComfortOverlay, setEyeComfort } from './EyeComfort'
afterEach(() => { cleanup(); setEyeComfort({ enabled: false, strength: 40 }) })
describe('profile menu eye comfort', () => {
  it('replaces System and guidance with a persistent strength slider', async () => {
    render(<MemoryRouter><OptionsMenu /><EyeComfortOverlay /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: 'Profile options' }))
    expect(screen.queryByText('System')).not.toBeInTheDocument()
    expect(screen.queryByText('Workspace configuration')).not.toBeInTheDocument()
    expect(screen.queryByText('Ctrl')).not.toBeInTheDocument()
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Eye comfort' }))
    fireEvent.change(screen.getByRole('slider', { name: 'Eye comfort strength' }), { target: { value: '80' } })
    expect(screen.getByText('80%')).toBeInTheDocument()
    expect(document.querySelector('[data-eye-comfort]')).toHaveStyle({ opacity: '0.192', pointerEvents: 'none' })
    expect(JSON.parse(localStorage.getItem('goms.eye-comfort')!)).toEqual({ enabled: true, strength: 80 })
    await userEvent.click(screen.getByRole('button', { name: 'Profile options' }))
    expect(document.querySelector('[data-eye-comfort]')).toHaveStyle({ opacity: '0.192' })
    await userEvent.click(screen.getByRole('button', { name: 'Profile options' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Light' }))
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
    expect(document.querySelector('[data-eye-comfort]')).toHaveStyle({ opacity: '0' })
  })
})
