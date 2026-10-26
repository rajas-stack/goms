import { expect, test } from 'vitest'
import { buildDrivePhotoIndex, photoCategories } from './driveProfileImages'

const file = (id: string, name: string) => ({ id, name, modifiedTime: `t-${id}` })

test('matches each folder only against its own category, by ID or name', () => {
  const index = buildDrivePhotoIndex(
    [
      { category: 'internal', files: [file('f1', 'AIPL-1234.jpg'), file('f2', '1001.jpg')] },
      { category: 'clientDepartment', files: [file('f3', '1001.jpg'), file('f4', 'Meena Joshi.png')] },
      { category: 'oem', files: [], error: 'No access' },
    ],
    {
      internal: [{ id: 'org1', name: 'Asha Rao', numbers: ['1234'] }],
      clientDepartment: [{ id: 'emp1', name: 'Rakesh Patel', numbers: ['1001'] }, { id: 'emp2', name: 'Meena Joshi', numbers: ['1002'] }],
    },
  )
  expect(index.people).toEqual({ org1: 'f1', emp1: 'f3', emp2: 'f4' })
  expect(index.versions).toEqual({ f1: 't-f1', f3: 't-f3', f4: 't-f4' })
  // 1001.jpg in the Amnex folder must not borrow the Client Departments person who owns 1001.
  expect(index.report.internal.unmatched).toEqual(['1001.jpg: no person has ID 1001.'])
  expect(index.report.oem).toMatchObject({ photos: 0, used: 0, error: 'No access' })
  expect(index.names).toEqual({ asharao: 'f1', rakeshpatel: 'f3', meenajoshi: 'f4' })
})

test('shares one photo across a human’s linked rows, but a row’s own folder wins', () => {
  const index = buildDrivePhotoIndex(
    [{ category: 'internal', files: [file('f1', '1234.jpg')] }, { category: 'sales', files: [file('f2', 'Asha Rao.jpg')] }],
    { internal: [{ id: 'org1', name: 'Asha Rao', numbers: ['1234'] }], sales: [{ id: 'sp1', name: 'Asha Rao', numbers: [] }] },
    [['org1', 'team1', 'sp1']],
  )
  expect(index.people).toEqual({ org1: 'f1', team1: 'f1', sp1: 'f2' })
  expect(index.names).toEqual({})
})

test('lists Amnex rosters first, then every Directory Type except Amnex, including new ones', () => {
  const keys = photoCategories([
    { code: 'internal', name: 'Amnex Employee' }, { code: 'department', name: 'Departmental' }, { code: 'govt', name: 'Govt Bodies' },
  ]).map((c) => `${c.key}:${c.label}`)
  expect(keys).toEqual(['internal:Amnex Employees', 'sales:Sales Team', 'delivery:Delivery Team', 'clientDepartment:Departmental', 'govt:Govt Bodies'])
})
