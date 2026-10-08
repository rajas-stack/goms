import { isHttpUrl, type TenderWebsite } from '@goms/domain'

/** One line of the General "Websites" value. Selected portals are stored as
 *  "Name (https://link)" so the saved text stays readable in exports and keeps
 *  its link even if the website is later renamed or removed in Settings. */
export type WebsiteEntry =
  | { kind: 'site'; name: string; url: string; line: string }
  | { kind: 'text'; text: string; line: string }

const NAMED_LINK = /^(.*\S)\s+\((https?:\/\/\S+)\)$/i

export function formatWebsiteLine(site: { name: string; url: string }): string {
  return `${site.name.trim()} (${site.url.trim()})`
}

function parseLine(line: string): WebsiteEntry {
  const named = NAMED_LINK.exec(line)
  if (named && isHttpUrl(named[2])) return { kind: 'site', name: named[1].trim(), url: named[2], line }
  if (isHttpUrl(line) && !/\s/.test(line)) return { kind: 'site', name: line, url: line, line }
  return { kind: 'text', text: line, line }
}

export function parseWebsiteValue(value: string): WebsiteEntry[] {
  return value.replace(/\r\n?/g, '\n').split('\n').map(line => line.trim()).filter(Boolean).map(parseLine)
}

function savedMatch(entry: WebsiteEntry, saved: readonly TenderWebsite[]): TenderWebsite | undefined {
  return entry.kind === 'site' ? saved.find(site => site.url.trim() === entry.url) : undefined
}

/** What each stored line is called in the dropdown: a saved site's current
 *  name when the link matches one, otherwise the stored name / text. */
export function entryLabel(entry: WebsiteEntry, saved: readonly TenderWebsite[]): string {
  return savedMatch(entry, saved)?.name ?? (entry.kind === 'site' ? entry.name : entry.text)
}

/** Rebuild the stored value from the dropdown's chosen labels. Lines already
 *  stored keep their text (refreshed to the saved site's current name/link);
 *  newly chosen saved sites are appended as "Name (link)". */
export function websitesFromLabels(labels: readonly string[], current: string, saved: readonly TenderWebsite[]): string {
  const entries = parseWebsiteValue(current)
  const lines = labels.flatMap(label => {
    const existing = entries.find(entry => entryLabel(entry, saved) === label)
    if (existing) {
      const site = savedMatch(existing, saved)
      return [site ? formatWebsiteLine(site) : existing.line]
    }
    const site = saved.find(candidate => candidate.name === label)
    return site ? [formatWebsiteLine(site)] : []
  })
  return [...new Set(lines)].join('\n')
}
