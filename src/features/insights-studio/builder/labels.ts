import type { Aggregation, ChartType, FieldType, FilterOp, TimeGrain } from '@goms/domain'

export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  string: 'Text', number: 'Number', currency: 'Money', date: 'Date', boolean: 'Yes / no', enum: 'Choice',
}

export const AGG_LABEL: Record<Aggregation, string> = {
  count: 'Count', sum: 'Sum', avg: 'Average', min: 'Minimum', max: 'Maximum', distinct: 'Distinct count',
}

export const GRAIN_LABEL: Record<TimeGrain, string> = {
  day: 'Day', month: 'Month', quarter: 'Quarter', half: 'Half-year (H1/H2)', year: 'Year',
}

export const CHART_LABEL: Record<ChartType, string> = {
  kpi: 'KPI tile', line: 'Line', area: 'Area', column: 'Columns', bar: 'Bars', stackedBar: 'Stacked columns', groupedBar: 'Grouped columns',
  donut: 'Donut', funnel: 'Funnel', heatmap: 'Heatmap', table: 'Table',
}

export const OP_LABEL: Record<FilterOp, string> = {
  eq: 'is', neq: 'is not', in: 'is any of', nin: 'is none of', gt: '>', gte: '≥', lt: '<', lte: '≤', between: 'between',
  contains: 'contains', empty: 'is empty', notEmpty: 'is not empty', isTrue: 'is yes', isFalse: 'is no',
}
