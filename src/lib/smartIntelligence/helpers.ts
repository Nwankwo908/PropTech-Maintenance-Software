import {
  parseIsoDateOnly,
  rentDueIsoForMonth,
  todayIsoDate,
} from '@/lib/residentLeaseCalendar'
import type { SmartInsight, SmartInsightPriority } from '@/lib/smartIntelligence/types'
import { PRIORITY_SCORE } from '@/lib/smartIntelligence/types'

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/).filter(Boolean)[0] || 'This resident'
}

export function possessive(fullName: string): string {
  return `${firstName(fullName)}'s`
}

export function formatUsd(amount: number): string {
  return amount.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

export function calendarDaysUntil(iso: string, now: Date): number | null {
  const target = parseIsoDateOnly(iso)
  if (!target) return null
  const today = todayIsoDate(now)
  const start = new Date(`${today}T12:00:00`).getTime()
  const end = new Date(`${target}T12:00:00`).getTime()
  return Math.round((end - start) / 86_400_000)
}

export function formatLongDate(iso: string | null | undefined): string | null {
  const parsed = parseIsoDateOnly(iso)
  if (!parsed) return null
  const year = Number(parsed.slice(0, 4))
  const month = Number(parsed.slice(5, 7))
  const day = Number(parsed.slice(8, 10))
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
  })
}

export function formatClock(iso: string | null | undefined): string | null {
  const raw = (iso ?? '').trim()
  if (!raw.includes('T')) return null
  const parsed = new Date(raw)
  if (!Number.isFinite(parsed.getTime())) return null
  return parsed.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export function nextRentDueIso(input: {
  now: Date
  rentDueDay: number | null
  leaseStartDate?: string | null
  leaseEndDate?: string | null
}): string | null {
  const dueDay =
    input.rentDueDay != null && Number.isFinite(input.rentDueDay)
      ? Math.min(31, Math.max(1, Math.trunc(input.rentDueDay)))
      : 1
  const today = todayIsoDate(input.now)
  const leaseStart = parseIsoDateOnly(input.leaseStartDate)
  const leaseEnd = parseIsoDateOnly(input.leaseEndDate)
  let year = input.now.getFullYear()
  let month = input.now.getMonth() + 1
  for (let i = 0; i < 4; i += 1) {
    const iso = rentDueIsoForMonth(year, month, dueDay)
    const inLease =
      (!leaseStart || iso >= leaseStart) && (!leaseEnd || iso <= leaseEnd)
    if (iso >= today && inLease) return iso
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  return null
}

export function scoreInsight(
  priority: SmartInsightPriority,
  extras?: {
    overdueDays?: number
    amount?: number
    waitingOnLandlord?: boolean
    safety?: boolean
    daysUntil?: number
  },
): number {
  let score = PRIORITY_SCORE[priority]
  if (extras?.safety) score += 160
  if (extras?.waitingOnLandlord) score += 90
  if (extras?.overdueDays && extras.overdueDays > 0) {
    score += Math.min(120, extras.overdueDays * 8)
  }
  if (extras?.amount && extras.amount > 0) {
    score += Math.min(180, Math.round(extras.amount / 15))
  }
  if (extras?.daysUntil != null && extras.daysUntil >= 0) {
    score += Math.max(0, 40 - extras.daysUntil)
  }
  return score
}

export function repairLabel(description: string | null, issueCategory: string | null): string {
  const firstLine = (description ?? '').trim().split('\n')[0]?.trim() ?? ''
  if (firstLine && !looksLikeStatusInquiry(firstLine)) {
    const clipped = firstLine.length > 48 ? `${firstLine.slice(0, 45).trim()}…` : firstLine
    return clipped.charAt(0).toLowerCase() + clipped.slice(1)
  }
  const category = (issueCategory ?? '').trim()
  if (category) return `${category.toLowerCase()} repair`
  return 'repair'
}

export function looksLikeStatusInquiry(description: string): boolean {
  const text = description.trim().toLowerCase()
  if (!text) return false
  if (/\?/.test(text)) return true
  return /^(who|what|when|where|did you|is my|status of|any update)\b/.test(text)
}

export function isClosedWorkStatus(status: string | null | undefined): boolean {
  const value = (status ?? '').trim().toLowerCase()
  return value === 'completed' || value === 'cancelled'
}

export function isSafetyTicket(input: {
  urgency?: string | null
  severity?: string | null
  priority?: string | null
}): boolean {
  const hay = `${input.urgency ?? ''} ${input.severity ?? ''} ${input.priority ?? ''}`.toLowerCase()
  return /emergency|critical|safety|hazard/.test(hay)
}

export function withScore(insight: Omit<SmartInsight, 'score'> & { score?: number }): SmartInsight {
  return { ...insight, score: insight.score ?? scoreInsight(insight.priority) }
}
