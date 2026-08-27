/**
 * Optional Certificial insurance tracking lookup.
 * Token-gated; returns not-found when the API is not configured.
 */
export type CertificialCoverageLookup = {
  found: boolean
  carrier: string | null
  policyNumber: string | null
  generalLiability: number | null
  expirationDate: string | null
  additionalInsured: boolean
  detail: string
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const t = value.trim()
  return t.length > 0 ? t : null
}

function asMoney(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value !== "string") return null
  const n = Number(value.replace(/[^0-9.]/g, ""))
  return Number.isFinite(n) ? n : null
}

export function parseCertificialCoverage(raw: unknown): CertificialCoverageLookup | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const nested = row.policy && typeof row.policy === "object"
    ? (row.policy as Record<string, unknown>)
    : row.coverage && typeof row.coverage === "object"
    ? (row.coverage as Record<string, unknown>)
    : row
  const carrier = asString(
    nested.carrier ?? nested.insurance_carrier ?? nested.insuranceCarrier,
  )
  const policyNumber = asString(
    nested.policy_number ?? nested.policyNumber ?? nested.certificate_number,
  )
  const generalLiability = asMoney(
    nested.general_liability ?? nested.generalLiability ?? nested.gl_limit,
  )
  const expirationDate = asString(
    nested.expiration_date ?? nested.expirationDate ?? nested.policy_expiration,
  )
  if (!carrier && !policyNumber && generalLiability == null && !expirationDate) {
    return null
  }
  return {
    found: true,
    carrier,
    policyNumber,
    generalLiability,
    expirationDate,
    additionalInsured: nested.additional_insured === true ||
      nested.additionalInsured === true,
    detail: "Coverage on file with Certificial",
  }
}

export async function lookupCertificialCoverage(input: {
  businessName: string
  phone?: string | null
}): Promise<CertificialCoverageLookup> {
  const token = Deno.env.get("CERTIFICIAL_API_TOKEN")?.trim()
  const base = (Deno.env.get("CERTIFICIAL_API_BASE") ?? "https://my.certificial.com/api")
    .replace(/\/$/, "")
  if (!token) {
    return {
      found: false,
      carrier: null,
      policyNumber: null,
      generalLiability: null,
      expirationDate: null,
      additionalInsured: false,
      detail: "No insurance certificate on file. Upload a COI to verify coverage.",
    }
  }

  const url = new URL(`${base}/v1/certificates`)
  url.searchParams.set("company", input.businessName.trim())
  if (input.phone?.trim()) url.searchParams.set("phone", input.phone.trim())

  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Token ${token}`,
      },
    })
    const text = await res.text()
    let parsed: unknown = null
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = null
    }
    if (!res.ok) {
      console.error("[certificialApi] lookup failed", res.status, text.slice(0, 400))
      return {
        found: false,
        carrier: null,
        policyNumber: null,
        generalLiability: null,
        expirationDate: null,
        additionalInsured: false,
        detail: "We couldn't reach insurance tracking. Upload a COI to verify coverage.",
      }
    }
    const list = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { results?: unknown }).results)
      ? (parsed as { results: unknown[] }).results
      : parsed
      ? [parsed]
      : []
    for (const item of list) {
      const coverage = parseCertificialCoverage(item)
      if (coverage) return coverage
    }
    return {
      found: false,
      carrier: null,
      policyNumber: null,
      generalLiability: null,
      expirationDate: null,
      additionalInsured: false,
      detail: "No insurance certificate on file. Upload a COI to verify coverage.",
    }
  } catch (err) {
    console.error("[certificialApi] lookup error", err)
    return {
      found: false,
      carrier: null,
      policyNumber: null,
      generalLiability: null,
      expirationDate: null,
      additionalInsured: false,
      detail: "We couldn't reach insurance tracking. Upload a COI to verify coverage.",
    }
  }
}
