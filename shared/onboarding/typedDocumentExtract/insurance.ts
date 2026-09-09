import {
  clampConfidence,
  cleanExtractedName,
  formatInsurancePartyName,
  parseIsoDate,
  uniqueNames,
} from './parse.ts'
import type { InsuranceCertificateExtract, InsuranceInsurerRow } from './types.ts'

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function insurersFrom(root: Record<string, unknown>): InsuranceInsurerRow[] {
  const list = Array.isArray(root.insurers) ? root.insurers : []
  const rows: InsuranceInsurerRow[] = []
  for (const item of list) {
    const row = asRecord(item)
    const name = formatInsurancePartyName(row.name ?? row.insurer_name ?? row.carrier)
    if (!name) continue
    rows.push({
      name,
      policy_number: cleanExtractedName(row.policy_number ?? row.policyNumber),
    })
  }
  const single = formatInsurancePartyName(root.insurer_name ?? root.carrier ?? root.insurer)
  if (rows.length === 0 && single) {
    rows.push({
      name: single,
      policy_number: cleanExtractedName(root.policy_number ?? root.policyNumber),
    })
  }
  return rows
}

export function normalizeInsuranceCertificateExtract(raw: unknown): InsuranceCertificateExtract {
  const root = asRecord(raw)
  const additional = uniqueNames(
    root.additional_insured ?? root.additionalInsured ?? root.additional_insureds,
  )
  const singleAdditional = formatInsurancePartyName(root.additional_insured_name)
  return {
    document_type: 'certificate_of_liability_insurance',
    named_insured: formatInsurancePartyName(root.named_insured ?? root.namedInsured ?? root.insured),
    certificate_holder: formatInsurancePartyName(
      root.certificate_holder ?? root.certificateHolder ?? root.holder,
    ),
    additional_insured: additional.length > 0 ? additional : singleAdditional ? [singleAdditional] : [],
    producer_agency: formatInsurancePartyName(
      root.producer_agency ?? root.producer ?? root.agency ?? root.broker,
    ),
    insurers: insurersFrom(root),
    policy_number: cleanExtractedName(root.policy_number ?? root.policyNumber),
    effective_date: parseIsoDate(root.effective_date ?? root.effectiveDate ?? root.policy_effective),
    expiration_date: parseIsoDate(root.expiration_date ?? root.expirationDate ?? root.policy_expiration),
    certificate_date: parseIsoDate(root.certificate_date ?? root.certificateDate ?? root.date_issued),
    general_liability: cleanExtractedName(root.general_liability ?? root.generalLiability),
    automobile_liability: cleanExtractedName(root.automobile_liability ?? root.automobileLiability),
    workers_compensation: cleanExtractedName(root.workers_compensation ?? root.workersCompensation),
    confidence: clampConfidence(root.confidence),
    warnings: uniqueNames(root.warnings),
  }
}

export function validateInsuranceCertificateExtract(
  extract: InsuranceCertificateExtract,
): InsuranceCertificateExtract {
  const warnings = [...extract.warnings]
  const producer = extract.producer_agency
  const named = extract.named_insured
  let namedInsured = named
  if (producer && named && producer.toLowerCase() === named.toLowerCase()) {
    namedInsured = null
    warnings.push('Named insured matched the producer and was cleared to avoid mixing roles.')
  }
  const insurers = extract.insurers.filter((row) => {
    if (producer && row.name.toLowerCase() === producer.toLowerCase()) {
      warnings.push('Dropped an insurer row that duplicated the producer.')
      return false
    }
    if (namedInsured && row.name.toLowerCase() === namedInsured.toLowerCase()) {
      warnings.push('Dropped an insurer row that duplicated the named insured.')
      return false
    }
    return true
  })
  let effective = extract.effective_date
  if (!effective && extract.certificate_date) {
    warnings.push('Certificate date is present but was not used as the policy effective date.')
  }
  if (effective && extract.certificate_date && effective === extract.certificate_date) {
    // Keep effective only if the document also labeled it as policy effective.
    // Mapper still stores certificate_date separately.
  }
  return {
    ...extract,
    named_insured: namedInsured,
    insurers,
    effective_date: effective,
    policy_number: extract.policy_number || insurers[0]?.policy_number || null,
    warnings,
  }
}
