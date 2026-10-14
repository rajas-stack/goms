import type { BidSynopsisSection, GridColumn, GridFieldType, GridSelectOption, SynopsisGrid } from '@goms/domain'
import { emptyGrid, makeColumn, makeRow, newId } from './gridModel'

const STARTER_ROWS = 5

const option = (value: string, color: GridSelectOption['color']): GridSelectOption => ({ id: newId('o'), value, color })

function column(name: string, type: GridFieldType, options?: GridSelectOption[]): GridColumn {
  return options ? { ...makeColumn(name, type), options } : makeColumn(name, type)
}

/** Competition starts with the columns a bid team tracks per rival bidder. */
export function competitionGrid(): SynopsisGrid {
  return {
    columns: [
      column('Competitor', 'text'),
      column('Consortium / JV partners', 'text'),
      column('Technically qualified', 'singleSelect', [option('Yes', 'emerald'), option('No', 'crimson'), option('Awaited', 'gray')]),
      column('Technical score', 'number'),
      column('Quoted price', 'currency'),
      column('Rank', 'singleSelect', [option('L1', 'emerald'), option('L2', 'blue'), option('L3', 'amber'), option('Other', 'gray')]),
      column('Strengths', 'longText'),
      column('Weaknesses', 'longText'),
      column('Remarks', 'longText'),
    ],
    rows: Array.from({ length: STARTER_ROWS }, makeRow),
  }
}

/** The grid a section opens with before anything is saved. */
export function starterGrid(section: BidSynopsisSection): SynopsisGrid {
  return section === 'competition' ? competitionGrid() : emptyGrid()
}
