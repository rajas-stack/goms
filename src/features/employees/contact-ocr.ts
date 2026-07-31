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

/** Whether `low` (an already-lowercased line) contains any of `hints` ending
 *  at a word boundary — the hint's END must not run into more letters, but
 *  its START may (only the trailing side is checked).
 *
 *  Plain `includes()` let a hint match inside an unrelated longer word and
 *  steal the line into the wrong field — 'corp' matched "Corporate" in
 *  "1st Floor, Corporate House", so an address line was reported as the
 *  company. A *leading*-boundary requirement too was tried and rejected: real
 *  OCR text off an actual card read "Amnex Infotechnologies", one compounded
 *  word with no space, and requiring a boundary before 'technologies' missed
 *  it. Trailing-only still rejects 'corp' inside "Corporate" (followed by
 *  'orate', not a boundary) while matching 'technologies' inside
 *  "Infotechnologies" (at the end of the word) and abbreviations like 'pvt'
 *  in "Pvt.". */
function hasWholeWordHint(low: string, hints: string[]): boolean {
  return hints.some((h) => {
    const escaped = h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`${escaped}([^a-z0-9]|$)`).test(low)
  })
}

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
  //
  // The inner class matches spaces/tabs but NOT newlines: a phone number
  // never wraps across lines on a card, and allowing `\s` here let a match
  // run past its own line into the next one's first character. When that
  // character was a letter-lookalike (e.g. the `s` starting an email
  // address) it was then normalized to a digit, pushing the digit count
  // past 10 so `slice(-10)` below returned a shifted, wrong number —
  // "+91 8890010268" silently became "+91 8900102685".
  let best = ''
  let bestDigits = ''
  for (const m of text.matchAll(/[+\dOoIliSsBZzG][\dOoIliSsBZzG \t().-]{7,}[\dOoIliSsBZzG]/g)) {
    const normalized = normalizeDigitLookalikes(m[0])
    const digits = normalized.replace(/\D/g, '')
    if (digits.length >= 10 && digits.length > bestDigits.length) {
      best = normalized
      bestDigits = digits
    }
  }
  if (best) out.phone = formatPhone(bestDigits.slice(-10))

  // Website: an explicit URL/www, or a bare domain that isn't part of the
  // email address already matched above. A dotted email LOCAL part
  // ("rajesh.sharma" in rajesh.sharma@gov.in) is domain-shaped, so testing
  // only the domain side let it through as the "website" — every candidate
  // is checked against the whole email, plus a bare `candidate@`/`@candidate`
  // in the text for when the email regex above didn't fire at all.
  const explicitUrl = text.match(/\b(?:https?:\/\/|www\.)[^\s,;]+/i)?.[0]
  const bareDomain = [...text.matchAll(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/gi)]
    .map((m) => m[0])
    .find((candidate) => {
      const low = candidate.toLowerCase()
      if (out.email?.includes(low)) return false
      return !text.includes(`@${candidate}`) && !text.includes(`${candidate}@`)
    })
  const website = explicitUrl ?? bareDomain
  if (website) out.website = website.replace(/[.,;]+$/, '')

  const designationLine = lines.find((l) => {
    const low = l.toLowerCase()
    return !low.includes('@') && hasWholeWordHint(low, DESIGNATION_HINTS)
  })
  if (designationLine) out.designation = designationLine

  const companyLine = lines.find((l) => {
    const low = l.toLowerCase()
    return !low.includes('@') && l !== designationLine && hasWholeWordHint(low, COMPANY_HINTS)
  })
  if (companyLine) out.company = companyLine

  // Address: every line that reads like part of a postal address, joined in
  // source order — cards routinely wrap an address across 2-3 lines.
  const addressLines = lines.filter((l) => {
    if (l === designationLine || l === companyLine || l.includes('@')) return false
    const low = l.toLowerCase()
    // Address hints stay substring matches on purpose — Indian toponyms
    // routinely compound them ("Ahmednagar", "Gandhinagar"), which a
    // whole-word test would miss.
    if (!PIN_CODE.test(l) && !ADDRESS_HINTS.some((h) => low.includes(h))) return false
    // An org/masthead line can incidentally contain an address word
    // ("Ministry of Road Transport" carries 'road'), which put the ministry's
    // name in the address field. A real address line practically always
    // carries a number too — a plot/floor/building number or a PIN — so an
    // org-shaped line with no digits at all is treated as org, not address.
    if (hasWholeWordHint(low, ORG_HINTS) && !/\d/.test(l)) return false
    return true
  })
  // A real card line already ends in its own comma when it wraps mid-address
  // ("2nd floor, Bandra Kurla Complex,") — joining with ', ' unconditionally
  // doubled it into "Complex,,". Strip a trailing comma (and any whitespace
  // before it) off each line first, so the join always contributes exactly
  // one separator.
  if (addressLines.length > 0) out.address = addressLines.map((l) => l.replace(/\s*,\s*$/, '')).join(', ')

  // Name: a clean 2–4 word line, letters only, not one of the other fields.
  // Two things are stripped from each line before that shape test, both
  // confirmed against real card OCR rather than assumed: a trailing cadre
  // tag ("Rajesh Kumar Sharma, IAS" — the comma otherwise fails the shape
  // test outright), and a leading decorative glyph. The second is real: a
  // logo mark printed just left of a name OCR'd as a single stray symbol
  // ("® Shubham Mehra"), which defeated the "starts with a letter" anchor
  // and silently disqualified the actual name line, leaving a decorative
  // tagline elsewhere on the card ("is natural") as the only remaining
  // candidate. Only a leading run of non-letter, non-space characters is
  // stripped — never more than that — so this can't absorb real content.
  const nameCandidates = lines
    .map((raw) => ({
      raw,
      clean: raw.replace(CADRE_SUFFIX, '').replace(/^[^A-Za-z\s]+\s*/, '').trim(),
    }))
    .filter(({ raw, clean }) => {
      if (raw === designationLine || raw === companyLine || addressLines.includes(raw) || /[@\d]/.test(raw)) return false
      const low = raw.toLowerCase()
      if (hasWholeWordHint(low, ORG_HINTS)) return false
      // The shape test below allows '.' (needed for initials like "J. Smith"),
      // which incidentally also matches a bare domain with no digits/@ in it —
      // real OCR off a noisy card produced "ence www.amnex.com" (garbage prefix
      // ahead of a website line) and it passed as a 2-word, letters-and-dots
      // "name". A domain always has a dot directly between two letter/digit
      // runs with no surrounding space ("amnex.com"); an initial's dot is
      // always followed by a space or the end of the string — that's the real
      // distinguishing shape, not just "contains a dot".
      if (/\b[a-z0-9-]+\.[a-z]{2,}\b/i.test(raw)) return false
      const words = clean.split(/\s+/)
      return words.length >= 2 && words.length <= 4 && /^[A-Za-z][A-Za-z.\s'-]+$/.test(clean)
    })
    .map(({ clean }) => clean)
  // A printed name is capitalized ("Shubham Mehra"); the decorative taglines
  // and slogans cards carry ("intelligence is natural") are the same 2-4
  // word letters-only shape but typically aren't. Taking the first candidate
  // in reading order alone therefore handed the name field whichever of the
  // two happened to sit higher on the card. Capitalized candidates win;
  // falling back to the first of any keeps cards that print the name in
  // lower case working as before.
  const isCapitalized = (l: string) => l.split(/\s+/).every((w) => /^[A-Z]/.test(w))
  const name = nameCandidates.find(isCapitalized) ?? nameCandidates[0]
  if (name) out.name = name.replace(/\s+/g, ' ').trim()

  // A capital letter merging into an adjacent decorative glyph at the START
  // of a line (the same mechanism the name-candidate note above works
  // around) doesn't just disqualify the line as a name candidate — even once
  // recovered, the merged letter itself OCR's as lowercase, so a real
  // "Shubham Mehra" can come back "shubham Mehra" (confirmed against the
  // same real card: only the very first letter was affected, every other
  // word read correctly). Fixing this blindly would wrongly "correct" a card
  // genuinely styled without capitals — indistinguishable from a dropped
  // capital if you only look at where the letter is. But a FIELD THAT
  // ALREADY HAS A CAPITAL SOMEWHERE ELSE IN IT is direct same-line evidence
  // this specific text is normally capitalized, which makes a lowercase
  // leading letter far more likely a drop than a style choice — so only
  // that case gets fixed, and only its very first character (never a word
  // that isn't first, and never a field with no capitals anywhere in it, so
  // an intentionally all-lowercase card is left exactly as read).
  function fixDroppedLeadingCapital(s: string): string {
    return /[a-z]/.test(s[0] ?? '') && /[A-Z]/.test(s) ? s[0].toUpperCase() + s.slice(1) : s
  }
  if (out.name) out.name = fixDroppedLeadingCapital(out.name)
  if (out.designation) out.designation = fixDroppedLeadingCapital(out.designation)
  if (out.company) out.company = fixDroppedLeadingCapital(out.company)

  return out
}

