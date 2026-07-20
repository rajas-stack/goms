import { formatPhone } from '@/components/ui/PhoneInput'

export interface ExtractedContact {
  name?: string
  email?: string
  phone?: string
  designation?: string
}

const DESIGNATION_HINTS = [
  'manager', 'director', 'officer', 'engineer', 'head', 'executive', 'president',
  'ceo', 'cto', 'coo', 'cfo', 'consultant', 'secretary', 'commissioner', 'collector',
  'deputy', 'assistant', 'senior', 'lead', 'analyst', 'administrator', 'coordinator',
  'supervisor', 'chief', 'principal', 'vice president', 'proprietor', 'founder', 'partner',
]

/** Best-effort field extraction from raw OCR text. Deliberately conservative:
 *  a confident email/phone, plus heuristic name/designation guesses. */
function parseContact(text: string): ExtractedContact {
  const out: ExtractedContact = {}
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)

  const email = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)
  if (email) out.email = email[0].toLowerCase()

  // Pick the phone-like run carrying the most digits (≥10).
  let best = ''
  for (const m of text.matchAll(/\+?\d[\d\s().-]{7,}\d/g)) {
    if (m[0].replace(/\D/g, '').length >= 10 && m[0].replace(/\D/g, '').length > best.replace(/\D/g, '').length) {
      best = m[0]
    }
  }
  if (best) {
    const digits = best.replace(/\D/g, '').slice(-10)
    out.phone = formatPhone(digits.slice(0, 2), digits.slice(2, 10))
  }

  const designation = lines.find((l) => {
    const low = l.toLowerCase()
    return !low.includes('@') && DESIGNATION_HINTS.some((h) => low.includes(h))
  })
  if (designation) out.designation = designation

  // Name: a clean 2–4 word line, letters only, not the designation/email line.
  const name = lines.find((l) => {
    if (l === designation || /[@\d]/.test(l)) return false
    const words = l.split(/\s+/)
    return words.length >= 2 && words.length <= 4 && /^[A-Za-z][A-Za-z.\s'-]+$/.test(l)
  })
  if (name) out.name = name.replace(/\s+/g, ' ').trim()

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
