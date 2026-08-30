const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Decode SMS/email wrapping and require a UUID job token. */
export function normalizeVendorJobToken(raw: string | null | undefined): string {
  let t = (raw ?? '').trim()
  if (!t) return ''
  try {
    t = decodeURIComponent(t).trim()
  } catch {
    /* already decoded */
  }
  t = t.replace(/^["']+|["']+$/g, '').trim()
  const pathMatch = t.match(/\/(?:w|estimate|upload|invoice)\/([0-9a-f-]{36})/i)
  if (pathMatch?.[1]) t = pathMatch[1]
  return UUID_RE.test(t) ? t : ''
}