interface TessWorker {
  setParameters: (params: Record<string, string>) => Promise<unknown>
  recognize: (image: string, options?: { rotateRadians?: number }) => Promise<{ data: { text: string | null } }>
  terminate: () => Promise<void>
}

// A quick, cheap read on whether a page of OCR text looks like it came off a
// business card at all, used only to pick the best of several rotation
// attempts below — never to gate whether `parseContact` runs.
const QUICK_EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i
const QUICK_PHONE_RE = /(?:\d[\s().-]*){10}/
function plausibility(text: string): number {
  const words = (text.match(/[A-Za-z]{3,}/g) ?? []).length
  return words + (QUICK_EMAIL_RE.test(text) ? 50 : 0) + (QUICK_PHONE_RE.test(text) ? 30 : 0)
}
function looksLikeACard(text: string): boolean {
  return QUICK_EMAIL_RE.test(text) || QUICK_PHONE_RE.test(text)
}

// Tesseract's page-segmentation mode, left at its default (effectively
// "treat the image as one text block"), read a card's decorative side
// graphic (a logo/colour bar — near-zero-confidence, x-coordinate cleanly
// separated from the real text column in word-level bounding-box data) as
// part of the SAME line as the real text next to it, prepending garbage to
// every field ("Eee) Shubham Mehra", "fiEumon DETR Manager"). PSM.AUTO runs
// real page segmentation, which correctly separates that graphic into its
// own region — confirmed against a real card: default mode produced garbage
// prefixes on every line at every rotation; PSM.AUTO produced a clean read
// (confidence 90 vs 49) at the card's true, unrotated orientation. This is
// the actual fix for "garbled text"; the rotation retry below is a separate,
// smaller safety net (see below) and was not what caused the garbling.
const PSM_AUTO = '3'

