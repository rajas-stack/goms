import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OfficeLocationsField } from './OfficeLocationsField'
import { parseOfficeLocations } from './office-locations'

function Harness({ initialMeta = {} }: { initialMeta?: Record<string, string> }) {
  const [meta, setMeta] = useState(initialMeta)
  return <OfficeLocationsField meta={meta} setMeta={setMeta} />
}

describe('OfficeLocationsField', () => {
  it('adds and edits multiple named office/branch addresses', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'Add location' }))
    const main = screen.getByRole('region', { name: 'Main office' })
    await user.clear(within(main).getByRole('textbox', { name: 'Office or branch name' }))
    await user.type(within(main).getByRole('textbox', { name: 'Office or branch name' }), 'Head Office')
    await user.type(within(main).getByRole('textbox', { name: 'Address' }), '1 Secretariat Road')

    await user.click(screen.getByRole('button', { name: 'Add location' }))
    const branch = screen.getByRole('region', { name: 'Branch office 1' })
    await user.clear(within(branch).getByRole('textbox', { name: 'Office or branch name' }))
    await user.type(within(branch).getByRole('textbox', { name: 'Office or branch name' }), 'Surat branch')
    await user.type(within(branch).getByRole('textbox', { name: 'Address' }), '2 Ring Road')

    expect(screen.getByRole('region', { name: 'Head Office' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Surat branch' })).toBeInTheDocument()
  })

  it('migrates a legacy single address into an editable main office', () => {
    render(<Harness initialMeta={{ officeAddress: '1 Secretariat Road' }} />)

    const main = screen.getByRole('region', { name: 'Main office' })
    expect(within(main).getByRole('textbox', { name: 'Address' })).toHaveValue('1 Secretariat Road')
    expect(parseOfficeLocations(undefined, '1 Secretariat Road')).toHaveLength(1)
  })
})