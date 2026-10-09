import type { MyAccess } from '../../apps/api/src/routers/auth'

/** The "Role & Access" navigation rule, as a table the rail and the mobile drawer tests both run, so they cannot disagree:
 *   - enforce: shown when the role can open Role & Access (anything above "no access" on admin.access: System Admin, IT, CXO);
 *   - off / shadow: shown to any signed-in user (the screen itself refuses and says so); hidden when signed out;
 *   - unknown (auth.me failed or has not answered): hidden.
 *  Link visibility is not authorization: the route guard and the server decide. */
const facts = { salesPersonId: null, teamMemberIds: { presales: [], legal: [], bid: [] } }
const me = (mode: 'shadow' | 'enforce', role: string): MyAccess => ({ mode, email: `${role}@amnex.com`, roles: [role as never], facts })
const OFF: MyAccess = { mode: 'off', email: null, roles: [], facts: null }

export interface NavCase { name: string; access: MyAccess | undefined; signedIn: boolean; visible: boolean }

const ROLES = [['System Admin', 'system_admin'], ['CXO', 'cxo'], ['IT', 'it'], ['Sales', 'sales']] as const

export const ACCESS_NAV_CASES: NavCase[] = [
  // RBAC off reports no roles at all: every signed-in user sees the entry, whatever their role
  ...ROLES.map(([label]) => ({ name: `off, signed in as ${label}`, access: OFF, signedIn: true, visible: true })),
  { name: 'off, signed out', access: OFF, signedIn: false, visible: false },
  // shadow reports roles but changes nothing for the browser: same rule as off
  ...ROLES.map(([label, role]) => ({ name: `shadow, ${label}`, access: me('shadow', role), signedIn: true, visible: true })),
  { name: 'shadow, signed out (auth.me answers off)', access: OFF, signedIn: false, visible: false },
  { name: 'shadow, a stale session', access: me('shadow', 'cxo'), signedIn: false, visible: false },
  // enforce: by role
  { name: 'enforce, System Admin', access: me('enforce', 'system_admin'), signedIn: true, visible: true },
  { name: 'enforce, CXO (read-only)', access: me('enforce', 'cxo'), signedIn: true, visible: true },
  { name: 'enforce, IT', access: me('enforce', 'it'), signedIn: true, visible: true },
  { name: 'enforce, Sales', access: me('enforce', 'sales'), signedIn: true, visible: false },
  { name: 'enforce, signed out (auth.me has not answered)', access: undefined, signedIn: false, visible: false },
]
