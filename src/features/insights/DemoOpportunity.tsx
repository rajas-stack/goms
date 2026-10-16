import { useState } from 'react'
import { BID_STAGE_MAP, PIPELINE_STAGE_MAP, type InsightRecord } from '@goms/domain'
import { Dialog } from '@/components/ui/Dialog'
import { money, stateName } from './InsightCharts'
import { Segment, STATUS } from './InsightTables'
import { PersonName } from '@/components/ui/PersonName'

export function DemoOpportunity({ record, onClose }: { record: InsightRecord; onClose: () => void }) {
  const [section, setSection] = useState('Overview')
  const fields = section === 'Overview' ? [
    ['Department', record.department], ['State', stateName(String(record.stateCode))],
    ['Bid stage', BID_STAGE_MAP[record.stageKey]?.label ?? record.stageKey], ['Status', STATUS[record.attentionFlag]],
    ['Value', record.valueCr === null ? 'Not recorded' : money(record.valueCr)], ['Next due date', record.dueAt?.slice(0, 10) ?? 'Unscheduled'],
  ] : [
    ['Vertical', record.vertical], ['Opportunity stage', PIPELINE_STAGE_MAP[record.opportunityStageKey]?.label ?? record.opportunityStageKey],
    ['Sales owner', record.owner], ['Presales', record.presales], ['Bid team', record.team],
    ['Created', record.createdAt], ['Closed', record.closedOn ?? 'Open'],
  ]
  return <Dialog open title={record.name} description="Sample data" size="lg" onClose={onClose}><div className="insight-demo-preview">
    <Segment label="Sample opportunity sections" options={['Overview', 'General', 'Competition']} value={section} onChange={setSection}/>
    {section === 'Competition' ? <ul aria-label="Sample competitors">{record.competitors.length ? record.competitors.map(name => <li key={name}>{name}</li>) : <li>No competition recorded</li>}</ul> : <dl>{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{label === 'Status' ? <span className={`insight-status insight-status-${record.attentionFlag}`}>{value}</span> : ['Sales owner', 'Presales', 'Bid team'].includes(label) ? <PersonName person={{ name: value, photoUrl: label === 'Sales owner' ? record.ownerPhotoUrl : label === 'Presales' ? record.presalesPhotoUrl : record.teamPhotoUrl }}/> : value}</dd></div>)}</dl>}
  </div></Dialog>
}
