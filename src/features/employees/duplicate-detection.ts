import type { Employee } from '@/lib/types'

export interface DuplicateCandidate {
  a: Employee
  b: Employee
  score: number
  matchedOn: string[]
}

export interface DuplicateContext {
  /** employee id -> department node, from `useEmployeeDepartments()`. */
  departmentOf: Record<string, { id: string; name: string }>
}

/** Suggestion threshold — a pair scoring at or above this is worth surfacing
 *  to a user for review. Tuned so a name-only near-match (no shared email/
 *  phone/department) alone doesn't clear it, but any two independent signals
 *  together (e.g. same email + similar name, or same phone + same
 *  department) do. */
export const DUPLICATE_THRESHOLD = 0.55

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ')
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '').slice(-10)
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Classic edit-distance, fine at name-length strings (a handful of words). */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = 0; i <= a.length; i++) dp[i][0] = i
  for (let j = 0; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[a.length][b.length]
}

/** 0 (unrelated) to 1 (identical once normalized). One name being fully
 *  contained in the other (e.g. "R. Kumar" vs "Rajesh Kumar") scores high
 *  without going through edit distance, which would otherwise punish the
 *  length difference. */
function nameSimilarity(nameA: string, nameB: string): number {
  const a = normalizeName(nameA)
  const b = normalizeName(nameB)
  if (!a || !b) return 0
  if (a === b) return 1
  if (a.includes(b) || b.includes(a)) return 0.85
  return Math.max(0, 1 - levenshtein(a, b) / Math.max(a.length, b.length))
}

/** Scores how likely two employee records are the same real person, from
 *  name/email/phone/department similarity. Purely a suggestion signal — it
 *  never flags, links, or changes anything by itself. */
export function scorePair(a: Employee, b: Employee, ctx: DuplicateContext): { score: number; matchedOn: string[] } {
  const matchedOn: string[] = []
  let score = 0

  const nameSim = nameSimilarity(a.name, b.name)
  // An exact match (case/whitespace/punctuation-insensitive — "Priya Nair"
  // vs "priya nair" is exact here) is already a strong signal by itself and
  // clears the threshold alone; anything short of exact only contributes
  // partial weight, since it needs another matching field to back it up.
  if (nameSim === 1) {
    score += 0.6
    matchedOn.push('Same name')
  } else if (nameSim >= 0.5) {
    score += nameSim * 0.45
    matchedOn.push('Similar name')
  }

  const emailA = normalizeEmail(a.email)
  if (emailA && emailA === normalizeEmail(b.email)) {
    score += 0.35
    matchedOn.push('Same email')
  }

  const phoneA = normalizePhone(a.phone)
  if (phoneA.length === 10 && phoneA === normalizePhone(b.phone)) {
    score += 0.3
    matchedOn.push('Same phone number')
  }

  const deptA = ctx.departmentOf[a.id]?.id
  if (deptA && deptA === ctx.departmentOf[b.id]?.id) {
    score += 0.1
    matchedOn.push('Same department')
  }

  return { score: Math.min(1, score), matchedOn }
}

/** Every pair of active, non-vacant employees whose combined signals look
 *  like the same real person, highest score first. O(n²) — fine at the scale
 *  a single organization's contact list runs at (hundreds, not tens of
 *  thousands); only run this for an explicit, user-triggered scan (e.g.
 *  opening the duplicates panel), never on every render. */
export function findDuplicateCandidates(employees: Employee[], ctx: DuplicateContext): DuplicateCandidate[] {
  const people = employees.filter((e) => !e.vacant)
  const out: DuplicateCandidate[] = []
  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      const { score, matchedOn } = scorePair(people[i], people[j], ctx)
      if (score >= DUPLICATE_THRESHOLD) out.push({ a: people[i], b: people[j], score, matchedOn })
    }
  }
  return out.sort((x, y) => y.score - x.score)
}

/** One employee against every other — cheap enough to run on every render of
 *  an employee's detail view (O(n) instead of the full O(n²) sweep above). */
export function findCandidatesFor(employee: Employee, employees: Employee[], ctx: DuplicateContext): DuplicateCandidate[] {
  if (employee.vacant) return []
  const out: DuplicateCandidate[] = []
  for (const other of employees) {
    if (other.id === employee.id || other.vacant) continue
    const { score, matchedOn } = scorePair(employee, other, ctx)
    if (score >= DUPLICATE_THRESHOLD) out.push({ a: employee, b: other, score, matchedOn })
  }
  return out.sort((x, y) => y.score - x.score)
}
