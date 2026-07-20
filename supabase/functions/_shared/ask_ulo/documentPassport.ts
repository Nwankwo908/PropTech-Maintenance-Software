/**
 * Document passport — the digital ID card on every Ask Ulo stored document.
 *
 * Used to pre-filter the corpus (geo, program, type, authority) before
 * hybrid keyword + semantic search, so e.g. an Atlanta rent question does
 * not retrieve unrelated state codes or Section 8–only rules.
 */

import { cadenceForDocumentType, type RefreshCadence } from "./refreshCadence.ts"

export type DocumentType =
  | "statute"
  | "regulation"
  | "court_opinion"
  | "municipal_code"
  | "building_code"
  | "housing_program_rule"
  | "agency_guidance"
  | "government_guide"
  | "maintenance_manual"
  | "other"

export type PublisherKind =
  | "legislature"
  | "court"
  | "agency"
  | "municipality"
  | "standards_body"
  | "manufacturer"
  | "housing_authority"
  | "other"

export type AuthorityTier =
  | "primary_official"
  | "agency_guidance"
  | "discovery_mirror"
  | "untrusted"

export type DocumentPassport = {
  documentType: DocumentType | null
  publisherName: string | null
  publisherKind: PublisherKind | null
  /** Hard legal obligation vs guidance / FAQ. */
  normativeType: "requirement" | "guidance" | null
  authorityTier: AuthorityTier | null
  countryCode: string
  stateCode: string | null
  countySlug: string | null
  citySlug: string | null
  housingProgram: string | null
  citation: string | null
  effectiveOn: string | null
  lastUpdatedOn: string | null
  replacesChunkId: string | null
  sourceUrl: string | null
  /** Refresh policy — how often to re-check the official source. */
  refreshCadence: RefreshCadence | null
  sourceCheckedAt: string | null
  nextCheckAt: string | null
  /** Court extras */
  courtSystem: string | null
  caseNumber: string | null
  holdingSummary: string | null
  /** Equipment-manual extras */
  manufacturer: string | null
  equipmentModel: string | null
  equipmentType: string | null
  manualVersion: string | null
}

const DOCUMENT_TYPES = new Set<string>([
  "statute",
  "regulation",
  "court_opinion",
  "municipal_code",
  "building_code",
  "housing_program_rule",
  "agency_guidance",
  "government_guide",
  "maintenance_manual",
  "other",
])

const PUBLISHER_KINDS = new Set<string>([
  "legislature",
  "court",
  "agency",
  "municipality",
  "standards_body",
  "manufacturer",
  "housing_authority",
  "other",
])

const AUTHORITY_TIERS = new Set<string>([
  "primary_official",
  "agency_guidance",
  "discovery_mirror",
  "untrusted",
])

export function isAnswerableAuthorityTier(tier: AuthorityTier | null): boolean {
  return tier == null || tier === "primary_official" || tier === "agency_guidance"
}

/**
 * Housing-program pre-filter:
 * - No program on the question → exclude program-only documents.
 * - Program set → include general (null) + matching program.
 */
export function passesHousingProgramFilter(
  chunkHousingProgram: string | null | undefined,
  filterHousingProgram: string | null | undefined,
): boolean {
  const chunk = chunkHousingProgram?.trim().toLowerCase() || null
  const filter = filterHousingProgram?.trim().toLowerCase() || null
  if (filter == null) return chunk == null
  return chunk == null || chunk === filter
}

export function passesDocumentTypeFilter(
  chunkType: DocumentType | null | undefined,
  allowTypes: DocumentType[] | null | undefined,
): boolean {
  if (allowTypes == null || allowTypes.length === 0) return true
  if (chunkType == null) return false
  return allowTypes.includes(chunkType)
}

