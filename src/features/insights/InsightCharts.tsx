import { useEffect, useId, useRef, type ReactNode } from 'react'
import { geoMercator, geoPath } from 'd3-geo'
import type { FeatureCollection } from 'geojson'
import india from '@/assets/india-states.json'
import type { InsightGroup, InsightTrend } from '@goms/domain'
import { motion } from 'framer-motion'
import { chartSpring, useChartInteraction } from './chartInteraction'
import { ChartMaterial } from './ChartMaterial'
import './chartMotion.css'

export const COLORS = ['#155ad6', '#22b8ed', '#33b7a2', '#8d6be8', '#e6a237', '#6d829d']
export const money = (n: number) => `\u20b9${new Intl.NumberFormat('en-IN', { maximumFractionDigits: n > 0 && n < 1 ? 4 : 2 }).format(n)} Cr`
export const stateNames = new Map((india as FeatureCollection).features.map(f => [String(Number(f.properties?.st_code)), String(f.properties?.st_nm)]))
stateNames.set('0', 'Central Ministries'); stateNames.set('unassigned', 'Unassigned'); stateNames.set('__others', 'Others')
export const stateName = (key: string) => stateNames.get(key) ?? key
export function Frame({ title, actions, children, className = '' }: { title: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return <section aria-label={title} className={`insight-frame ${className}`}><header><h2>{title}</h2>{actions}</header>{children}</section>
}
export function EmptyChart() { return <div className="insight-empty">No matching records</div> }
export function Sparkline({ values, label = 'Trend', format = String, periods }: { values: number[]; label?: string; format?: (value: number) => string; periods?: string[] }) {
  const id = useId().replace(/:/g, '')
  const interaction = useChartInteraction(values)
  const ref = useRef<SVGSVGElement>(null)
  const controls = useRef({ interaction, values, label, format, periods })
  controls.current = { interaction, values, label, format, periods }
  useEffect(() => {
    const parent = ref.current?.closest('button')
    if (!parent || !interaction.active) return
    const before = parent.getAttribute('aria-describedby')
    parent.setAttribute('aria-describedby', [before, interaction.tooltipId].filter(Boolean).join(' '))
    return () => { if (before) parent.setAttribute('aria-describedby', before); else parent.removeAttribute('aria-describedby') }
  }, [interaction.active, interaction.tooltipId])
  useEffect(() => {
    const parent = ref.current?.closest('button')
    if (!parent) return
    let index = values.length - 1
    const show = () => {
      const { interaction: current, values: data, label: name, format: display, periods: dates } = controls.current
      index = Math.max(0, Math.min(index, data.length - 1))
      const mark = ref.current?.querySelector(`[data-spark-index="${index}"]`)
      if (mark && data.length) current.show(String(index), mark, { title: name, rows: [['Period', dates?.[index] ?? String(index + 1)], ['Value', display(data[index])]] })
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') controls.current.interaction.clear()
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      e.preventDefault(); index += e.key === 'ArrowLeft' ? -1 : 1; show()
    }
    const clear = () => controls.current.interaction.clear()
    parent.addEventListener('focus', show); parent.addEventListener('keydown', key); parent.addEventListener('blur', clear)
    return () => { parent.removeEventListener('focus', show); parent.removeEventListener('keydown', key); parent.removeEventListener('blur', clear) }
  }, [])
  const max = Math.max(1, ...values), width = 120, height = 48
  const points = values.map((v, i) => `${i * width / Math.max(values.length - 1, 1)},${height - 4 - v / max * (height - 8)}`).join(' ')
  return <><svg ref={ref} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label} trend`} className="insight-spark"><ChartMaterial id={id} color="#2366dc"/><polygon points={`0,${height} ${points} ${width},${height}`} fill={`url(#${id}-area)`}/><polyline points={points} fill="none" stroke={`url(#${id}-surface)`} strokeWidth="2" className="insight-material-line"/><polyline points={points} fill="none" stroke={`url(#${id}-sheen)`} strokeWidth=".7" className="insight-material-reflection"/>
    {values.map((v, i) => <g key={i} data-spark-index={i} {...interaction.bind(String(i), { title: label, rows: [['Period', periods?.[i] ?? String(i + 1)], ['Value', format(v)]] })} onClick={e => e.stopPropagation()}>
      <rect x={i * width / Math.max(values.length - 1, 1) - 5} y="0" width="10" height={height} fill="transparent"/>
      {interaction.active === String(i) && <motion.circle cx={i * width / Math.max(values.length - 1, 1)} cy={height - 4 - v / max * (height - 8)} r="3" fill="#155ad6" stroke="#b6ddff" strokeWidth="3" initial={{ opacity: 0, scale: interaction.reduced ? 1 : 0 }} animate={{ opacity: 1, scale: 1 }} transition={chartSpring} style={{ transformBox: 'fill-box', transformOrigin: 'center' }}/>}</g>)}
  </svg>{interaction.tooltip}</>
}
export function Bars({ groups, onPick, count = false, labels = (g: InsightGroup) => g.label, limit = 7 }: {
  groups: InsightGroup[]; onPick: (g: InsightGroup) => void; count?: boolean; labels?: (g: InsightGroup) => string; limit?: number
}) {
  const interaction = useChartInteraction(groups)
  const visible = groups.slice(0, limit), rest = groups.slice(limit)
  if (rest.length) visible.push({ key: '__others', label: 'Others', value: rest.reduce((n, g) => n + g.value, 0), count: rest.reduce((n, g) => n + g.count, 0), ids: rest.flatMap(g => g.ids) })
  const maximum = Math.max(1, ...visible.map(g => count ? g.count : g.value)), total = groups.reduce((n, g) => n + (count ? g.count : g.value), 0)
  return groups.length ? <><div className="insight-bars">{visible.map((g, i) => <button type="button" key={g.key} {...interaction.bind(g.key, { title: labels(g), rows: [['Pipeline value', money(g.value)], ['Opportunities', String(g.count)]], color: COLORS[i % COLORS.length] })} onClick={() => onPick(g)}>
    <span className="insight-bar-label">{labels(g)}</span><span className="insight-bar-track"><span style={{ width: `${(count ? g.count : g.value) / maximum * 100}%`, background: COLORS[i % COLORS.length] }}/></span>
    <strong>{count ? g.count : money(g.value)}</strong><small>{total ? `${Math.round((count ? g.count : g.value) / total * 100)}%` : '0%'}</small>
  </button>)}</div>{interaction.tooltip}</> : <EmptyChart/>
}
function stageAxis(maximum: number, integer = false) {
  const target = (maximum || 1) * 1.12 / 4, magnitude = 10 ** Math.floor(Math.log10(target)), unit = target / magnitude
  const step = Math.max(integer ? 1 : 0, magnitude * (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10))
  const divisions = Math.max(1, Math.ceil((maximum || 1) * 1.12 / step))
  return { maximum: divisions * step, ticks: Array.from({ length: divisions + 1 }, (_, i) => Number((i * step).toPrecision(12))) }
}
export function StageChart({ groups, showValue, showCount, onPick, valueStages }: {
  groups: InsightGroup[]; showValue: boolean; showCount: boolean; onPick: (g: InsightGroup) => void; valueStages?: ReadonlySet<string>
}) {
  const interaction = useChartInteraction(groups)
  const id = useId().replace(/:/g, ''), values = stageAxis(Math.max(0, ...groups.map(g => g.value))), counts = stageAxis(Math.max(0, ...groups.map(g => g.count)), true)
  const left = 45, right = 687, bottom = 145, height = 112, cell = (right - left) / Math.max(1, groups.length)
  const valueY = (value: number) => bottom - value / values.maximum * height, countY = (value: number) => bottom - value / counts.maximum * height
  const hasValues = groups.some(g => !valueStages || valueStages.has(g.key)), primary = showValue && hasValues ? values : counts
  const tickY = (value: number) => bottom - value / primary.maximum * height
  const roundedBar = (x: number, y: number, width: number) => {
    const radius = Math.min(6, Math.max(0, (bottom - y) / 2))
    return `M${x},${bottom}V${y + radius}Q${x},${y} ${x + radius},${y}H${x + width - radius}Q${x + width},${y} ${x + width},${y + radius}V${bottom}Z`
  }
  return groups.length ? <><div className="insight-stage-scroll"><svg role="img" aria-label="Opportunity stage values and counts" viewBox="0 0 720 190" className="insight-stage-chart">
    <defs>
      <linearGradient id={`${id}-value`} x1="0" y1="0" x2=".25" y2="1"><stop stopColor="#438ede"/><stop offset=".28" stopColor="#1853aa"/><stop offset="1" stopColor="#031d5c"/></linearGradient>
      <linearGradient id={`${id}-count`} x1="0" y1="0" x2=".7" y2="1"><stop stopColor="#e6faff"/><stop offset=".35" stopColor="#b6edff"/><stop offset="1" stopColor="#55bcec"/></linearGradient>
      <linearGradient id={`${id}-shine`}><stop stopColor="white" stopOpacity=".3"/><stop offset=".2" stopColor="white" stopOpacity="0"/><stop offset="1" stopColor="white" stopOpacity="0"/></linearGradient>
    </defs>
    {primary.ticks.map(value => <g key={value}><line className="insight-stage-grid" x1={left} x2={right} y1={tickY(value)} y2={tickY(value)}/>{(!showValue || hasValues) && <text className="insight-stage-axis" x={left - 10} y={tickY(value) + 4} textAnchor="end">{new Intl.NumberFormat('en-IN', { maximumSignificantDigits: 3 }).format(value)}</text>}</g>)}
    {Array.from({ length: groups.length + 1 }, (_, i) => <line key={i} className="insight-stage-grid insight-stage-grid-vertical" x1={left + i * cell} x2={left + i * cell} y1="24" y2={bottom}/>)}
    {showCount && showValue && counts.ticks.map(value => <text key={value} className="insight-stage-axis insight-stage-count-tick" x={right + 10} y={countY(value) + 4}>{value}</text>)}
    <line className="insight-stage-baseline" x1={left} x2={right} y1={bottom} y2={bottom}/>
    {groups.map((g, i) => {
      const available = !valueStages || valueStages.has(g.key), label = available ? money(g.value) : 'Not recorded'
      const width = Math.min(40, cell * .36), pairWidth = showValue && showCount ? width * 2 - 3 : width
      const center = left + cell * (i + .5), x = center - pairWidth / 2, countX = x + (showValue ? width - 3 : 0)
      const labelY = Math.min(showValue && available ? valueY(g.value) : bottom, showCount ? countY(g.count) : bottom) - 10
      return <g key={g.key} role="button" tabIndex={0} {...interaction.bind(g.key, { title: g.label, rows: [['Pipeline value', label], ['Opportunities', String(g.count)]] })} aria-label={`${g.label}: ${label}, ${g.count} opportunities`} onClick={() => onPick(g)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(g) } }} className="insight-chart-pick insight-stage-group">
        <rect x={left + i * cell} y="15" width={cell} height="173" fill="transparent"/>
        <motion.g initial={false} animate={{ scale: interaction.active === g.key && !interaction.reduced ? 1.04 : 1 }} transition={chartSpring} style={{ transformBox: 'fill-box', transformOrigin: 'center bottom', pointerEvents: 'none' }}>
        {showCount && <path data-series="count" d={roundedBar(countX, countY(g.count), width)} fill={`url(#${id}-count)`} stroke="#b1e5fa" strokeWidth=".7"/>}
        {showValue && available && g.value > 0 && <><path data-series="value" d={roundedBar(x, valueY(g.value), width)} fill={`url(#${id}-value)`} stroke="#7ca7dd" strokeWidth=".7"/><path d={roundedBar(x, valueY(g.value), width)} fill={`url(#${id}-shine)`} pointerEvents="none"/></>}
        </motion.g><text x={center} y={labelY} textAnchor="middle" className={`insight-stage-value-label${showValue && !available ? ' insight-stage-unpriced' : ''}`}>{showValue ? label : g.count}</text>
        <text x={center} y="165" textAnchor="middle" className="insight-stage-name">{g.label.split(' ').map((word, n) => <tspan key={n} x={center} dy={n ? 12 : 0}>{word}</tspan>)}</text>
      </g>
    })}
  </svg></div>{interaction.tooltip}</> : <EmptyChart/>
}
export function DonutChart({ groups, onPick }: { groups: InsightGroup[]; onPick: (g: InsightGroup) => void }) {
  const interaction = useChartInteraction(groups)
  const materialId = useId().replace(/:/g, '')
  const total = groups.reduce((n, g) => n + g.value, 0), circumference = 2 * Math.PI * 66
  let offset = 0
  return groups.length ? <div className="insight-donut-layout"><svg viewBox="0 0 176 176" role="img" aria-label={`Pipeline by vertical: ${money(total)}`}>
    {groups.map((g, i) => <ChartMaterial key={g.key} id={`${materialId}-${i}`} color={COLORS[i % COLORS.length]}/>)}
    <circle cx="88" cy="88" r="66" fill="none" stroke="var(--insight-line)" strokeWidth="22"/>
    {groups.map((g, i) => {
      const length = total ? g.value / total * circumference : 0, start = offset; offset += length
      const angle = (start + length / 2) / circumference * Math.PI * 2 - Math.PI / 2, active = interaction.active === g.key && !interaction.reduced
      const arc = { cx: 88, cy: 88, r: 66, fill: 'none', strokeDasharray: `${Math.max(0, length - 1)} ${circumference}`, strokeDashoffset: -start, transform: 'rotate(-90 88 88)' }
      return <g key={g.key} className="insight-chart-pick insight-donut-segment" {...interaction.bind(g.key, { title: g.label, rows: [['Pipeline value', money(g.value)], ['Opportunities', String(g.count)]], color: COLORS[i % COLORS.length] })} onClick={() => onPick(g)}>
        <circle {...arc} className="insight-hit" stroke="transparent" strokeWidth="32"/>
        <motion.g initial={false} animate={{ x: active ? Math.cos(angle) * 5 : 0, y: active ? Math.sin(angle) * 5 : 0 }} transition={chartSpring} pointerEvents="none">
          <circle {...arc} stroke={`url(#${materialId}-${i}-surface)`} strokeWidth="22"/>
          <circle {...arc} stroke={`url(#${materialId}-${i}-sheen)`} strokeWidth="20" className="insight-material-reflection"/>
        </motion.g>
      </g>
    })}
    <text x="88" y="87" textAnchor="middle" className="insight-donut-total">{money(total)}</text><text x="88" y="105" textAnchor="middle">Total pipeline</text>
  </svg><div className="insight-donut-legend">{groups.map((g, i) => <button key={g.key} {...interaction.bind(g.key, { title: g.label, rows: [['Pipeline value', money(g.value)], ['Opportunities', String(g.count)]], color: COLORS[i % COLORS.length] })} onClick={() => onPick(g)}><i style={{ background: COLORS[i % COLORS.length] }}/><span>{g.label}</span><small>{total ? Math.round(g.value / total * 100) : 0}%</small><strong>{money(g.value)}</strong></button>)}</div>{interaction.tooltip}</div> : <EmptyChart/>
}
export function TrendChart({ data, count, onPick }: { data: InsightTrend[]; count: boolean; onPick: (key: string, kind: 'new' | 'won' | 'lost') => void }) {
  const interaction = useChartInteraction(data)
  const materialId = useId().replace(/:/g, '')
  const series = [{ label: 'New Opportunities', key: count ? 'count' : 'value', kind: 'new', color: COLORS[0] }, { label: 'Closed (Won)', key: count ? 'wonCount' : 'wonValue', kind: 'won', color: COLORS[1] }, { label: 'Closed (Lost)', key: count ? 'lostCount' : 'lostValue', kind: 'lost', color: COLORS[3] }] as const
  const max = Math.max(1, ...data.flatMap(d => series.map(s => d[s.key])))
  const x = (i: number) => 38 + i * 560 / Math.max(data.length - 1, 1), y = (n: number) => 166 - n / max * 125
  return <><div className="insight-chart-legend">{series.map(s => <span key={s.key}><i style={{ background: s.color }}/>{s.label}</span>)}</div>
    <svg role="img" aria-label={`Opportunity trend by ${count ? 'count' : 'value'}`} viewBox="0 0 640 200" className="insight-trend-chart">
      {series.map(s => <ChartMaterial key={s.kind} id={`${materialId}-${s.kind}`} color={s.color}/>)}
      {[0, 1, 2, 3, 4].map(i => <g key={i}><line x1="38" x2="600" y1={y(max * i / 4)} y2={y(max * i / 4)} stroke="var(--insight-line)"/><text x="30" y={y(max * i / 4) + 4} textAnchor="end">{(max * i / 4).toFixed(count ? 0 : 1)}</text></g>)}
      {series.map(s => <g key={s.key}><polygon className="insight-trend-area insight-material-area" points={`38,166 ${data.map((d, i) => `${x(i)},${y(d[s.key])}`).join(' ')} ${x(data.length - 1)},166`} fill={`url(#${materialId}-${s.kind}-area)`} opacity={interaction.active?.endsWith(`:${s.kind}`) ? 1 : .7}/><polyline points={data.map((d, i) => `${x(i)},${y(d[s.key])}`).join(' ')} fill="none" stroke={`url(#${materialId}-${s.kind}-surface)`} strokeWidth="2.5" className="insight-material-line"/><polyline points={data.map((d, i) => `${x(i)},${y(d[s.key])}`).join(' ')} fill="none" stroke={`url(#${materialId}-${s.kind}-sheen)`} strokeWidth=".8" className="insight-material-reflection"/>
        {data.map((d, i) => <g key={d.key} {...interaction.bind(`${d.key}:${s.kind}`, { title: `${d.label} · ${s.label}`, rows: [[count ? 'Opportunities' : 'Value', count ? String(d[s.key]) : money(d[s.key])]], color: s.color })} role={d[s.key] > 0 ? 'button' : 'img'} tabIndex={0} aria-label={`${d.label}, ${s.label}: ${count ? d[s.key] : money(d[s.key])}`} onClick={() => { if (d[s.key] > 0) onPick(d.key, s.kind) }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (d[s.key] > 0) onPick(d.key, s.kind) } }} className="insight-chart-pick">
          <circle cx={x(i)} cy={y(d[s.key])} r="9" fill="transparent"/>
          <circle cx={x(i)} cy={y(d[s.key])} r="4" fill={`url(#${materialId}-${s.kind}-surface)`} stroke="var(--chart-rim)" pointerEvents="none"/>
          {interaction.active === `${d.key}:${s.kind}` && <><line x1={x(i)} x2={x(i)} y1="30" y2="166" className="insight-tracking-line" pointerEvents="none"/><motion.circle cx={x(i)} cy={y(d[s.key])} r="7" fill={s.color} stroke="white" strokeWidth="2" pointerEvents="none" initial={{ scale: interaction.reduced ? 1 : 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={chartSpring} style={{ transformBox: 'fill-box', transformOrigin: 'center' }}/></>}</g>)}
      </g>)}
      {data.map((d, i) => i % Math.max(1, Math.ceil(data.length / 12)) === 0 && <text key={d.key} x={x(i)} y="191" textAnchor="middle">{d.label}</text>)}
    </svg>{interaction.tooltip}</>
}
const mapProjection = geoMercator().fitExtent([[5, 5], [180, 202]], india as FeatureCollection)
const mapPath = geoPath(mapProjection)
export function IndiaMap({ groups, selected, onSelect }: { groups: InsightGroup[]; selected?: number; onSelect: (code: number) => void }) {
  const interaction = useChartInteraction(groups)
  const materialId = useId().replace(/:/g, '')
  const values = new Map(groups.map(g => [g.key, g.value])), max = Math.max(1, ...values.values())
  return <><svg viewBox="0 0 190 210" className="insight-india" role="img" aria-label="India opportunity distribution">
    {(india as FeatureCollection).features.map(feature => {
      const code = Number(feature.properties?.st_code), value = values.get(String(code)) ?? 0
      return <ChartMaterial key={code} id={`${materialId}-${code}`} color={value ? `hsl(${210 - value / max * 8} 83% ${76 - value / max * 40}%)` : 'var(--chart-empty-map)'}/>
    })}
    {(india as FeatureCollection).features.map(feature => {
      const code = Number(feature.properties?.st_code), value = values.get(String(code)) ?? 0
      return <path key={code} {...interaction.bind(String(code), { title: stateName(String(code)), rows: [['Pipeline value', money(value)], ['Opportunities', String(groups.find(g => g.key === String(code))?.count ?? 0)]] })}
        d={mapPath(feature) ?? ''} fill={`url(#${materialId}-${code}-surface)`} stroke={selected === code ? '#182c4f' : 'white'} strokeWidth={selected === code ? 1.8 : .5}
        role="button" tabIndex={0} aria-label={`Filter ${stateName(String(code))}: ${money(value)}`} onClick={() => onSelect(code)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(code) } }}/>
    })}
  </svg>{interaction.tooltip}</>
}
