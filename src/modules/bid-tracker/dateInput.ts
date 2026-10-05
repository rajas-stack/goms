function parseTime(value?: string): { hours: number; minutes: number } | null {
  if (!value) return { hours: 0, minutes: 0 }
  const match = value.match(/^(\d{1,2})(?::(\d{2})|(\d{2}))?\s*(am|pm)?$/i)
  if (!match) return null

  let hours = Number(match[1])
  const minutes = Number(match[2] ?? match[3] ?? 0)
  const meridian = match[4]?.toLowerCase()
  if (minutes > 59 || (meridian && (hours < 1 || hours > 12)) || (!meridian && hours > 23)) return null
  if (meridian === 'pm' && hours < 12) hours += 12
  if (meridian === 'am' && hours === 12) hours = 0
  return { hours, minutes }
}

function createLocalDate(year: number, month: number, day: number, time: string): Date | null {
  const parsedTime = parseTime(time)
  if (!parsedTime || month < 0 || month > 11 || day < 1 || day > 31) return null
  const parsed = new Date(year, month, day, parsedTime.hours, parsedTime.minutes)
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month || parsed.getDate() !== day) return null
  return parsed
}

const months: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5,
  jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10,
  november: 10, dec: 11, december: 11,
}
const monthPattern = 'january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec'

export function parseFriendlyDate(value: string): Date | null {
  const raw = value.trim().replace(/\s+/g, ' ')
  if (!raw) return null

  const compact = raw.match(new RegExp(`^([0-9]{1,2})(?:st|nd|rd|th)?(${monthPattern})([0-9]{4}|[0-9]{2})([0-9]{3,4})?$`, 'i'))
  if (compact) {
    const yearText = compact[3]
    const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText)
    return createLocalDate(year, months[compact[2].toLowerCase()], Number(compact[1]), compact[4] ?? '')
  }

  const named = raw.match(new RegExp(`^([0-9]{1,2})(?:st|nd|rd|th)?\\s+(${monthPattern})\\.?\\s+([0-9]{2,4})(?:\\s+(.+))?$`, 'i'))
  if (named) {
    const year = named[3].length === 2 ? 2000 + Number(named[3]) : Number(named[3])
    return createLocalDate(year, months[named[2].toLowerCase()], Number(named[1]), named[4] ?? '')
  }

  const monthFirst = raw.match(new RegExp(`^(${monthPattern})\\.?\\s+([0-9]{1,2})(?:st|nd|rd|th)?[,]?\\s+([0-9]{4})(?:\\s+(.+))?$`, 'i'))
  if (monthFirst) {
    return createLocalDate(Number(monthFirst[3]), months[monthFirst[1].toLowerCase()], Number(monthFirst[2]), monthFirst[4] ?? '')
  }

  const yearFirstSlash = raw.match(/^(\d{4})\/([0-9]{1,2})\/([0-9]{1,2})(?:\s+(.+))?$/)
  if (yearFirstSlash) {
    return createLocalDate(Number(yearFirstSlash[1]), Number(yearFirstSlash[2]) - 1, Number(yearFirstSlash[3]), yearFirstSlash[4] ?? '')
  }

  const numeric = raw.match(/^([0-9]{1,2})[/-]([0-9]{1,2})(?:[/-]([0-9]{2,4}))?(?:\s+(.+))?$/)
  if (numeric) {
    const yearText = numeric[3]
    const year = yearText ? (yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText)) : new Date().getFullYear()
    return createLocalDate(year, Number(numeric[2]) - 1, Number(numeric[1]), numeric[4] ?? '')
  }

  const isoDate = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}:?\d{2}))?$/)
  if (isoDate) return createLocalDate(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3]), isoDate[4] ?? '')

  const isoPrefix = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ]|$)/)
  if (isoPrefix && !createLocalDate(Number(isoPrefix[1]), Number(isoPrefix[2]) - 1, Number(isoPrefix[3]), '')) return null

  const fallback = new Date(raw)
  return Number.isNaN(fallback.getTime()) ? null : fallback
}

export function formatCapturedDate(value: string): string {
  const parsed = parseFriendlyDate(value)
  if (!parsed) return ''

  const day = String(parsed.getDate()).padStart(2, '0')
  const year = parsed.getFullYear()
  const formattedDay = `${day} ${parsed.toLocaleString('en', { month: 'long' })} ${year}`
  const hasTime = /(?:\d{1,2}:\d{2}\s*$|\d{3,4}\s*$|\d{1,2}\s*(?:am|pm)\s*$)/i.test(value)
  if (!hasTime) return formattedDay

  const hours = String(parsed.getHours()).padStart(2, '0')
  const minutes = String(parsed.getMinutes()).padStart(2, '0')
  return `${formattedDay}, ${hours}:${minutes}`
}