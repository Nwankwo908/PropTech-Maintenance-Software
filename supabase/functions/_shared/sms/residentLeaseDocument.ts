/**
 * Find an on-file lease PDF for a resident and mint a short-lived view link.
 *
 * Hard rule: only attach when tenant **name** match confidence is high.
 * Low / ambiguous confidence → send nothing (never another tenant's lease).
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"

export const LEASE_DOCUMENT_BUCKET = "landlord-onboarding-documents"
const SIGNED_URL_TTL_SEC = 24 * 60 * 60

/** Filename-only name hits are weaker than extracted lessee name. */
export const MIN_LEASE_DOC_MATCH_SCORE = 80
const EXTRACTED_NAME_SCORE = 100
const FILENAME_FULL_NAME_SCORE = 85

const LEASING_CATEGORIES = new Set(["lease_agreement", "move_in_document"])

function normalizePersonKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function nameParts(fullName: string): string[] {
  return normalizePersonKey(fullName).split(" ").filter((part) => part.length >= 2)
}

/** First + last (or more) must align — never last-name-only / unit-only. */
export function personNamesMatch(left: string, right: string): boolean {
  const aParts = nameParts(left)
  const bParts = nameParts(right)
  if (aParts.length < 2 || bParts.length < 2) return false
  const aKey = aParts.join(" ")
  const bKey = bParts.join(" ")
  if (aKey === bKey) return true
  const aFirst = aParts[0]
  const bFirst = bParts[0]
  const aLast = aParts[aParts.length - 1]
  const bLast = bParts[bParts.length - 1]
  return Boolean(aFirst && bFirst && aLast && bLast && aFirst === bFirst && aLast === bLast)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function textHasNameToken(haystack: string, token: string): boolean {
  if (!token || token.length < 2) return false
  return new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(token)}(?:[^a-z0-9]|$)`, "i").test(
    haystack,
  )
}

function filenameContainsFullName(fileName: string, fullName: string): boolean {
  const file = fileName.toLowerCase()
  const parts = nameParts(fullName)
  if (parts.length < 2) return false
  return parts.every((part) => textHasNameToken(file, part))
}

function namesFromExtractedPayload(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return []
  const root = payload as Record<string, unknown>
  const names: string[] = []
  const push = (raw: unknown) => {
    if (typeof raw !== "string" || !raw.trim()) return
    // Split combined lessee lines: "A, B & C"
    for (const piece of raw.split(/[,&/]| and /i)) {
      const cleaned = piece.trim()
      if (nameParts(cleaned).length >= 2) names.push(cleaned)
    }
  }
  if (Array.isArray(root.leases)) {
    for (const row of root.leases) {
      if (row && typeof row === "object") {
        push((row as Record<string, unknown>).residentName)
        push((row as Record<string, unknown>).resident_name)
      }
    }
  }
  if (Array.isArray(root.residents)) {
    for (const row of root.residents) {
      if (row && typeof row === "object") {
        push((row as Record<string, unknown>).fullName)
        push((row as Record<string, unknown>).full_name)
        push((row as Record<string, unknown>).residentName)
      }
    }
  }
  push(root.residentName)
  push(root.fullName)
  return names
}

export type LeaseDocMatchInput = {
  documentCategory?: string | null
  fileName?: string | null
  extractedPayload?: unknown
}

export type LeaseResidentMatchInput = {
  fullName: string | null
  unit?: string | null
}

export type LeaseDocMatchResult = {
  matched: boolean
  score: number
  reason: "extracted_name" | "filename_full_name" | "none"
}

/**
 * Score a lease document against a resident by **tenant name only**.
 * Unit / address / last-name-alone never qualify.
 */
export function scoreLeaseDocumentAgainstResident(
  doc: LeaseDocMatchInput,
  resident: LeaseResidentMatchInput,
): LeaseDocMatchResult {
  const category = (doc.documentCategory ?? "").trim().toLowerCase()
  if (!LEASING_CATEGORIES.has(category)) {
    return { matched: false, score: 0, reason: "none" }
  }

  const fullName = (resident.fullName ?? "").trim()
  if (nameParts(fullName).length < 2) {
    return { matched: false, score: 0, reason: "none" }
  }

  const payloadNames = namesFromExtractedPayload(doc.extractedPayload)
  if (payloadNames.some((name) => personNamesMatch(name, fullName))) {
    return { matched: true, score: EXTRACTED_NAME_SCORE, reason: "extracted_name" }
  }

  const file = (doc.fileName ?? "").trim()
  if (filenameContainsFullName(file, fullName)) {
    return { matched: true, score: FILENAME_FULL_NAME_SCORE, reason: "filename_full_name" }
  }

  return { matched: false, score: 0, reason: "none" }
}

/** @deprecated Prefer scoreLeaseDocumentAgainstResident — kept for call-site compatibility. */
export function leaseDocumentMatchesResident(
  doc: LeaseDocMatchInput,
  resident: LeaseResidentMatchInput,
): boolean {
  const result = scoreLeaseDocumentAgainstResident(doc, resident)
  return result.matched && result.score >= MIN_LEASE_DOC_MATCH_SCORE
}

/** @deprecated Unit is no longer used for lease PDF matching. */
export function isDiscriminatingUnit(unit: string | null | undefined): boolean {
  const token = (unit ?? "")
    .toLowerCase()
    .replace(/^(unit|apt|apartment|#)\s*/i, "")
    .replace(/[^a-z0-9]/g, "")
    .trim()
  return token.length >= 2
}

function asUploadedDocs(raw: unknown): Array<{
  documentCategory?: string | null
  fileName?: string | null
  extractedPayload?: unknown
  storageBucket?: string | null
  storagePath?: string | null
}> {
  if (!Array.isArray(raw)) return []
  return raw.filter((row) => row && typeof row === "object") as Array<{
    documentCategory?: string | null
    fileName?: string | null
    extractedPayload?: unknown
    storageBucket?: string | null
    storagePath?: string | null
  }>
}

/**
 * Signed URL to the resident's lease file, or null when name confidence is
 * below threshold or more than one document ties.
 */
export async function findResidentLeaseDocumentUrl(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    fullName: string | null
    unit?: string | null
  },
): Promise<string | null> {
  const { data } = await supabase
    .from("landlord_onboarding")
    .select("draft_state")
    .eq("landlord_id", params.landlordId)
    .maybeSingle()

  const draft = data?.draft_state && typeof data.draft_state === "object"
    ? data.draft_state as Record<string, unknown>
    : {}
  const formDraft = draft.formDraft && typeof draft.formDraft === "object"
    ? draft.formDraft as Record<string, unknown>
    : {}
  const docs = asUploadedDocs(formDraft.uploadDocuments)
  const resident = { fullName: params.fullName, unit: params.unit ?? null }

  const scored = docs
    .map((doc) => ({
      doc,
      ...scoreLeaseDocumentAgainstResident(doc, resident),
    }))
    .filter((row) =>
      row.matched &&
      row.score >= MIN_LEASE_DOC_MATCH_SCORE &&
      Boolean(row.doc.storagePath?.trim())
    )
    .sort((a, b) => b.score - a.score)

  if (scored.length === 0) {
    console.info("[lease-doc] no high-confidence name match; skipping attachment", {
      landlordId: params.landlordId,
      fullName: params.fullName,
    })
    return null
  }

  const top = scored[0]
  const tied = scored.filter((row) => row.score === top.score)
  if (tied.length > 1) {
    console.warn("[lease-doc] ambiguous high-confidence matches; skipping attachment", {
      landlordId: params.landlordId,
      fullName: params.fullName,
      files: tied.map((row) => row.doc.fileName),
    })
    return null
  }

  const storagePath = top.doc.storagePath?.trim()
  if (!storagePath) return null

  const bucket = top.doc.storageBucket?.trim() || LEASE_DOCUMENT_BUCKET
  const { data: signed, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SEC)
  if (error || !signed?.signedUrl) {
    console.warn("[lease-doc] signed URL failed", error?.message ?? "missing url")
    return null
  }
  return signed.signedUrl
}
