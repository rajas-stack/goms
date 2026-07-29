/** AMNEX internal sales team roster, seeded from Sales Team.xlsx (Master
 *  sheet: name/email/designation/state coverage; `reportsTo` below is
 *  derived from its Level (L0-L3) column plus the Heads/Regions/Regional
 *  Managers sheets, since Master itself has no explicit manager column).
 *  Powers the "Attending AMNEX Sales Team Members" multi-select on timeline
 *  events, and (via `reportsTo`/`tiers`) the RM/GM/Sales Head autofill in
 *  DepartmentFields' AMNEX sales ownership block. */
export type SalesTier = 'rm' | 'gm' | 'salesHead'

export interface SalesTeamMember {
  name: string
  email: string
  designation: string
  /** Direct manager's email. Unset = top of chain, or not wired up yet. */
  reportsTo?: string
  /** Explicit override of which role tier(s) this person occupies in the
   *  sales-ownership chain. Only needed where the designation is ambiguous
   *  (e.g. "Regional Manager & Head") — the actual reporting relationship
   *  always wins over the designation string. Leave unset to use the
   *  designation-derived default (see `defaultTiers`). */
  tiers?: SalesTier[]
}

export const SALES_TEAM: SalesTeamMember[] = [
  { name: 'Jayendrasinh Puwar', email: 'jayendra@amnex.com', designation: 'Sales Head' },

  // North geo (Rohit's 20-state territory) — Master sheet Level L1→L2→L3.
  { name: 'Mr. Rohit Tiku', email: 'rohitt@amnex.com', designation: 'Regional Head', reportsTo: 'jayendra@amnex.com' },
  { name: 'Prameet Srivastava', email: 'prameet@amnex.com', designation: 'Regional Manager', reportsTo: 'rohitt@amnex.com' },
  { name: 'Vishal Sharma', email: 'vishal4@amnex.com', designation: 'Account Manager', reportsTo: 'prameet@amnex.com' },
  { name: 'Rimjhim Rai', email: 'rimjhim@amnex.com', designation: 'Account Manager', reportsTo: 'prameet@amnex.com' },
  { name: 'Saurabh Gupta', email: 'saurabh5@amnex.com', designation: 'Account Manager', reportsTo: 'prameet@amnex.com' },
  { name: 'Akriti Nagpal', email: 'akriti@amnex.com', designation: 'Account Manager', reportsTo: 'rohitt@amnex.com' },
  { name: 'Saket Kumar Rai', email: 'saket@amnex.com', designation: 'Regional Manager', reportsTo: 'rohitt@amnex.com' },
  { name: 'Abhinandan Singh', email: 'abhinandan@amnex.com', designation: 'Account Manager', reportsTo: 'saket@amnex.com' },
  { name: 'Paresh Bhatti', email: 'paresh@amnex.com', designation: 'Account Manager', reportsTo: 'saket@amnex.com' },

  // East territory — per the "Heads" sheet, Parichay Das heads it outright
  // (no separate L1 above him for these 3 states), so he's both RM and Head.
  { name: 'Parichay Das', email: 'parichay@amnex.com', designation: 'Regional Manager & Head', reportsTo: 'jayendra@amnex.com', tiers: ['rm', 'gm'] },
  { name: 'Akash Swain', email: 'akash13@amnex.com', designation: 'Account Manager', reportsTo: 'parichay@amnex.com' },

  // South geo (Rajesh's 8-state territory).
  { name: 'Rajesh Lahoria', email: 'rajeshl@amnex.com', designation: 'Regional Head', reportsTo: 'jayendra@amnex.com' },
  { name: 'Suhas Nikam', email: 'suhas@amnex.com', designation: 'Regional Manager', reportsTo: 'rajeshl@amnex.com' },
  { name: 'Sham Vibhandik', email: 'sham@amnex.com', designation: 'Account Manager', reportsTo: 'suhas@amnex.com' },
  { name: 'Vicky Kothmire', email: 'vicky2@amnex.com', designation: 'Account Manager', reportsTo: 'suhas@amnex.com' },
  { name: 'Yogesh Shinde', email: 'yogesh10@amnex.com', designation: 'Account Manager', reportsTo: 'suhas@amnex.com' },
  { name: 'T Vinod', email: 'vinod@amnex.com', designation: 'Regional Manager', reportsTo: 'rajeshl@amnex.com' },
  // Kondala Rao and Senthilnathan R sit at L2 with no L2 peer splitting their
  // states further and no separate GM above them but Rajesh — same dual
  // RM+Head role as Parichay/Sunil, per the "Heads" sheet's territory list.
  { name: 'Kondala Rao', email: 'kondala@amnex.com', designation: 'Regional Manager & Head', reportsTo: 'rajeshl@amnex.com', tiers: ['rm', 'gm'] },
  { name: 'Senthilnathan R', email: 'senthilnathan@amnex.com', designation: 'Regional Manager & Head', reportsTo: 'rajeshl@amnex.com', tiers: ['rm', 'gm'] },

  // West territory — Sunil Kumar Sharma heads it outright (2 states, no
  // separate L1 above him per the "Heads" sheet), same dual-role pattern.
  { name: 'Sunil Kumar Sharma', email: 'sunilkumar@amnex.com', designation: 'Regional Manager & Head', reportsTo: 'jayendra@amnex.com', tiers: ['rm', 'gm'] },
  { name: 'Ketan Thakkar', email: 'ketant@amnex.com', designation: 'Account Manager', reportsTo: 'sunilkumar@amnex.com' },
  { name: 'Darshan Bhatt', email: 'darshan3@amnex.com', designation: 'Account Manager', reportsTo: 'sunilkumar@amnex.com' },
  { name: 'Anuradha Chauhan', email: 'anuradha@amnex.com', designation: 'Account Manager', reportsTo: 'sunilkumar@amnex.com' },
  { name: 'Manish Arora', email: 'manish13@amnex.com', designation: 'Account Manager', reportsTo: 'sunilkumar@amnex.com' },
  { name: 'Jitendra Kumavat', email: 'jitendrak@amnex.com', designation: 'Account Manager', reportsTo: 'sunilkumar@amnex.com' },

  // BU (vertical, not geo) heads — India-wide, no regional chain beneath them.
  { name: 'Prashanth Reddy', email: 'prashanth@amnex.com', designation: 'BU Sales Agriculture', reportsTo: 'jayendra@amnex.com' },
  { name: 'Manoj Kaushik', email: 'manoj4@amnex.com', designation: 'BU Sales Smart City & EPC', reportsTo: 'jayendra@amnex.com' },
  { name: 'Shubham Mehra', email: 'shubham16@amnex.com', designation: 'BU Sales Data Fabrics', reportsTo: 'jayendra@amnex.com' },
  { name: 'Siddharth Biswas', email: 'siddharth2@amnex.com', designation: 'BU Sales Highways & Traffic', reportsTo: 'jayendra@amnex.com' },
]

/** Designation-derived default tier(s) for a member with no explicit `tiers`
 *  override. Ambiguous titles (e.g. "Regional Manager & Head") deliberately
 *  derive to no tier until someone sets `tiers` explicitly for that person. */
export function defaultTiers(designation: string): SalesTier[] {
  if (designation === 'Sales Head') return ['salesHead']
  if (designation === 'Regional Head') return ['gm']
  if (designation === 'Regional Manager') return ['rm']
  return []
}

export function tiersOf(member: SalesTeamMember): SalesTier[] {
  return member.tiers ?? defaultTiers(member.designation)
}
