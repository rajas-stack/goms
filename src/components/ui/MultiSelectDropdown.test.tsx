import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MultiSelectDropdown, type MultiSelectGroup } from './MultiSelectDropdown'
import { WORK_COMPONENT_GROUPS } from '@/features/nodes/department-meta'

const GROUPS: MultiSelectGroup[] = [
  { label: null, options: ['Alpha', 'Bravo'] },
  { label: 'OEM', options: ['Charlie', 'Delta'] },
]

beforeEach(() => {
  localStorage.clear()
})

describe('MultiSelectDropdown — default behavior (searchable/allowCustomAdd unset)', () => {
  it('shows the placeholder when nothing is selected and no chips', () => {
    render(<MultiSelectDropdown value={[]} onChange={() => {}} groups={GROUPS} storageKey="test-default" placeholder="Pick…" />)
    expect(screen.getByText('Pick…')).toBeInTheDocument()
  })

  it('trigger click only opens the panel — no search input is rendered, and the "+ Add option" footer is present', async () => {
    const user = userEvent.setup()
    render(<MultiSelectDropdown value={[]} onChange={() => {}} groups={GROUPS} storageKey="test-default" />)
    await user.click(screen.getByRole('button', { name: /pick|select/i }))
    expect(screen.getAllByRole('checkbox')).toHaveLength(4)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add option/i })).toBeInTheDocument()
  })

  it('checking an option calls onChange with the option appended', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<MultiSelectDropdown value={[]} onChange={onChange} groups={GROUPS} storageKey="test-default" />)
    await user.click(screen.getByRole('button', { name: /select/i }))
    await user.click(screen.getByRole('checkbox', { name: 'Alpha' }))
    expect(onChange).toHaveBeenCalledWith(['Alpha'])
  })

  it('clicking a chip\'s × button calls onChange with the value removed (stopPropagation keeps the trigger closed)', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<MultiSelectDropdown value={['Alpha', 'Bravo']} onChange={onChange} groups={GROUPS} storageKey="test-default" />)
    await user.click(screen.getByRole('button', { name: /remove alpha/i }))
    expect(onChange).toHaveBeenCalledWith(['Bravo'])
    // The trigger's own onClick toggles `open` — a chip removal must not
    // also open the panel via bubbling.
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })
})

describe('MultiSelectDropdown — WorkFormDialog call-site regression', () => {
  // Mirrors the exact invocation in src/features/nodes/WorkFormDialog.tsx:
  // <MultiSelectDropdown value={form.component} onChange={...} groups={WORK_COMPONENT_GROUPS} storageKey="work-component" />
  // i.e. searchable and allowCustomAdd both left unset.
  it('renders and behaves exactly as before with no search input, footer shown, and toggling works', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<MultiSelectDropdown value={[]} onChange={onChange} groups={WORK_COMPONENT_GROUPS} storageKey="work-component" />)
    await user.click(screen.getByRole('button', { name: /select/i }))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add option/i })).toBeInTheDocument()
    const firstOption = WORK_COMPONENT_GROUPS[0].options[0]
    await user.click(screen.getByRole('checkbox', { name: firstOption }))
    expect(onChange).toHaveBeenCalledWith([firstOption])
  })
})

describe('MultiSelectDropdown — searchable', () => {
  it('renders a search input at the top of the panel when searchable', async () => {
    const user = userEvent.setup()
    render(<MultiSelectDropdown value={[]} onChange={() => {}} groups={GROUPS} storageKey="test-search" searchable searchPlaceholder="Find…" />)
    await user.click(screen.getByRole('button', { name: /select/i }))
    expect(screen.getByPlaceholderText('Find…')).toBeInTheDocument()
  })

  it('typing filters the visible checkbox rows by label substring match (case-insensitive), and hides a group header with no remaining matches', async () => {
    const user = userEvent.setup()
    render(<MultiSelectDropdown value={[]} onChange={() => {}} groups={GROUPS} storageKey="test-search" searchable searchPlaceholder="Find…" />)
    await user.click(screen.getByRole('button', { name: /select/i }))
    expect(screen.getAllByRole('checkbox')).toHaveLength(4)

    await user.type(screen.getByPlaceholderText('Find…'), 'cha')

    expect(screen.getByRole('checkbox', { name: 'Charlie' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Alpha' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Bravo' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Delta' })).not.toBeInTheDocument()
    // "OEM" header stays because Charlie (its only remaining match) is still visible.
    expect(screen.getByText('OEM')).toBeInTheDocument()
  })

  it('hides a group header entirely once none of its options match', async () => {
    const user = userEvent.setup()
    render(<MultiSelectDropdown value={[]} onChange={() => {}} groups={GROUPS} storageKey="test-search" searchable searchPlaceholder="Find…" />)
    await user.click(screen.getByRole('button', { name: /select/i }))
    await user.type(screen.getByPlaceholderText('Find…'), 'alp')
    expect(screen.getByRole('checkbox', { name: 'Alpha' })).toBeInTheDocument()
    expect(screen.queryByText('OEM')).not.toBeInTheDocument()
  })

  it('typing in the search box never calls onChange — it is a display filter only', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<MultiSelectDropdown value={['Alpha']} onChange={onChange} groups={GROUPS} storageKey="test-search" searchable searchPlaceholder="Find…" />)
    // Disambiguate from the chip's own "Remove Alpha" button — only the
    // trigger carries aria-expanded.
    await user.click(screen.getByRole('button', { name: /alpha/i, expanded: false }))
    await user.type(screen.getByPlaceholderText('Find…'), 'bravo')
    expect(onChange).not.toHaveBeenCalled()
    // value is untouched — Alpha's chip is still rendered on the trigger.
    expect(screen.getByText('Alpha')).toBeInTheDocument()
  })

  it('checking a filtered row still calls onChange normally', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<MultiSelectDropdown value={[]} onChange={onChange} groups={GROUPS} storageKey="test-search" searchable searchPlaceholder="Find…" />)
    await user.click(screen.getByRole('button', { name: /select/i }))
    await user.type(screen.getByPlaceholderText('Find…'), 'bravo')
    await user.click(screen.getByRole('checkbox', { name: 'Bravo' }))
    expect(onChange).toHaveBeenCalledWith(['Bravo'])
  })
})

describe('MultiSelectDropdown — allowCustomAdd', () => {
  it('hides the "+ Add option" footer when allowCustomAdd is false', async () => {
    const user = userEvent.setup()
    render(<MultiSelectDropdown value={[]} onChange={() => {}} groups={GROUPS} storageKey="test-noadd" allowCustomAdd={false} />)
    await user.click(screen.getByRole('button', { name: /select/i }))
    expect(screen.queryByRole('button', { name: /add option/i })).not.toBeInTheDocument()
  })

  it('still shows the "+ Add option" footer when allowCustomAdd is true or unset', async () => {
    const user = userEvent.setup()
    render(<MultiSelectDropdown value={[]} onChange={() => {}} groups={GROUPS} storageKey="test-add-true" allowCustomAdd />)
    await user.click(screen.getByRole('button', { name: /select/i }))
    expect(screen.getByRole('button', { name: /add option/i })).toBeInTheDocument()
  })
})
