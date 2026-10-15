import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { repository, resetLocalData } from '@/data/repository'
import { CompetitorsSection } from './CompetitorsSection'

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><CompetitorsSection /></QueryClientProvider>)
}

const names = () => screen.getAllByRole('article').map(card => card.getAttribute('aria-label'))

async function seedThree() {
  await repository.createCompetitor({ name: 'SAS', relationship: 'strategicThreat', category: 'Analytics', verticals: ['BFSI'], offerings: ['Master data management'], certifications: ['ISO 27001'] })
  await repository.createCompetitor({ name: 'Informatica', relationship: 'competitor', category: 'Data Integration', verticals: ['Retail'], offerings: ['Data integration'] })
  await repository.createCompetitor({ name: 'IBM', relationship: 'partner', category: 'IT Services', verticals: ['BFSI', 'Government'], offerings: ['Consulting'] })
}

describe('CompetitorsSection (local mode)', () => {
  beforeEach(async () => { localStorage.clear(); await resetLocalData() })

  it('shows the empty state and loads five sample competitors without logos', async () => {
    renderSection()
    expect(await screen.findByText('No competitors yet')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Load sample competitors/ }))
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(5))
    expect(names()).toEqual(['IBM', 'Informatica', 'Oracle', 'SAS', 'Talend'])
    expect((await repository.listCompetitors()).every(item => item.logo === null)).toBe(true)
    expect(screen.getByRole('listitem', { name: 'Total Competitors: 5' })).toBeInTheDocument()
    expect(screen.getByRole('listitem', { name: 'Strategic Threats: 1' })).toBeInTheDocument()
  })

  it('adds a competitor with positioning and chip lists', async () => {
    renderSection()
    await userEvent.click(await screen.findByRole('button', { name: 'Add Competitor' }))
    const form = await screen.findByRole('form', { name: 'Add competitor' })
    await userEvent.type(within(form).getByLabelText(/Competitor name/), 'SAS')
    await userEvent.type(within(form).getByLabelText('Website'), 'sas.com')
    await userEvent.selectOptions(within(form).getByLabelText('Relationship status'), 'strategicThreat')
    await userEvent.type(within(form).getByLabelText('Industry / category'), 'Analytics')
    await userEvent.type(within(form).getByLabelText('Offerings', { selector: 'input' }), 'Data deduplication tools{Enter}Master data management,mdm{Enter}')
    await userEvent.click(within(form).getByRole('button', { name: 'Remove mdm' }))
    await userEvent.type(within(form).getByLabelText('Key strengths', { selector: 'input' }), 'Analytics heritage{Enter}')
    await userEvent.click(within(form).getByRole('button', { name: /Add competitor/ }))

    const card = await screen.findByRole('article', { name: 'SAS' })
    expect(within(card).getByText('Strategic Threat')).toBeInTheDocument()
    expect(within(card).getByText('Analytics')).toBeInTheDocument()
    expect(within(card).getByRole('list', { name: 'SAS offerings' })).toHaveTextContent('Master data management')
    expect(within(card).getByRole('list', { name: 'SAS strengths' })).toHaveTextContent('Analytics heritage')
    expect(await repository.listCompetitors()).toMatchObject([{
      name: 'SAS', website: 'https://sas.com', relationship: 'strategicThreat', offerings: ['Data deduplication tools', 'Master data management'],
    }])
  })

  it('shows an inline error for a duplicate name and keeps the dialog open', async () => {
    await repository.createCompetitor({ name: 'SAS' })
    renderSection()
    await userEvent.click(await screen.findByRole('button', { name: 'Add Competitor' }))
    const form = await screen.findByRole('form', { name: 'Add competitor' })
    await userEvent.type(within(form).getByLabelText(/Competitor name/), 'sas')
    await userEvent.click(within(form).getByRole('button', { name: /Add competitor/ }))
    expect(await within(form).findByRole('alert')).toHaveTextContent(/already exists/)
    expect(await repository.listCompetitors()).toHaveLength(1)
  })

  it('opens details, edits, then deletes after confirming', async () => {
    await repository.createCompetitor({ name: 'SAS', offerings: ['MDM'], certifications: ['ISO 27001'] })
    renderSection()
    await userEvent.click(await screen.findByRole('button', { name: 'View details for SAS' }))
    const details = await screen.findByRole('dialog', { name: 'SAS' })
    expect(within(details).getByRole('list', { name: 'SAS certifications' })).toHaveTextContent('ISO 27001')
    await userEvent.click(within(details).getByRole('button', { name: /Edit/ }))
    const form = await screen.findByRole('form', { name: 'Edit SAS' })
    const name = within(form).getByLabelText(/Competitor name/)
    await userEvent.clear(name)
    await userEvent.type(name, 'SAS Institute')
    await userEvent.click(within(form).getByRole('button', { name: /Save changes/ }))
    await screen.findByRole('article', { name: 'SAS Institute' })
    expect((await repository.listCompetitors())[0]).toMatchObject({ name: 'SAS Institute', offerings: ['MDM'] })

    const reopened = await screen.findByRole('dialog', { name: 'SAS Institute' })
    await userEvent.click(within(reopened).getByRole('button', { name: /Delete/ }))
    const confirm = await screen.findByRole('dialog', { name: 'Delete SAS Institute?' })
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('No competitors yet')).toBeInTheDocument()
    expect(await repository.listCompetitors()).toHaveLength(0)
  })

  it('searches by name, category or offering', async () => {
    await seedThree()
    renderSection()
    const search = await screen.findByRole('searchbox', { name: 'Search competitors' })
    await userEvent.type(search, 'integration')
    expect(names()).toEqual(['Informatica'])
    await userEvent.clear(search)
    await userEvent.type(search, 'analytics')
    expect(names()).toEqual(['SAS'])
    await userEvent.clear(search)
    await userEvent.type(search, 'oracle')
    expect(screen.getByText(/No competitors match/)).toBeInTheDocument()
  })

  it('filters with dropdowns, shows active chips and clears them', async () => {
    await seedThree()
    renderSection()
    await userEvent.click(await screen.findByRole('button', { name: 'Vertical' }))
    await userEvent.click(within(screen.getByRole('group', { name: 'Vertical options' })).getByLabelText('BFSI'))
    expect(names()).toEqual(['IBM', 'SAS'])
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'Relationship Status' }))
    await userEvent.click(within(screen.getByRole('group', { name: 'Relationship Status options' })).getByLabelText('Partner'))
    expect(names()).toEqual(['IBM'])
    await userEvent.keyboard('{Escape}')
    const chips = screen.getByRole('list', { name: 'Active filters' })
    expect(chips).toHaveTextContent('Relationship: Partner')
    expect(screen.getByText('2 active filters')).toBeInTheDocument()
    await userEvent.click(within(chips).getByRole('button', { name: 'Remove Relationship filter' }))
    expect(names()).toEqual(['IBM', 'SAS'])
    await userEvent.click(screen.getByRole('button', { name: /Clear all/ }))
    expect(names()).toHaveLength(3)
  })

  it('saves a filter set in this browser and re-applies it', async () => {
    await seedThree()
    renderSection()
    await userEvent.click(await screen.findByRole('button', { name: /Certifications/ }))
    await userEvent.click(within(screen.getByRole('group', { name: 'Certifications options' })).getByLabelText('ISO 27001'))
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: /Save Filter Set/ }))
    await userEvent.type(await screen.findByLabelText('Filter set name'), 'Certified')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(JSON.parse(localStorage.getItem('goms.competitors.filterSets') ?? '[]')).toMatchObject([{ name: 'Certified' }])
    await userEvent.click(screen.getByRole('button', { name: /Clear all/ }))
    expect(names()).toHaveLength(3)
    await userEvent.click(screen.getByRole('button', { name: 'Saved filter sets' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Certified' }))
    expect(names()).toEqual(['SAS'])
  })

  it('sorts by company and relationship', async () => {
    await seedThree()
    renderSection()
    await screen.findAllByRole('article')
    expect(names()).toEqual(['IBM', 'Informatica', 'SAS'])
    await userEvent.click(screen.getByRole('button', { name: 'Sort by Company' }))
    expect(names()).toEqual(['SAS', 'Informatica', 'IBM'])
    await userEvent.click(screen.getByRole('button', { name: 'Sort by Relationship Status' }))
    expect(names()).toEqual(['SAS', 'Informatica', 'IBM'])
    await userEvent.click(screen.getByRole('button', { name: 'Sort by Relationship Status' }))
    expect(names()).toEqual(['IBM', 'Informatica', 'SAS'])
  })
})
