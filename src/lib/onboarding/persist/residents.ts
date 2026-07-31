/**
 * Fetch onboarding residents + lease/rent parsers.
 */
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { supabase } from '@/lib/supabase'
import {
  normalizeOnboardingOccupancyStatus,
  type OnboardingOccupancyStatus,
} from '../types'

export type OnboardingResident = {
  id: string
  residentId: string
  fullName: string
  unit: string
  building: string
  email: string
  phone: string
  monthlyRent: number | null
  rentDueDay: number | null
  leaseStart: string | null
  leaseEnd: string | null
  maintenanceResponsibilitiesClause: string | null
  occupancyStatus: OnboardingOccupancyStatus
}

export async function fetchOnboardingResidents(
  landlordId: string = getActiveLandlordId(),
): Promise<OnboardingResident[]> {
  if (!supabase) return []

  const { data, error } = await supabase
    .from('users')
    .select(
      'id, resident_id, full_name, email, phone, unit, building, status, monthly_rent, rent_due_day, move_in_date, lease_end_date, maintenance_responsibilities_clause',
    )
    .eq('landlord_id', landlordId)
    .order('created_at', { ascending: true })

  if (error) {
    // Columns may be missing before migrations — fall back without newer fields.
    if (/monthly_rent|rent_due_day|maintenance_responsibilities_clause|column/i.test(error.message)) {
      const { data: legacy, error: legacyError } = await supabase
        .from('users')
        .select('id, resident_id, full_name, email, phone, unit, building, status, move_in_date, lease_end_date')
        .eq('landlord_id', landlordId)
        .order('created_at', { ascending: true })
      if (legacyError) {
        console.warn('[landlordOnboarding] fetch residents', legacyError.message)
        return []
      }
      return (legacy ?? []).map((row) => mapOnboardingResidentRow(row as Record<string, unknown>))
    }
    console.warn('[landlordOnboarding] fetch residents', error.message)
    return []
  }

  return (data ?? []).map((row) => mapOnboardingResidentRow(row as Record<string, unknown>))
}

function mapOnboardingResidentRow(row: Record<string, unknown>): OnboardingResident {
  const monthlyRaw = row.monthly_rent
  const dueRaw = row.rent_due_day
  const monthlyRent =
    monthlyRaw == null || monthlyRaw === ''
      ? null
      : Number(monthlyRaw)
  const rentDueDay =
    dueRaw == null || dueRaw === ''
      ? null
      : Number(dueRaw)
  const clauseRaw = row.maintenance_responsibilities_clause
  const clause =
    typeof clauseRaw === 'string' && clauseRaw.trim() ? clauseRaw.trim() : null
  return {
    id: String(row.id ?? ''),
    residentId: String(row.resident_id ?? ''),
    fullName: String(row.full_name ?? ''),
    unit: String(row.unit ?? ''),
    building: String(row.building ?? ''),
    email: String(row.email ?? ''),
    phone: String(row.phone ?? ''),
    monthlyRent: Number.isFinite(monthlyRent) ? monthlyRent : null,
    rentDueDay:
      Number.isFinite(rentDueDay) && rentDueDay! >= 1 && rentDueDay! <= 31
        ? Math.trunc(rentDueDay!)
        : null,
    leaseStart: asOptionalDateString(
      typeof row.move_in_date === 'string' ? row.move_in_date : null,
    ),
    leaseEnd: asOptionalDateString(
      typeof row.lease_end_date === 'string' ? row.lease_end_date : null,
    ),
    maintenanceResponsibilitiesClause: clause,
    occupancyStatus: normalizeOnboardingOccupancyStatus(row.status),
  }
}

function asOptionalDateString(value: string | null | undefined): string | null {
  if (!value?.trim()) return null
  return value.trim().slice(0, 10)
}

/** Parse "$2,850" / "2850" into a numeric rent amount. */
export function parseMonthlyRentInput(value: string): number | null {
  const cleaned = value.replace(/[^0-9.]/g, '')
  if (!cleaned) return null
  const amount = Number(cleaned)
  if (!Number.isFinite(amount) || amount < 0) return null
  return amount
}

/** Parse rent due day (1–31). */
export function parseRentDueDayInput(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const day = Number.parseInt(trimmed, 10)
  if (!Number.isFinite(day) || day < 1 || day > 31) return null
  return day
}

/** Normalize date input (YYYY-MM-DD) for Postgres date columns. */
export function parseLeaseDateInput(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null
  const ms = Date.parse(`${trimmed}T12:00:00`)
  if (!Number.isFinite(ms)) return null
  return trimmed
}
