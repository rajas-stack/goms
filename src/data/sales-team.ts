/** AMNEX internal sales team roster, seeded from Sales Team.xlsx (Master sheet).
 *  Powers the "Attending AMNEX Sales Team Members" multi-select on timeline events. */
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
  { name: 'Mr. Rohit Tiku', email: 'rohitt@amnex.com', designation: 'Regional Head' },
  { name: 'Prameet Srivastava', email: 'prameet@amnex.com', designation: 'Regional Manager' },
  { name: 'Vishal Sharma', email: 'vishal4@amnex.com', designation: 'Account Manager' },
  { name: 'Rimjhim Rai', email: 'rimjhim@amnex.com', designation: 'Account Manager' },
  { name: 'Saurabh Gupta', email: 'saurabh5@amnex.com', designation: 'Account Manager' },
  { name: 'Akriti Nagpal', email: 'akriti@amnex.com', designation: 'Account Manager' },
  { name: 'Saket Kumar Rai', email: 'saket@amnex.com', designation: 'Regional Manager' },
  { name: 'Abhinandan Singh', email: 'abhinandan@amnex.com', designation: 'Account Manager' },
  { name: 'Paresh Bhatti', email: 'paresh@amnex.com', designation: 'Account Manager' },
  { name: 'Parichay Das', email: 'parichay@amnex.com', designation: 'Regional Manager & Head' },
  { name: 'Akash Swain', email: 'akash13@amnex.com', designation: 'Account Manager' },
  { name: 'Rajesh Lahoria', email: 'rajeshl@amnex.com', designation: 'Regional Head' },
  { name: 'Suhas Nikam', email: 'suhas@amnex.com', designation: 'Regional Manager' },
  { name: 'Sham Vibhandik', email: 'sham@amnex.com', designation: 'Account Manager' },
  { name: 'Vicky Kothmire', email: 'vicky2@amnex.com', designation: 'Account Manager' },
  { name: 'Yogesh Shinde', email: 'yogesh10@amnex.com', designation: 'Account Manager' },
  { name: 'T Vinod', email: 'vinod@amnex.com', designation: 'Regional Manager' },
  { name: 'Kondala Rao', email: 'kondala@amnex.com', designation: 'Regional Manager & Head' },
  { name: 'Senthilnathan R', email: 'senthilnathan@amnex.com', designation: 'Regional Manager & Head' },
  { name: 'Sunil Kumar Sharma', email: 'sunilkumar@amnex.com', designation: 'Regional Manager & Head' },
  { name: 'Ketan Thakkar', email: 'ketant@amnex.com', designation: 'Account Manager' },
  { name: 'Darshan Bhatt', email: 'darshan3@amnex.com', designation: 'Account Manager' },
  { name: 'Anuradha Chauhan', email: 'anuradha@amnex.com', designation: 'Account Manager' },
  { name: 'Manish Arora', email: 'manish13@amnex.com', designation: 'Account Manager' },
  { name: 'Jitendra Kumavat', email: 'jitendrak@amnex.com', designation: 'Account Manager' },
  { name: 'Prashanth Reddy', email: 'prashanth@amnex.com', designation: 'BU Sales Agriculture' },
  { name: 'Manoj Kaushik', email: 'manoj4@amnex.com', designation: 'BU Sales Smart City & EPC' },
  { name: 'Shubham Mehra', email: 'shubham16@amnex.com', designation: 'BU Sales Data Fabrics' },
  { name: 'Siddharth Biswas', email: 'siddharth2@amnex.com', designation: 'BU Sales Highways & Traffic' },
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
