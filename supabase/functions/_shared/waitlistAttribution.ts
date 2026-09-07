/** Allowlisted UTM values only — never emails, phones, or free text. */

const UTM_VALUE_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/

export type WaitlistAttributionTouch = {
  source?: string
  medium?: string
  campaign?: string
  content?: string
  term?: string
  capturedAt?: string
}

function sanitizeUtmValue(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined
  const t = raw.trim()
  if (!t || t.length > 64) return undefined
  if (/@/.test(t) || /\d{7,}/.test(t)) return undefined
  if (!UTM_VALUE_RE.test(t)) return undefined
  return t.toLowerCase()
}

function parseTouch(raw: unknown): WaitlistAttributionTouch {
  if (!raw || typeof raw !== "object") return {}
  const rec = raw as Record<string, unknown>
  const out: WaitlistAttributionTouch = {}
  const source = sanitizeUtmValue(rec.source)
  const medium = sanitizeUtmValue(rec.medium)
  const campaign = sanitizeUtmValue(rec.campaign)
  const content = sanitizeUtmValue(rec.content)
  const term = sanitizeUtmValue(rec.term)
  if (source) out.source = source
  if (medium) out.medium = medium
  if (campaign) out.campaign = campaign
  if (content) out.content = content
  if (term) out.term = term
  if (typeof rec.capturedAt === "string" && ISO_RE.test(rec.capturedAt.trim())) {
    out.capturedAt = rec.capturedAt.trim()
  }
  return out
}

export function hasTouch(touch: WaitlistAttributionTouch): boolean {
  return Boolean(touch.source || touch.medium || touch.campaign || touch.content || touch.term)
}

export function parseWaitlistAttribution(raw: unknown): {
  firstTouch: WaitlistAttributionTouch
  latestTouch: WaitlistAttributionTouch
} | null {
  if (!raw || typeof raw !== "object") return null
  const rec = raw as Record<string, unknown>
  const firstTouch = parseTouch(rec.firstTouch)
  const latestTouch = parseTouch(rec.latestTouch)
  if (!hasTouch(firstTouch) && !hasTouch(latestTouch)) return null
  return { firstTouch, latestTouch }
}
