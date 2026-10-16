import { BID_STAGES, computeAttentionFlag, type InsightRecord } from '@goms/domain'

const departments = ['ITE&C', 'Revenue', 'Rural Development', 'Urban Development', 'Health', 'Education', 'Transport', 'Energy', 'Water Resources', 'Municipal Administration']
const states = [27, 36, 10, 9, 23, 29, 24, 33, 21, 8]
const verticals = ['E-Governance', 'Data & AI', 'IT Services', 'Citizen Services', 'Smart Mobility']
const projects = ['Citizen Data Platform', 'Urban Observatory', 'State Data Lakehouse', 'Welfare Management', 'Transit Intelligence', 'Revenue Portal', 'Smart Grid', 'GIS Logistics', 'Rural Services', 'Cloud Platform', 'Transport Analytics', 'Digital Health Exchange']
const owners = ['Aarav Shah', 'Meera Nair', 'Rohan Verma', 'Isha Rao']
const presales = ['Ananya Desai', 'Vikram Joshi', 'Neha Patel']
const teams = ['Kabir Sharma', 'Diya Menon', 'Arjun Singh']
const rivals = ['Example Systems', 'Northstar Digital', 'Civic Technology', 'Vertex Solutions', 'Horizon Analytics']

/** Read-only, deterministic sample records. Never written to a repository or mixed with live rows. */
export function createInsightDemoRecords(today = new Date().toISOString().slice(0, 10)): InsightRecord[] {
  const now = new Date(`${today}T00:00:00Z`)
  const date = (monthOffset: number, day: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, day)).toISOString().slice(0, 10)
  const dueDate = (days: number) => new Date(now.getTime() + days * 86400000).toISOString()
  return Array.from({ length: 192 }, (_, index): InsightRecord => {
    const month = Math.floor(index / 8), slot = index % 8, stage = BID_STAGES[(index + month) % BID_STAGES.length]
    const closed = stage.closed, won = stage.key === 'goApproved'
    const dueAt = closed || index % 17 === 0 ? null : dueDate([-14, 1, 2, 30, 90, 180, 270, 365][slot])
    return {
      id: `insights-demo-bid-${index}`, opportunityId: `insights-demo-opportunity-${index}`,
      name: index === 0 ? 'AI Sangrah - 2nd call' : `${projects[(index + month) % projects.length]} ${now.getUTCFullYear() - Math.floor(month / 12)}-${String(index + 1).padStart(3, '0')}`,
      department: index === 0 ? 'Gujarat Informatics Ltd.(GIL)' : departments[index % departments.length],
      stateCode: index === 0 ? 24 : index % 23 === 0 ? 0 : states[index % states.length], vertical: verticals[(index + month) % verticals.length],
      stageKey: stage.key, opportunityStageKey: closed ? won ? 'won' : index % 2 ? 'lost' : 'dropped' : ['pipeline', 'qualified', 'submitted'][index % 3],
      sheet: 'bidTracker', status: 'active',
      attentionFlag: closed ? 'onTrack' : computeAttentionFlag({ dueAt: index === 0 ? dueDate(-7) : dueAt, hasPendingCorrigendum: index % 11 === 0 && index !== 0, today }),
      createdAt: date(-month, index === 0 ? now.getUTCDate() : Math.min(now.getUTCDate(), slot + 1)),
      closedOn: closed ? date(-Math.max(0, month - 1), Math.min(now.getUTCDate(), 12)) : null,
      dueAt: index === 0 ? dueDate(-7) : dueAt,
      valueCr: index === 0 ? 70 : index % 29 === 0 ? null : Number(((2.5 + (index * 7 % 37) / 2) * (month < 12 ? 1.2 : .85)).toFixed(2)),
      owner: owners[(index + month) % owners.length], presales: presales[index % presales.length], team: teams[(index + 1) % teams.length],
      competitors: index === 0 ? rivals.slice(0, 2) : index % 4 === 0 ? [] : index % 3 === 0 ? [rivals[index % rivals.length], rivals[(index + 2) % rivals.length]] : [rivals[index % rivals.length]],
    }
  })
}
