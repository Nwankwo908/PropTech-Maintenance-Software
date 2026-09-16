export type MessageTextPart =
  | { type: 'text'; text: string }
  | { type: 'url'; text: string; href: string }

const URL_FINDER = /\b(?:https?:\/\/|www\.)[^\s<>"'\\]+/gi

const TRAILING_PUNCT = /[.,;:!?]+$/
const WRAP_CHARS = new Set(['"', "'", '”', '’', '»'])

function stripTrailingUrlJunk(raw: string): { url: string; trailing: string } {
  let url = raw
  let trailing = ''
  while (url.length > 0) {
    const last = url[url.length - 1]!
    if (WRAP_CHARS.has(last) || last === ']' || last === '>') {
      trailing = last + trailing
      url = url.slice(0, -1)
      continue
    }
    if (last === ')' && countChar(url, '(') < countChar(url, ')')) {
      trailing = last + trailing
      url = url.slice(0, -1)
      continue
    }
    break
  }
  const punct = url.match(TRAILING_PUNCT)
  if (punct) {
    trailing = punct[0] + trailing
    url = url.slice(0, -punct[0].length)
  }
  return { url, trailing }
}

function countChar(value: string, char: string): number {
  let n = 0
  for (const c of value) if (c === char) n += 1
  return n
}

function hrefForMatchedUrl(matched: string): string | null {
  const href = /^www\./i.test(matched) ? `https://${matched}` : matched
  try {
    const parsed = new URL(href)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    if (!parsed.hostname.includes('.')) return null
    return parsed.href
  } catch {
    return null
  }
}

/** Split SMS/email copy so Communication can render real URLs as links. */
export function splitMessageTextWithUrls(text: string): MessageTextPart[] {
  if (!text) return []
  const parts: MessageTextPart[] = []
  const re = new RegExp(URL_FINDER.source, URL_FINDER.flags)
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) != null) {
    const start = match.index
    if (start > cursor) {
      parts.push({ type: 'text', text: text.slice(cursor, start) })
    }
    const { url, trailing } = stripTrailingUrlJunk(match[0] ?? '')
    const href = hrefForMatchedUrl(url)
    if (href && url) {
      parts.push({ type: 'url', text: url, href })
    } else {
      parts.push({ type: 'text', text: match[0] ?? '' })
    }
    if (trailing) parts.push({ type: 'text', text: trailing })
    cursor = start + (match[0]?.length ?? 0)
  }
  if (cursor < text.length) {
    parts.push({ type: 'text', text: text.slice(cursor) })
  }
  return parts
}