/** Infer document_type from legacy domain / metadata when passport not yet filled. */
export function inferDocumentType(input: {
  documentType?: string | null
  domain?: string | null
  sourceFamily?: string | null
  housingProgram?: string | null
  publicationStatus?: string | null
}): DocumentType {
  const existing = input.documentType?.trim()
  if (existing && DOCUMENT_TYPES.has(existing)) return existing as DocumentType

  const family = (input.sourceFamily ?? "").toLowerCase()
  const domain = (input.domain ?? "").toLowerCase()

  if (family.includes("court")) return "court_opinion"
  if (family === "municipal_code") return "municipal_code"
  if (family === "housing_authority" || input.housingProgram) return "housing_program_rule"
  if (family.includes("building") || family === "icc_ipmc" || domain === "building_code") {
    return "building_code"
  }
  if (
    family.includes("faq") ||
    family === "agency_guidance" ||
    input.publicationStatus === "agency_guidance"
  ) {
    return "agency_guidance"
  }
  if (family.includes("maintenance")) return "maintenance_manual"
  if (family === "federal_hud_fha" && domain === "fair_housing") return "statute"
  if (family === "federal_hud_fha") return "regulation"
  if (
    family === "state_statute" ||
    family === "laws_regulations" ||
    domain === "landlord_tenant"
  ) {
    return "statute"
  }
  if (domain === "finance") return "government_guide"
  return "other"
}

export function passportFromChunkRow(row: Record<string, unknown>): DocumentPassport {
  const meta =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {}
  const sourceFamily =
    typeof meta.source_family === "string" ? meta.source_family : null
  const normative =
    row.normative_type === "requirement" || row.normative_type === "guidance"
      ? row.normative_type
      : null
  const authorityRaw =
    typeof row.authority_tier === "string" ? row.authority_tier : null
  const authorityTier =
    authorityRaw && AUTHORITY_TIERS.has(authorityRaw)
      ? (authorityRaw as AuthorityTier)
      : null
  const publisherKindRaw =
    typeof row.publisher_kind === "string" ? row.publisher_kind : null
  const publisherKind =
    publisherKindRaw && PUBLISHER_KINDS.has(publisherKindRaw)
      ? (publisherKindRaw as PublisherKind)
      : null

  return {
    documentType: inferDocumentType({
      documentType: typeof row.document_type === "string" ? row.document_type : null,
      domain: typeof row.domain === "string" ? row.domain : null,
      sourceFamily,
      housingProgram: typeof row.housing_program === "string" ? row.housing_program : null,
      publicationStatus:
        typeof row.publication_status === "string" ? row.publication_status : null,
    }),
    publisherName: typeof row.publisher_name === "string" ? row.publisher_name : null,
    publisherKind,
    normativeType: normative,
    authorityTier,
    countryCode:
      typeof row.country_code === "string" && row.country_code.trim()
        ? row.country_code.trim().toUpperCase()
        : "US",
    stateCode: typeof row.state_code === "string" ? row.state_code : null,
    countySlug: typeof row.county_slug === "string" ? row.county_slug : null,
    citySlug: typeof row.city_slug === "string" ? row.city_slug : null,
    housingProgram: typeof row.housing_program === "string" ? row.housing_program : null,
    citation: typeof row.source_citation === "string" ? row.source_citation : null,
    effectiveOn: typeof row.effective_on === "string" ? row.effective_on : null,
    lastUpdatedOn:
      typeof row.last_updated_on === "string"
        ? row.last_updated_on
        : typeof row.effective_on === "string"
          ? row.effective_on
          : null,
    replacesChunkId:
      typeof row.replaces_chunk_id === "string" ? row.replaces_chunk_id : null,
    sourceUrl: typeof row.source_url === "string" ? row.source_url : null,
    refreshCadence: (() => {
      const raw = typeof row.refresh_cadence === "string" ? row.refresh_cadence : null
      if (
        raw === "daily" ||
        raw === "weekly" ||
        raw === "on_publisher_schedule" ||
        raw === "on_manufacturer_release"
      ) {
        return raw
      }
      return cadenceForDocumentType(
        typeof row.document_type === "string" ? row.document_type : null,
      )
    })(),
    sourceCheckedAt:
      typeof row.source_checked_at === "string" ? row.source_checked_at : null,
    nextCheckAt: typeof row.next_check_at === "string" ? row.next_check_at : null,
    courtSystem: typeof row.court_system === "string" ? row.court_system : null,
    caseNumber: typeof row.case_number === "string" ? row.case_number : null,
    holdingSummary:
      typeof row.holding_summary === "string" ? row.holding_summary : null,
    manufacturer: typeof row.manufacturer === "string" ? row.manufacturer : null,
    equipmentModel:
      typeof row.equipment_model === "string" ? row.equipment_model : null,
    equipmentType: typeof row.equipment_type === "string" ? row.equipment_type : null,
    manualVersion: typeof row.manual_version === "string" ? row.manual_version : null,
  }
}
