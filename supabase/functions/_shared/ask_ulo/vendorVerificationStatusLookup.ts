/**
 * Vendor verification / compliance status — same source as the Vendors list
 * Verification pill + capacity chip and the vendor profile Compliance & verification section.
 *
 * Source of truth: `vendor_verifications` (+ roster `vendors.active` for capacity after verified).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { AskUloCitation } from "./opsGraphLookup.ts"
import { polishAskUloProse } from "./responsePolish.ts"
import { vendorDisplayName } from "./vendorNames.ts"
import {
  computeVerificationChecklist,
  type VerificationRecord,
} from "../vendor_verification/checklist.ts"

export type VendorVerificationStatusRow = {
  vendorId: string | null
  name: string
  /** Raw vendor_verifications.status, or null when no verification row. */
  verificationStatus: string | null
  /** Landlord-facing verification pill label. */
  verificationLabel: string
  /** Capacity chip: Pending | Active | Paused — matches UI chips. */
  capacityLabel: "Pending" | "Active" | "Paused"
  checklistComplete: number
  checklistRequired: number
  missingReasons: string[]
}

export type VendorVerificationStatusResult = {
  available: boolean
  found: boolean
  ranked: VendorVerificationStatusRow[]
  bullets: string[]
  citations: AskUloCitation[]
  markdown: string
}

const VENDOR_SUBJECT_RE =
  /\b(vendors?|trades?people|contractors?|plumbers?|electricians?|hvac\s+tech)\b/i

/**
 * “Show vendor verification status”, “which vendors are verified/pending”, etc.
 * Prefer this over inactivity when the question is about verification/compliance docs.
 */
export function isVendorVerificationStatusQuestion(question: string): boolean {
  const q = question.trim()
  if (!q) return false

  const hasVerifLang =
    /\bverif(?:y|ies|ied|ication|ying)\b/i.test(q) ||
    /\bcompliance\b/i.test(q) ||
    /\b(?:license|coi|w-?9|background\s+check)\b/i.test(q) ||
    /\b(?:pending|verified)\s+vendors?\b/i.test(q) ||
    /\bvendors?\s+(?:that\s+are\s+)?(?:pending|verified)\b/i.test(q)

  if (!hasVerifLang) return false

  // Explicit verification/compliance phrasing always qualifies (even without “vendor”).
  if (
    /\bvendor\s+verif/i.test(q) ||
    /\bverif(?:ication)?\s+status\b/i.test(q) ||
    /\bcompliance\s+(?:&|and)?\s*verif/i.test(q) ||
    /\bshow\b.{0,40}\bverif/i.test(q) ||
    /\bwhich\s+vendors?\b.{0,40}\b(?:verified|pending|compliance)\b/i.test(q) ||
    /\b(?:verified|pending)\s+vendors?\b/i.test(q)
  ) {
    return true
  }

  return VENDOR_SUBJECT_RE.test(q) && hasVerifLang
}

function verificationPillLabel(status: string | null | undefined): string {
  const s = (status ?? "").trim().toLowerCase()
  if (!s) return "Not started"
  const map: Record<string, string> = {
    verified: "Verified",
    needs_review: "Needs review",
    submitted: "In review",
    in_progress: "In progress",
    invited: "Invited",
  }
  return map[s] ?? status!.trim()
}

function capacityChipLabel(input: {
  verificationStatus: string | null | undefined
  vendorActive: boolean | null | undefined
  availability: string | null | undefined
}): "Pending" | "Active" | "Paused" {
  const verified = (input.verificationStatus ?? "").trim().toLowerCase() === "verified"
  if (!verified) return "Pending"
  if (input.vendorActive === false) return "Paused"
  if ((input.availability ?? "").trim().toLowerCase() === "paused") return "Paused"
  return "Active"
}

function statusSortRank(status: string | null): number {
  const s = (status ?? "").toLowerCase()
  if (s === "needs_review") return 0
  if (s === "submitted") return 1
  if (s === "in_progress") return 2
  if (s === "invited") return 3
  if (!s) return 4
  if (s === "verified") return 5
  return 6
}

