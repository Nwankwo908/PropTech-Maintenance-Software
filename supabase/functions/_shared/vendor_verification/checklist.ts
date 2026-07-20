/**
 * Landlord-facing verification checklist derived from a vendor_verifications row.
 * Mirrored on the client in `src/lib/vendorVerificationChecklist.ts` — keep in sync.
 */

export type VerificationItemId =
  | "license"
  | "coi_coverage"
  | "background_check"
  | "w9"
  | "trade_categories"
  | "service_area"
  | "availability"

export type VerificationItemStatus =
  | "complete"
  | "action_needed"
  | "pending"
  | "missing"

export type VerificationChecklistItem = {
  id: VerificationItemId
  label: string
  status: VerificationItemStatus
  detail: string
  required: boolean
}

export type VerificationServiceArea = {
  zips?: string[]
  cities?: string[]
  counties?: string[]
  radiusMiles?: number | null
  centerAddress?: string | null
}

export type VerificationRecord = {
  license_status?: string | null
  license_number?: string | null
  license_state?: string | null
  coi_general_liability?: number | null
  coi_expiration?: string | null
  coi_additional_insured?: boolean | null
  coi_status?: string | null
  background_check_status?: string | null
  w9_received?: boolean | null
  trade_categories?: string[] | null
  service_area?: VerificationServiceArea | Record<string, unknown> | null
  availability?: string | null
}

export type VerificationChecklist = {
  items: VerificationChecklistItem[]
  overall: "verified" | "needs_review"
  completeCount: number
  requiredCount: number
  missingReasons: string[]
}

const MIN_GENERAL_LIABILITY = 1_000_000

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function serviceAreaHasCoverage(
  area: VerificationRecord["service_area"],
): boolean {
  if (!area || typeof area !== "object") return false
  const a = area as VerificationServiceArea
  const lists = [a.zips, a.cities, a.counties].filter(
    (l): l is string[] => Array.isArray(l) && l.length > 0,
  )
  if (lists.length > 0) return true
  if (typeof a.radiusMiles === "number" && a.radiusMiles > 0) return true
  return false
}

function licenseItem(record: VerificationRecord): VerificationChecklistItem {
  const status = (record.license_status ?? "").toLowerCase()
  if (["verified", "active", "manual_verified"].includes(status)) {
    return {
      id: "license",
      label: "State License",
      status: "complete",
      required: true,
      detail: record.license_number
        ? `${record.license_number} · Active (simulated)`
        : "Active (simulated)",
    }
  }
  if (["expired", "not_found"].includes(status)) {
    return {
      id: "license",
      label: "State License",
      status: "action_needed",
      required: true,
      detail: status === "expired"
        ? "License expired — needs renewal (simulated)"
        : "No match in state licensing database (simulated)",
    }
  }
  return {
    id: "license",
    label: "State License",
    status: "missing",
    required: true,
    detail: "Not submitted yet",
  }
}

function coiCoverageItem(record: VerificationRecord): VerificationChecklistItem {
  const gl = typeof record.coi_general_liability === "number"
    ? record.coi_general_liability
    : null
  const exp = record.coi_expiration ?? null
  if (gl == null) {
    return {
      id: "coi_coverage",
      label: "General Liability ≥ $1M",
      status: "missing",
      required: true,
      detail: "Insurance certificate not uploaded yet",
    }
  }
  const meetsCoverage = gl >= MIN_GENERAL_LIABILITY
  const notExpired = !exp || exp >= todayIso()
  if (meetsCoverage && notExpired) {
    return {
      id: "coi_coverage",
      label: "General Liability ≥ $1M",
      status: "complete",
      required: true,
      detail: `$${gl.toLocaleString()} general liability${
        exp ? ` · valid through ${exp}` : ""
      } (simulated)`,
    }
  }
  return {
    id: "coi_coverage",
    label: "General Liability ≥ $1M",
    status: "action_needed",
    required: true,
    detail: !meetsCoverage
      ? `$${gl.toLocaleString()} is below the $1M minimum (simulated)`
      : "Insurance certificate is expired (simulated)",
  }
}

function backgroundItem(record: VerificationRecord): VerificationChecklistItem {
  const status = (record.background_check_status ?? "").toLowerCase()
  if (status === "clear") {
    return {
      id: "background_check",
      label: "Background Check Passed",
      status: "complete",
      required: true,
      detail: "Background check clear (simulated Checkr)",
    }
  }
  if (status === "consider") {
    return {
      id: "background_check",
      label: "Background Check Passed",
      status: "action_needed",
      required: true,
      detail: "Background check needs review (simulated Checkr)",
    }
  }
  if (status === "pending") {
    return {
      id: "background_check",
      label: "Background Check Passed",
      status: "pending",
      required: true,
      detail: "Background check in progress (simulated Checkr)",
    }
  }
  return {
    id: "background_check",
    label: "Background Check Passed",
    status: "missing",
    required: true,
    detail: "Not started yet",
  }
}

function w9Item(record: VerificationRecord): VerificationChecklistItem {
  return record.w9_received === true
    ? {
      id: "w9",
      label: "W-9 Received",
      status: "complete",
      required: true,
      detail: "W-9 on file",
    }
    : {
      id: "w9",
      label: "W-9 Received",
      status: "missing",
      required: true,
      detail: "W-9 not uploaded yet",
    }
}

function tradeItem(record: VerificationRecord): VerificationChecklistItem {
  const trades = Array.isArray(record.trade_categories)
    ? record.trade_categories.filter((t) => typeof t === "string" && t.trim())
    : []
  return trades.length > 0
    ? {
      id: "trade_categories",
      label: "Trade Categories",
      status: "complete",
      required: true,
      detail: `${trades.length} trade${trades.length === 1 ? "" : "s"} selected`,
    }
    : {
      id: "trade_categories",
      label: "Trade Categories",
      status: "missing",
      required: true,
      detail: "No trades selected yet",
    }
}

function serviceAreaItem(record: VerificationRecord): VerificationChecklistItem {
  return serviceAreaHasCoverage(record.service_area)
    ? {
      id: "service_area",
      label: "Service Area",
      status: "complete",
      required: true,
      detail: "Coverage area provided",
    }
    : {
      id: "service_area",
      label: "Service Area",
      status: "missing",
      required: true,
      detail: "No service area provided yet",
    }
}

function availabilityItem(
  record: VerificationRecord,
): VerificationChecklistItem {
  const availability = (record.availability ?? "active").toLowerCase()
  return {
    id: "availability",
    label: "Availability",
    status: "complete",
    required: false,
    detail: availability === "paused"
      ? "Currently paused for new work"
      : "Active and accepting new work",
  }
}

export function computeVerificationChecklist(
  record: VerificationRecord,
): VerificationChecklist {
  const items: VerificationChecklistItem[] = [
    licenseItem(record),
    coiCoverageItem(record),
    backgroundItem(record),
    w9Item(record),
    tradeItem(record),
    serviceAreaItem(record),
    availabilityItem(record),
  ]

  const required = items.filter((item) => item.required)
  const completeRequired = required.filter((item) => item.status === "complete")
  const missingReasons = required
    .filter((item) => item.status !== "complete")
    .map((item) => item.detail)

  return {
    items,
    overall: completeRequired.length === required.length
      ? "verified"
      : "needs_review",
    completeCount: completeRequired.length,
    requiredCount: required.length,
    missingReasons,
  }
}
