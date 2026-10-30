/** Splits a plain-text Gmail body into what the reader wrote, the quoted history and the signature/footer. */
export interface ParsedEmailBody { body: string; quoted: string; footer: string }
export interface QuotedHeader { fields: { label: string; value: string }[]; rest: string }

const FOOTER_START = /^(--\s*|~~\/\/~~|_{5,}|Disclaimer\s*:.*)$/i
const QUOTE_INTRO = /^(On .+ wrote:|-{2,}\s*(Original|Forwarded) Message\s*-{2,}|\*?From:\*?\s.+)$/i
const HEADER_FIELD = /^\*?(From|Sent|Date|To|Cc|Bcc|Subject):\*?\s*(.*)$/i

const trimBlank = (lines: string[]) => lines.join('\n').replace(/^\s*\n|\s+$/g, '')

export function parseEmailBody(text: string): ParsedEmailBody {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let quoteAt = lines.findIndex((line, i) => line.startsWith('>') || (QUOTE_INTRO.test(line.trim()) && (!/^\*?From:/i.test(line.trim()) || lines.slice(i + 1, i + 4).some(next => /^\*?(Sent|Date):/i.test(next.trim())))))
  if (quoteAt < 0) quoteAt = lines.length
  // "On … wrote:" often wraps onto the line above the first ">".
  else if (lines[quoteAt].startsWith('>')) for (let i = quoteAt - 1; i >= Math.max(0, quoteAt - 2) && lines[i].trim(); i--) if (/wrote:\s*$/.test(lines[i]) || /^On /.test(lines[i])) quoteAt = i
  const footerAt = lines.slice(0, quoteAt).findIndex(line => FOOTER_START.test(line.trim()))
  const bodyEnd = footerAt < 0 ? quoteAt : footerAt
  return { body: trimBlank(lines.slice(0, bodyEnd)), footer: trimBlank(lines.slice(bodyEnd, quoteAt)), quoted: trimBlank(lines.slice(quoteAt)) }
}

/** Removes one level of "> " quoting. */
export const unquote = (text: string) => text.split('\n').map(line => line.replace(/^> ?/, '')).join('\n')

/** Pulls the From/Sent/To/Cc/Subject block (hard-wrapped lines rejoined) off the top of a quoted message. */
export function parseQuotedHeader(text: string): QuotedHeader {
  const lines = text.split('\n'); const fields: QuotedHeader['fields'] = []
  let i = 0
  while (i < lines.length && (!lines[i].trim() || /wrote:\s*$|^-{2,}/.test(lines[i].trim()))) i++
  for (; i < lines.length; i++) {
    const line = lines[i].trim(); const match = HEADER_FIELD.exec(line)
    if (match) fields.push({ label: match[1][0].toUpperCase() + match[1].slice(1).toLowerCase(), value: match[2] })
    else if (line && fields.length) fields[fields.length - 1].value += ` ${line}`
    else break
  }
  return fields.length ? { fields, rest: trimBlank(lines.slice(i)) } : { fields, rest: text }
}

/** "Saurabh Gupta <s@x.com>; rohit@x.com" → ["Saurabh Gupta", "rohit@x.com"]. */
export const headerNames = (value: string) => value.split(/[;,](?![^<]*>)/).map(part => part.replace(/<[^>]*>/, '').replace(/["']/g, '').trim() || (/<([^>]+)>/.exec(part)?.[1] ?? '')).filter(Boolean)

/** Short readable label for a raw URL: host + first path segment. */
export function linkLabel(url: string) {
  try { const u = new URL(url); const seg = u.pathname.split('/').filter(Boolean)[0]; return `${u.hostname.replace(/^www\./, '')}${seg ? `/${seg}` : ''}` } catch { return url }
}
