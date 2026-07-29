import { formatPhone } from '@/components/ui/PhoneInput'

export interface ExtractedContact {
  name?: string
  email?: string
  phone?: string
  designation?: string
  company?: string
  address?: string
  website?: string
}

const DESIGNATION_HINTS = [
  'manager', 'director', 'officer', 'engineer', 'head', 'executive', 'president',
  'ceo', 'cto', 'coo', 'cfo', 'consultant', 'secretary', 'commissioner', 'collector',
  'deputy', 'assistant', 'senior', 'lead', 'analyst', 'administrator', 'coordinator',
  'supervisor', 'chief', 'principal', 'vice president', 'proprietor', 'founder', 'partner',
]

const COMPANY_HINTS = [
  'pvt', 'ltd', 'llp', 'inc', 'incorporated', 'corp', 'corporation', 'company', 'co.',
  'enterprises', 'industries', 'group', 'solutions', 'technologies', 'technology',
  'systems', 'services', 'limited', 'associates', 'consultants', 'ventures', '& co',
  // Most cards this app scans are Indian government cards, whose masthead
  // ("Government of India", "Ministry of X", "X Commission") reads as a
  // clean 2-4 word letters-only line same as a person's name — these hints
  // keep that masthead out of the name guess below (see `ORG_HINTS`).
  'government', 'ministry', 'department', 'commission', 'directorate',
  'authority', 'institute', 'board', 'council', 'govt.', 'office',
  'division', 'wing', 'secretariat', 'bureau', 'centre', 'center', 'mission',
]

// Every line matching a designation or company/org hint is kept out of the
// name guess below — not just whichever single line each of those two fields
// happened to settle on — since a card can carry several such lines (e.g. a
// masthead line AND a sub-department line) and any one of them still reads
// as name-shaped.
const ORG_HINTS = [...DESIGNATION_HINTS, ...COMPANY_HINTS]

// Indian civil-service cards routinely suffix the name with a cadre tag
// ("Rajesh Kumar Sharma, IAS") — stripped before the name shape-test below,
// which otherwise rejects the line outright over the comma.
const CADRE_SUFFIX = /,\s*[A-Z]{2,6}(?:\s*\([^)]*\))?\s*$/

const ADDRESS_HINTS = [
  'road', 'street', 'st.', 'avenue', 'ave.', 'floor', 'sector', 'nagar', 'colony',
  'block', 'building', 'complex', 'tower', 'lane', 'marg', 'chowk', 'district',
  'near', 'opp.', 'opposite', 'p.o.', 'phase', 'layout', 'extension', 'circle',
]
const PIN_CODE = /\b\d{6}\b/

// Letters OCR commonly confuses for a digit when they land inside an
// otherwise-numeric run (a phone number) — normalized back before counting
// digits, so a single misread character doesn't sink an otherwise-good match.
const DIGIT_LOOKALIKES: Record<string, string> = {
  O: '0', o: '0',
  I: '1', l: '1', i: '1',
  S: '5', s: '5',
  B: '8',
  Z: '2', z: '2',
  G: '6',
}

function normalizeDigitLookalikes(s: string): string {
  return s.replace(/[A-Za-z]/g, (c) => DIGIT_LOOKALIKES[c] ?? c)
}

/** Best-effort field extraction from raw OCR text. Deliberately conservative:
 *  a confident email/phone/website, plus heuristic name/designation/company/
 *  address guesses. Every guess is skipped rather than forced when the text
 *  doesn't clearly support it — a missing field beats a wrong one. */
function parseContact(text: string): ExtractedContact {
  const out: ExtractedContact = {}
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)

  const email = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)
  if (email) out.email = email[0].toLowerCase()

  // Phone: scan runs that are mostly digits/punctuation but may carry a
  // handful of OCR letter-for-digit misreads (e.g. "98O2 3456 78" for a
  // zero); normalize each candidate before counting digits, and keep
  // whichever candidate ends up with the most real digits (≥10).
  let best = ''
  let bestDigits = ''
  for (const m of text.matchAll(/[+\dOoIliSsBZzG][\dOoIliSsBZzG\s().-]{7,}[\dOoIliSsBZzG]/g)) {
    const normalized = normalizeDigitLookalikes(m[0])
    const digits = normalized.replace(/\D/g, '')
    if (digits.length >= 10 && digits.length > bestDigits.length) {
      best = normalized
      bestDigits = digits
    }
  }
  if (best) out.phone = formatPhone(bestDigits.slice(-10))

  // Website: an explicit URL/www, or a bare domain not already claimed by
  // the email match (so the email's own domain never doubles as "website").
  const emailDomain = out.email?.split('@')[1]
  const explicitUrl = text.match(/\b(?:https?:\/\/|www\.)[^\s,;]+/i)?.[0]
  const bareDomain = [...text.matchAll(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/gi)]
    .map((m) => m[0])
    .find((candidate) => candidate.toLowerCase() !== emailDomain && !text.includes(`@${candidate}`))
  const website = explicitUrl ?? bareDomain
  if (website) out.website = website.replace(/[.,;]+$/, '')

  const designationLine = lines.find((l) => {
    const low = l.toLowerCase()
    return !low.includes('@') && DESIGNATION_HINTS.some((h) => low.includes(h))
  })
  if (designationLine) out.designation = designationLine

  const companyLine = lines.find((l) => {
    const low = l.toLowerCase()
    return !low.includes('@') && l !== designationLine && COMPANY_HINTS.some((h) => low.includes(h))
  })
  if (companyLine) out.company = companyLine

  // Address: every line that reads like part of a postal address, joined in
  // source order — cards routinely wrap an address across 2-3 lines.
  const addressLines = lines.filter((l) => {
    if (l === designationLine || l === companyLine || l.includes('@')) return false
    const low = l.toLowerCase()
    return PIN_CODE.test(l) || ADDRESS_HINTS.some((h) => low.includes(h))
  })
  if (addressLines.length > 0) out.address = addressLines.join(', ')

  // Name: a clean 2–4 word line, letters only (a trailing cadre tag like
  // ", IAS" is stripped first), not one of the other fields.
  const name = lines.find((l) => {
    if (l === designationLine || l === companyLine || addressLines.includes(l) || /[@\d]/.test(l)) return false
    const low = l.toLowerCase()
    if (ORG_HINTS.some((h) => low.includes(h))) return false
    const stripped = l.replace(CADRE_SUFFIX, '').trim()
    const words = stripped.split(/\s+/)
    return words.length >= 2 && words.length <= 4 && /^[A-Za-z][A-Za-z.\s'-]+$/.test(stripped)
  })
  if (name) out.name = name.replace(CADRE_SUFFIX, '').replace(/\s+/g, ' ').trim()

  return out
}

/** Run OCR (tesseract.js, loaded on demand) over one or more card images and
 *  return the fields we could recognise. PDFs are skipped — image sides only. */
export async function extractContact(imageUrls: string[]): Promise<ExtractedContact> {
  const mod = (await import('tesseract.js')) as unknown as {
    recognize?: (image: string, langs: string) => Promise<{ data: { text: string } }>
    default?: { recognize: (image: string, langs: string) => Promise<{ data: { text: string } }> }
  }
  const recognize = mod.recognize ?? mod.default?.recognize
  if (!recognize) throw new Error('OCR engine unavailable')

  let text = ''
  for (const url of imageUrls) {
    if (!url || url.startsWith('data:application/pdf')) continue
    const res = await recognize(url, 'eng')
    text += '\n' + (res?.data?.text ?? '')
  }
  return parseContact(text)
}
