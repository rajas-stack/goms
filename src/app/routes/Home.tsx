import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { BID_STAGE_MAP } from '@goms/domain'
import { useBidActionQueue, useInsights, useOrgPeople, useSalesPersons, useStates } from '@/lib/api'
import { Icon } from '@/components/ui/Icon'
import { useAuthUser } from '@/lib/auth'
import { useCanReadAny } from '@/lib/permissions'
import { useNodeFilter } from '@/lib/rbacTree/access'
import { NAV_MODULES } from '@/lib/routeModules'
import { isBidTrackerEnabled } from '@/modules/bid-tracker/enabled'
import { useBoqs } from '@/modules/commercial-calculator/api'
import { useMakerDocuments } from '@/modules/document-maker/api'
import { INDIA_STATES } from '@/features/home/indiaStates'
import {
  attentionRows, attentionSummary, crore, firstNameOf, greetingFor, initials, longDay, shortDay, todayIso, type AttentionRow,
} from '@/features/home/homeData'
import '@/features/home/home.css'

const MAX_ATTENTION_ROWS = 6
const TONE_LABEL = { overdue: 'Overdue', soon: 'Due soon', waiting: 'Waiting' } as const
const DEPARTMENT_COLORS = ['var(--teal)', 'var(--ochre)', 'var(--blue-d)'] as const
const FILE_CHIP: Record<string, { bg: string; fg: string }> = {
  xlsx: { bg: 'var(--sage-t)', fg: 'var(--sage)' },
  docx: { bg: 'var(--blue-t)', fg: 'var(--blue)' },
  pdf: { bg: 'var(--red-t)', fg: 'var(--red)' },
}

/** The home page: what needs the person today, then one card per module they can open, with a few live numbers beside it.
 *  Everything shown comes from the app's own data, and every module's block appears only if that person can read it. */
