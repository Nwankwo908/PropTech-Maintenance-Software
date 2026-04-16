/**
 * Resident lifecycle notifications (re-export + named entrypoints per event).
 * Core implementation: `../_shared/resident_notify.ts`.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  notifyResident,
  type ResidentNotifyInput,
} from "../_shared/resident_notify.ts"

export {
  notifyResident,
  normalizePhoneFlexible,
  normalizeResidentNotificationChannel,
  normalizeResidentPhone,
  type ResidentNotificationChannel,
  type ResidentNotifyEvent,
  type ResidentNotifyInput,
} from "../_shared/resident_notify.ts"

type Base = Omit<ResidentNotifyInput, "event">

export function notifyResidentSubmitted(
  supabase: SupabaseClient,
  input: Base,
): Promise<void> {
  return notifyResident(supabase, { ...input, event: "ticket_submitted" })
}

export function notifyResidentVendorAssigned(
  supabase: SupabaseClient,
  input: Base,
): Promise<void> {
  return notifyResident(supabase, { ...input, event: "vendor_assigned" })
}

export function notifyResidentInProgress(
  supabase: SupabaseClient,
  input: Base,
): Promise<void> {
  return notifyResident(supabase, { ...input, event: "repair_in_progress" })
}

export function notifyResidentCompleted(
  supabase: SupabaseClient,
  input: Base,
): Promise<void> {
  return notifyResident(supabase, { ...input, event: "repair_completed" })
}