// Quarter-turns to try, upright first. A phone camera held portrait to shoot
// a landscape card can save the photo pre-rotated 90°/180°/270° with no
// orientation metadata to correct it, and the LSTM-only engine mode this app
// uses (`oem` 1, for its speed/size tradeoff) has no built-in auto-rotate.
// Once PSM.AUTO is set (see above), a genuinely upright photo is already
// read correctly on the first attempt — this loop only pays for extra passes
// when that attempt doesn't look like a card at all.
const ROTATIONS_DEG = [0, 270, 90, 180]

async function recognizeBestOrientation(worker: TessWorker, url: string): Promise<string> {
  let best = ''
  let bestScore = -1
  for (const deg of ROTATIONS_DEG) {
    const { data } = await worker.recognize(url, { rotateRadians: (deg * Math.PI) / 180 })
    const text = data?.text ?? ''
    const score = plausibility(text)
    if (score > bestScore) { best = text; bestScore = score }
    if (looksLikeACard(text)) break
  }
  return best
}

/** Run OCR (tesseract.js, loaded on demand) over one or more card images and
 *  return the fields we could recognise. PDFs are skipped — image sides only.
 *  Each image is tried at up to four rotations to recover from a sideways/
 *  upside-down photo — see `recognizeBestOrientation`. */
export async function extractContact(imageUrls: string[]): Promise<ExtractedContact> {
  const mod = (await import('tesseract.js')) as unknown as {
    createWorker?: (langs: string, oem?: number) => Promise<TessWorker>
    default?: { createWorker: (langs: string, oem?: number) => Promise<TessWorker> }
  }
  const createWorker = mod.createWorker ?? mod.default?.createWorker
  if (!createWorker) throw new Error('OCR engine unavailable')

  const worker = await createWorker('eng', 1)
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM_AUTO })
    let text = ''
    for (const url of imageUrls) {
      if (!url || url.startsWith('data:application/pdf')) continue
      text += '\n' + (await recognizeBestOrientation(worker, url))
    }
    return parseContact(text)
  } finally {
    await worker.terminate()
  }
}