export function Home() {
  const now = useMemo(() => new Date(), [])
  const today = todayIso(now)
  const { user } = useAuthUser()
  const tree = useNodeFilter()
  const canMap = useCanReadAny(NAV_MODULES.accountMapping) && tree('accountMapping')
  const canCommercial = useCanReadAny(NAV_MODULES.commercial) && tree('commercial')
  const mayReadOpportunity = useCanReadAny(NAV_MODULES.opportunity)
  const canOpportunity = isBidTrackerEnabled() && mayReadOpportunity && tree('opportunity')
  const canDocuments = tree('documentMaker')
  const canInsights = useCanReadAny(NAV_MODULES.insights) && tree('accountMapping.insights')
  const canTeams = useCanReadAny(NAV_MODULES.teams) && tree('teams')

  const states = useStates()
  const queue = useBidActionQueue()
  const boqs = useBoqs()
  const documents = useMakerDocuments()
  const org = useOrgPeople()
  const salesPeople = useSalesPersons()
  const insights = useInsights({ months: 6 }, canInsights || canOpportunity)

  const coveredCodes = useMemo(() => new Set((states.data ?? []).filter((s) => s.offices > 0 || s.employees > 0).map((s) => s.code)), [states.data])
  const coveredCount = INDIA_STATES.filter((s) => coveredCodes.has(s.code)).length
  const totalStates = INDIA_STATES.length

  const attention = useMemo(
    () => attentionRows(queue.data ?? [], boqs.data ?? [], today, { opportunity: canOpportunity, commercial: canCommercial }),
    [queue.data, boqs.data, today, canOpportunity, canCommercial],
  )
  const attentionLoading = (canOpportunity && queue.isLoading) || (canCommercial && boqs.isLoading)
  const personName = useMemo(() => new Map((salesPeople.data ?? []).map((p) => [p.id, p.name])), [salesPeople.data])

  const boqList = boqs.data ?? []
  const approvedBoqs = boqList.filter((b) => b.status === 'approved').length
  const openBoqs = boqList.filter((b) => b.status === 'draft' || b.status === 'submitted' || b.status === 'under_review').length

  const insight = insights.data
  const openStages = (insight?.stages ?? []).filter((g) => g.count > 0 && !BID_STAGE_MAP[g.key]?.closed)
  const trend = insight?.trend ?? []
  const pipelineValue = insight?.metrics.pipeline ?? 0

  const docs = [...(documents.data ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const people = (org.data ?? []).filter((p) => p.status === 'active')
  const byDepartment = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of people) counts.set(p.departments[0] ?? 'Other', (counts.get(p.departments[0] ?? 'Other') ?? 0) + 1)
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3)
  }, [people])

  const first = firstNameOf(user?.displayName, user?.email)
  const showAside = canInsights || canDocuments || canTeams
  const anyModule = canMap || canCommercial || canOpportunity || canDocuments || canInsights || canTeams

  return (
    <div className="hm h-full overflow-y-auto scrollbar-thin">
      <div className="hm-layout">
        <main className="hm-main">
          <section className="hm-top">
            <h1 className="hm-greet font-display">
              <span className="hm-date">{longDay(now)}</span> <span className="hm-sep">·</span> {greetingFor(now)}{first ? `, ${first}` : ''}
            </h1>
            {attention.length > 0 && <p className="hm-sub">{attention.length === 1 ? '1 item needs' : `${attention.length} items need`} you today.</p>}
          </section>

          {(canOpportunity || canCommercial) && (
            <section className="hm-panel hm-att" aria-labelledby="hm-att-h">
              <div className="hm-head">
                <h2 className="hm-h2" id="hm-att-h">Needs attention</h2>
                <span className="hm-count">{attentionSummary(attention)}</span>
              </div>
              {attentionLoading ? <p className="hm-empty" role="status">Checking…</p>
                : attention.length === 0 ? <p className="hm-empty">Nothing needs you today.</p>
                : attention.slice(0, MAX_ATTENTION_ROWS).map((row) => <AttentionItem key={row.key} row={row} assignee={row.assigneeId ? personName.get(row.assigneeId) : undefined} />)}
              {attention.length > MAX_ATTENTION_ROWS && <p className="hm-count" style={{ padding: '10px 0 14px', borderTop: '1px solid var(--line2)' }}>and {attention.length - MAX_ATTENTION_ROWS} more</p>}
            </section>
          )}

          {anyModule ? (
            <section className="hm-apps" aria-labelledby="hm-apps-h">
              <div className="hm-head">
                <h2 className="hm-h2" id="hm-apps-h">The app</h2>
                <span className="hm-count">{[canMap, canCommercial, canOpportunity, canDocuments, canInsights, canTeams].filter(Boolean).length} modules</span>
              </div>
              <div className="hm-grid">
                {canMap && (
                  <ModuleCard to="/map" name="Account Mapping" desc="Offices by state and department" tone="teal" icon="Map" foot={`${coveredCount} of ${totalStates} states`}>
                    <div className="hm-dots" aria-hidden="true">
                      {[...INDIA_STATES].sort((a, b) => Number(coveredCodes.has(b.code)) - Number(coveredCodes.has(a.code))).map((s) => <i key={s.code} className={coveredCodes.has(s.code) ? 'on' : undefined} />)}
                    </div>
                  </ModuleCard>
                )}
                {canCommercial && (
                  <ModuleCard to="/commercial-calculator" name="Commercial Calculator" desc="Pricing, BOQs and approvals" tone="ochre" icon="Calculator" foot={`${openBoqs} open BOQ${openBoqs === 1 ? '' : 's'}`}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div className="hm-small" style={{ display: 'flex', justifyContent: 'space-between' }}><span>{approvedBoqs} of {boqList.length} approved</span><span>{boqList.length ? Math.round((approvedBoqs / boqList.length) * 100) : 0}%</span></div>
                      <div className="hm-track"><div style={{ width: `${boqList.length ? (approvedBoqs / boqList.length) * 100 : 0}%` }} /></div>
                    </div>
                  </ModuleCard>
                )}
                {canOpportunity && (
                  <ModuleCard to="/bid-tracker" name="Opportunity" desc="Tender and bid tracking, through to award" tone="blue" icon="Briefcase" foot={`${insight?.metrics.active ?? 0} open bids`}>
                    {openStages.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div className="hm-stages" aria-hidden="true">{openStages.map((g, i) => <i key={g.key} style={{ flex: g.count, opacity: 0.35 + (0.65 * i) / Math.max(1, openStages.length - 1) }} />)}</div>
                        <div className="hm-small">{openStages.slice(0, 3).map((g) => `${g.label} ${g.count}`).join(' · ')}</div>
                      </div>
                    ) : <div className="hm-small">No open bids yet</div>}
                  </ModuleCard>
                )}
                {canDocuments && (
                  <ModuleCard to="/document-maker" name="Document maker" desc="Proposals, letters and annexures" tone="indigo" icon="FilePenLine" foot={`${docs.length} file${docs.length === 1 ? '' : 's'}`}>
                    <div className="hm-docs" aria-hidden="true">{docs.slice(0, 3).map((d, i) => <i key={d.id} style={i === 2 ? { opacity: 0.5 } : undefined} />)}</div>
                  </ModuleCard>
                )}
                {canInsights && (
                  <ModuleCard to="/insights" name="Insights" desc="Pipeline and win-rate analytics" tone="plum" icon="BarChart3" foot={`${crore(pipelineValue)} pipeline`}>
                    <Sparkline values={trend.map((t) => t.value)} />
                  </ModuleCard>
                )}
                {canTeams && (
                  <ModuleCard to="/teams" name="Teams" desc="Org chart, rosters and headcount" tone="sage" icon="Users" foot={`${people.length} people`}>
                    <div className="hm-stack" aria-hidden="true">{people.slice(0, 5).map((p) => <span key={p.id}>{initials(p.name)}</span>)}</div>
                  </ModuleCard>
                )}
              </div>
            </section>
          ) : (
            <p className="hm-empty hm-panel" style={{ padding: 24 }}>You do not have access to any module yet. Ask a System Admin to give your role access.</p>
          )}
        </main>

        {showAside && (
          <aside className="hm-aside" aria-label="Summary">
            <div className="hm-panel hm-sidepanel">
              {canInsights && (
                <div className="hm-sect">
                  <div className="hm-head"><span className="hm-eyebrow">Pipeline</span><span className="hm-count">₹ Cr</span></div>
                  {trend.length > 0 ? (
                    <div className="hm-bars" role="img" aria-label={`Opportunity value taken in per month, ${trend.map((t) => `${t.label}: ${Math.round(t.value)} crore`).join(', ')}`}>
                      {trend.slice(-6).map((t, i, all) => {
                        const peak = Math.max(...all.map((x) => x.value), 1)
                        return <div key={t.key} className={`hm-bar${i === all.length - 1 ? ' cur' : ''}`}><div style={{ height: `${Math.max(3, (t.value / peak) * 108)}px` }} /><span>{t.label.slice(0, 3)}</span></div>
                      })}
                    </div>
                  ) : <p className="hm-small">No pipeline data yet.</p>}
                </div>
              )}
              {canDocuments && (
                <div className="hm-sect" style={{ gap: 4 }}>
                  <span className="hm-eyebrow" style={{ paddingBottom: 8 }}>Recent documents</span>
                  {docs.length === 0 ? <p className="hm-small" style={{ borderTop: '1px solid var(--line2)', paddingTop: 10 }}>No documents yet.</p>
                    : docs.slice(0, 3).map((d) => {
                      const chip = FILE_CHIP[d.fileType] ?? { bg: 'var(--indigo-t)', fg: 'var(--indigo)' }
                      return (
                        <Link key={d.id} to="/document-maker" className="hm-doc">
                          <span className="hm-chip" style={{ background: chip.bg, color: chip.fg }}>{d.fileType}</span>
                          <div style={{ flex: 1, minWidth: 0 }}><div className="hm-doctitle">{d.title}</div><div className="hm-small" style={{ fontSize: 12 }}>{shortDay(d.updatedAt)}</div></div>
                        </Link>
                      )
                    })}
                </div>
              )}
              {canTeams && (
                <div className="hm-sect">
                  <span className="hm-eyebrow">Team</span>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}><span className="hm-big">{people.length}</span><span style={{ fontSize: 13, color: 'var(--muted)' }}>headcount</span></div>
                  {byDepartment.length > 0 && <>
                    <div className="hm-split" aria-hidden="true">{byDepartment.map(([name, n], i) => <i key={name} style={{ flex: n, background: DEPARTMENT_COLORS[i] }} />)}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{byDepartment.map(([name, n]) => `${name} ${n}`).join(' · ')}</div>
                  </>}
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}

function AttentionItem({ row, assignee }: { row: AttentionRow; assignee?: string }) {
  return (
    <Link to={row.href} className="hm-row">
      <span className={`hm-pill hm-pill--${row.tone}`}><i />{TONE_LABEL[row.tone]}</span>
      <div style={{ minWidth: 0 }}>
        <div className="hm-eyebrow">{row.module}</div>
        <div className="hm-rowtext">{row.text}</div>
      </div>
      <span className="hm-avatar" aria-label={assignee ? `Assigned to ${assignee}` : undefined} title={assignee} style={assignee ? undefined : { visibility: 'hidden' }}>{assignee ? initials(assignee) : ''}</span>
      <span className={`hm-due${row.tone === 'overdue' ? ' hm-due--overdue' : ''}`}>{row.dueDate ? shortDay(row.dueDate) : '—'}</span>
    </Link>
  )
}

const TONES = {
  teal: ['var(--teal-t)', 'var(--teal)'], ochre: ['var(--ochre-t)', 'var(--ochre)'], blue: ['var(--blue-t)', 'var(--blue)'],
  indigo: ['var(--indigo-t)', 'var(--indigo)'], plum: ['var(--plum-t)', 'var(--plum)'], sage: ['var(--sage-t)', 'var(--sage)'],
} as const

/** `icon` is the same lucide name the left rail uses for that module, so the two always match. */
function ModuleCard({ to, name, desc, tone, icon, foot, children }: {
  to: string; name: string; desc: string; tone: keyof typeof TONES; icon: string; foot: string; children: ReactNode
}) {
  return (
    <Link to={to} className="hm-card">
      <div className="hm-cardhead">
        <span className="hm-icon" style={{ background: TONES[tone][0], color: TONES[tone][1] }}>
          <Icon name={icon} size={18} />
        </span>
        <span className="hm-cardname">{name}</span>
      </div>
      <div className="hm-carddesc">{desc}</div>
      {children}
      <div className="hm-foot">{foot}</div>
    </Link>
  )
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <div className="hm-small">Not enough data yet</div>
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1
  const points = values.map((v, i) => `${(i / (values.length - 1)) * 160},${34 - ((v - lo) / span) * 28}`).join(' ')
  return <svg className="hm-spark" viewBox="0 0 160 40" preserveAspectRatio="none" aria-hidden="true"><polyline points={points} /></svg>
}