function buildMarkdown(ranked: VendorVerificationStatusRow[]): string {
  if (ranked.length === 0) {
    return [
      "I don't see any vendors on this roster yet — so there's no verification status to report.",
      "",
      "### What I'd do",
      "Invite vendors from the Vendors page. Once they start verification, their status shows on the vendor profile chip and the Compliance & verification section.",
    ].join("\n")
  }

  const verified = ranked.filter((r) => r.verificationStatus === "verified")
  const pending = ranked.filter((r) => r.verificationStatus !== "verified")
  const needsReview = ranked.filter((r) => r.verificationStatus === "needs_review")

  const leadParts: string[] = []
  if (verified.length === ranked.length) {
    leadParts.push(
      `All **${ranked.length}** vendor${ranked.length === 1 ? "" : "s"} on the roster are **Verified** and ready for assignments.`,
    )
  } else if (verified.length === 0) {
    leadParts.push(
      `None of your **${ranked.length}** vendor${ranked.length === 1 ? "" : "s"} are fully verified yet — capacity chips stay **Pending** until verification is complete.`,
    )
  } else {
    leadParts.push(
      `**${verified.length}** of **${ranked.length}** vendors are **Verified**. **${pending.length}** still show **Pending** (or need review) on the verification chip.`,
    )
  }
  if (needsReview.length > 0) {
    leadParts.push(
      `**${needsReview.length}** need${needsReview.length === 1 ? "s" : ""} a compliance review before you treat them as Active.`,
    )
  }

  const out: string[] = [leadParts.join(" "), "", "### Verification status"]

  for (const [i, row] of ranked.slice(0, 12).entries()) {
    const checklist =
      row.checklistRequired > 0
        ? ` · checklist ${row.checklistComplete}/${row.checklistRequired}`
        : ""
    const missing =
      row.missingReasons.length > 0
        ? ` — missing: ${row.missingReasons.slice(0, 3).join("; ")}`
        : ""
    out.push(
      `${i + 1}. **${row.name}** — ${row.verificationLabel} · capacity **${row.capacityLabel}**${checklist}${missing}`,
    )
  }

  out.push("")
  out.push("### What I'd do")
  if (needsReview.length > 0) {
    out.push(
      `Open **${needsReview[0]!.name}** first — review the Compliance & verification checklist, then mark them verified when documents check out.`,
    )
  } else if (pending.length > 0) {
    out.push(
      `Follow up with **${pending[0]!.name}** (and others still Pending) to finish license, insurance, background, and W-9 so their capacity chip can move to Active.`,
    )
  } else {
    out.push(
      "Roster verification looks complete. Use the Active vendors for new work orders; pause anyone who shouldn't take jobs.",
    )
  }

  return out.join("\n")
}

