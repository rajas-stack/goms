import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BID_STAGE_MAP, type InsightRecord } from '@goms/domain'
import { Dialog } from '@/components/ui/Dialog'
import { Icon } from '@/components/ui/Icon'
import { EmptyChart, money } from './InsightCharts'

export const STATUS: Record<string, string> = { onTrack: 'On Track', overdue: 'Overdue', dueSoon: 'Due Soon', corrigendumPending: 'Review Pending' }
export const bidUrl = (id: string, tab = 'overview') => `/live-bids/bid/${encodeURIComponent(id)}?tab=${tab}`
export function Segment({ options, value, onChange, label }: { options: string[]; value: string; onChange: (v: string) => void; label: string }) {
  return <div className="insight-segment" role="group" aria-label={label}>{options.map(option => <button key={option} type="button" aria-pressed={option === value} onClick={() => onChange(option)}>{option}</button>)}</div>
}
export function RecentTable({ rows, onActions, onOpen }: { rows: InsightRecord[]; onActions: (row: InsightRecord) => void; onOpen?: (row: InsightRecord) => void }) {
  return rows.length ? <div className="insight-table-wrap"><table className="insight-table"><thead><tr><th>Opportunity</th><th>Department</th><th>Value</th><th>Stage</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
    {rows.map(row => <tr key={row.id}>
      <td>{onOpen ? <button className="insight-record-button insight-record-name" onClick={() => onOpen(row)}><Icon name="BriefcaseBusiness" size={13}/><span>{row.name}</span></button> : <Link className="insight-record-name" to={bidUrl(row.id)}><Icon name="BriefcaseBusiness" size={13}/><span>{row.name}</span></Link>}</td>
      <td title={row.department}>{row.department}</td><td>{row.valueCr === null ? 'Not recorded' : money(row.valueCr)}</td><td>{BID_STAGE_MAP[row.stageKey]?.label ?? row.stageKey}</td>
      <td>{onOpen ? <button onClick={() => onOpen(row)} className={`insight-status insight-status-${row.attentionFlag}`}>{STATUS[row.attentionFlag]}</button> : <Link to={bidUrl(row.id)} className={`insight-status insight-status-${row.attentionFlag}`}>{STATUS[row.attentionFlag]}</Link>}</td>
      <td><button title="Opportunity actions" aria-label={`Actions for ${row.name}`} onClick={() => onActions(row)} className="insight-icon-button"><Icon name="EllipsisVertical" size={15}/></button></td>
    </tr>)}
  </tbody></table></div> : <EmptyChart/>
}
export function DetailList({ title, records, onClose, onActions, onOpen }: { title: string; records: InsightRecord[]; onClose: () => void; onActions: (row: InsightRecord) => void; onOpen?: (row: InsightRecord) => void }) {
  const [search, setSearch] = useState(''), [page, setPage] = useState(0)
  const filtered = records.filter(r => `${r.name} ${r.department}`.toLowerCase().includes(search.toLowerCase()))
  const pages = Math.max(1, Math.ceil(filtered.length / 25))
  return <Dialog open onClose={onClose} title={title} size="xl"><div className="insight-drill"><input aria-label="Search opportunity details" placeholder="Search opportunities..." value={search} onChange={e => { setSearch(e.target.value); setPage(0) }}/><RecentTable rows={filtered.slice(page * 25, page * 25 + 25)} onActions={onActions} onOpen={onOpen}/><footer><span>{filtered.length} opportunities</span><button aria-label="Previous page" disabled={page === 0} onClick={() => setPage(p => p - 1)}><Icon name="ChevronLeft"/></button><span>{page + 1} / {pages}</span><button aria-label="Next page" disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)}><Icon name="ChevronRight"/></button></footer></div></Dialog>
}