export async function vendorVerificationStatusLookup(
  supabase: SupabaseClient,
  input: { landlordId: string },
): Promise<VendorVerificationStatusResult> {
  const landlordId = input.landlordId.trim()
  const empty: VendorVerificationStatusResult = {
    available: false,
    found: false,
    ranked: [],
    bullets: [],
    citations: [],
    markdown: "",
  }
  if (!landlordId) return empty

  const [
    { data: vendors, error: vendorsErr },
    { data: verifications, error: verifErr },
  ] = await Promise.all([
    supabase
      .from("vendors")
      .select("id, name, active, category")
      .eq("landlord_id", landlordId),
    supabase
      .from("vendor_verifications")
      .select(
        "id, vendor_id, status, business_name, contact_name, license_status, license_number, license_state, coi_general_liability, coi_expiration, coi_additional_insured, coi_status, background_check_status, w9_received, trade_categories, service_area, availability",
      )
      .eq("landlord_id", landlordId),
  ])

  if (vendorsErr) {
    console.error("[ask_ulo/vendorVerificationStatus] vendors", vendorsErr.message)
  }
  if (verifErr) {
    console.error("[ask_ulo/vendorVerificationStatus] vendor_verifications", verifErr.message)
  }

  if (vendorsErr && !vendors) {
    return {
      ...empty,
      available: false,
      markdown:
        "I couldn't load vendor verification right now. Open Vendors and check each vendor's verification and capacity chips.",
    }
  }

  type VerifRow = Record<string, unknown>
  const verifByVendorId = new Map<string, VerifRow>()
  const orphanVerifs: VerifRow[] = []
  for (const row of (verifications ?? []) as VerifRow[]) {
    const vid = typeof row.vendor_id === "string" ? row.vendor_id : null
    if (vid) {
      // Prefer verified row if duplicates exist; otherwise keep latest-ish by presence.
      const existing = verifByVendorId.get(vid)
      const existingStatus = String(existing?.status ?? "")
      const nextStatus = String(row.status ?? "")
      if (!existing || (nextStatus === "verified" && existingStatus !== "verified")) {
        verifByVendorId.set(vid, row)
      }
    } else {
      orphanVerifs.push(row)
    }
  }

  const ranked: VendorVerificationStatusRow[] = []

  for (const v of vendors ?? []) {
    if (typeof v.id !== "string") continue
    const name = vendorDisplayName(v)
    if (!name) continue
    const verif = verifByVendorId.get(v.id) ?? null
    const verificationStatus =
      typeof verif?.status === "string" ? verif.status : null
    const availability =
      typeof verif?.availability === "string" ? verif.availability : null
    const checklist = computeVerificationChecklist(
      (verif ?? {}) as VerificationRecord,
    )
    ranked.push({
      vendorId: v.id,
      name,
      verificationStatus,
      verificationLabel: verificationPillLabel(verificationStatus),
      capacityLabel: capacityChipLabel({
        verificationStatus,
        vendorActive: typeof v.active === "boolean" ? v.active : null,
        availability,
      }),
      checklistComplete: checklist.completeCount,
      checklistRequired: checklist.requiredCount,
      missingReasons: checklist.missingReasons,
    })
  }

  // Invites not yet linked to a roster vendor row.
  for (const verif of orphanVerifs) {
    const name =
      (typeof verif.business_name === "string" && verif.business_name.trim()) ||
      (typeof verif.contact_name === "string" && verif.contact_name.trim()) ||
      "Invited vendor"
    const verificationStatus =
      typeof verif.status === "string" ? verif.status : null
    const availability =
      typeof verif.availability === "string" ? verif.availability : null
    const checklist = computeVerificationChecklist(verif as VerificationRecord)
    ranked.push({
      vendorId: null,
      name,
      verificationStatus,
      verificationLabel: verificationPillLabel(verificationStatus),
      capacityLabel: capacityChipLabel({
        verificationStatus,
        vendorActive: null,
        availability,
      }),
      checklistComplete: checklist.completeCount,
      checklistRequired: checklist.requiredCount,
      missingReasons: checklist.missingReasons,
    })
  }

  ranked.sort((a, b) => {
    const rank = statusSortRank(a.verificationStatus) - statusSortRank(b.verificationStatus)
    if (rank !== 0) return rank
    return a.name.localeCompare(b.name)
  })

  const found = ranked.some((r) => r.verificationStatus != null) || ranked.length > 0
  const markdown = polishAskUloProse(buildMarkdown(ranked))
  const bullets = ranked.slice(0, 8).map(
    (r) =>
      `${r.name}: ${r.verificationLabel} · ${r.capacityLabel}` +
      (r.checklistRequired > 0
        ? ` (${r.checklistComplete}/${r.checklistRequired})`
        : ""),
  )

  console.info(
    JSON.stringify({
      event: "ASK_ULO_VENDOR_VERIFICATION_STATUS",
      landlordId,
      vendorCount: ranked.length,
      verified: ranked.filter((r) => r.verificationStatus === "verified").length,
      pending: ranked.filter((r) => r.verificationStatus !== "verified").length,
    }),
  )

  return {
    available: true,
    found,
    ranked,
    bullets,
    citations: [
      {
        tool: "ops_graph",
        title: "Vendor verification status",
        citation: "vendor_verifications + vendors (profile chip / Compliance & verification)",
        excerpt: found
          ? `${ranked.filter((r) => r.verificationStatus === "verified").length} verified · ${ranked.filter((r) => r.verificationStatus !== "verified").length} pending`
          : "No vendors on roster",
      },
    ],
    markdown,
  }
}
