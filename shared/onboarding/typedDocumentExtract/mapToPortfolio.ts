import { formatMoney } from './parse.ts'
import {
  ROLE_LABELS,
  type DwellingPolicyDeclarations,
  type ExtractRoleFact,
  type InsuranceCertificateExtract,
  type LeaseExtract,
  type RentRollExtract,
  type TypedExtractKind,
} from './types.ts'

export type MappedPortfolioExtract = {
  extractKind: TypedExtractKind
  account: {
    companyName: string
    contactName: string
    email: string
    phone: string
  }
  properties: Array<{
    name: string
    streetAddress: string
    city: string
    state: string
    zipCode: string
    propertyType: string
    unitCount: number
    confidence: number
  }>
  units: Array<{ label: string; building: string; confidence: number }>
  residents: Array<{
    fullName: string
    unit: string
    building: string
    phone: string
    email: string
    leaseStart: string
    leaseEnd: string
    monthlyRent: string
    confidence: number
  }>
  vendors: []
  leases: Array<{
    residentName: string
    unit: string
    building: string
    leaseStart: string
    leaseEnd: string
    rentAmount: string
    securityDeposit: string
    confidence: number
  }>
  maintenanceIssues: []
  financialRecords: []
  imageLabels: string[]
  warnings: string[]
  roleFacts: ExtractRoleFact[]
  insuranceCertificate: InsuranceCertificateExtract | null
  dwellingPolicy: DwellingPolicyDeclarations | null
}

function splitAddress(address: string | null): { street: string; city: string; state: string; zip: string } {
  const raw = (address ?? '').trim()
  if (!raw) return { street: '', city: '', state: '', zip: '' }
  const match = raw.match(/^(.*?)(?:,\s*)?([A-Za-z .]+)?(?:,\s*)?([A-Z]{2})?\s*(\d{5}(?:-\d{4})?)?$/)
  if (!match) return { street: raw, city: '', state: '', zip: '' }
  return {
    street: (match[1] ?? '').trim(),
    city: (match[2] ?? '').trim(),
    state: (match[3] ?? '').trim(),
    zip: (match[4] ?? '').trim(),
  }
}

function emptyAccount() {
  return { companyName: '', contactName: '', email: '', phone: '' }
}

export function mapRentRollToPortfolio(extract: RentRollExtract): MappedPortfolioExtract {
  const building = extract.property_name || extract.property_address || ''
  const address = splitAddress(extract.property_address)
  const units: MappedPortfolioExtract['units'] = []
  const residents: MappedPortfolioExtract['residents'] = []
  const roleFacts: ExtractRoleFact[] = []
  const warnings = [...extract.warnings]

  for (const row of extract.rows) {
    if (row.skipReason === 'summary_or_total_row') continue
    if (!row.unit) {
      roleFacts.push({
        role: 'unit_row_needs_review',
        label: ROLE_LABELS.unit_row_needs_review,
        value: row.tenant_names.join(', ') || 'Row has no unit identifier',
        confidence: row.confidence,
        needsReview: true,
      })
      continue
    }
    units.push({
      label: row.unit,
      building,
      confidence: row.confidence,
    })
    const vacantLike = row.status === 'vacant' || row.status === 'model' || row.status === 'offline'
    if (vacantLike || row.tenant_names.length === 0) continue
    for (const name of row.tenant_names) {
      residents.push({
        fullName: name,
        unit: row.unit,
        building,
        phone: '',
        email: '',
        leaseStart: row.lease_start ?? '',
        leaseEnd: row.lease_end ?? '',
        monthlyRent: formatMoney(row.monthly_rent),
        confidence: row.confidence,
      })
    }
  }

  const properties =
    building || address.street
      ? [
          {
            name: extract.property_name || address.street || building,
            streetAddress: address.street || extract.property_address || '',
            city: address.city,
            state: address.state,
            zipCode: address.zip,
            propertyType: units.length > 1 ? 'multifamily' : 'single_family_home',
            unitCount: units.length,
            confidence: 85,
          },
        ]
      : []

  return {
    extractKind: 'rent_roll',
    account: emptyAccount(),
    properties,
    units,
    residents,
    vendors: [],
    leases: [],
    maintenanceIssues: [],
    financialRecords: [],
    imageLabels: [],
    warnings,
    roleFacts,
    insuranceCertificate: null,
    dwellingPolicy: null,
  }
}

export function mapLeaseToPortfolio(extract: LeaseExtract): MappedPortfolioExtract {
  const building = extract.property_address || ''
  const address = splitAddress(extract.property_address)
  const roleFacts: ExtractRoleFact[] = []
  const low = extract.confidence < 75

  if (extract.landlord_name) {
    roleFacts.push({
      role: 'landlord_lessor',
      label: ROLE_LABELS.landlord_lessor,
      value: extract.landlord_name,
      confidence: extract.confidence,
      needsReview: low,
    })
  }
  for (const name of extract.tenant_names) {
    roleFacts.push({
      role: 'tenant_lessee',
      label: ROLE_LABELS.tenant_lessee,
      value: name,
      confidence: extract.confidence,
      needsReview: low,
    })
  }
  for (const name of extract.guarantor_names) {
    roleFacts.push({
      role: 'guarantor',
      label: ROLE_LABELS.guarantor,
      value: name,
      confidence: extract.confidence,
      needsReview: true,
    })
  }
  if (extract.property_manager_name) {
    roleFacts.push({
      role: 'property_manager',
      label: ROLE_LABELS.property_manager,
      value: extract.property_manager_name,
      confidence: extract.confidence,
      needsReview: true,
    })
  }

  const residents = extract.tenant_names.map((name) => ({
    fullName: name,
    unit: extract.unit ?? '',
    building,
    phone: '',
    email: '',
    leaseStart: extract.lease_start ?? '',
    leaseEnd: extract.lease_end ?? '',
    monthlyRent: formatMoney(extract.monthly_rent),
    confidence: extract.confidence,
  }))
  const leases = extract.tenant_names.map((name) => ({
    residentName: name,
    unit: extract.unit ?? '',
    building,
    leaseStart: extract.lease_start ?? '',
    leaseEnd: extract.lease_end ?? '',
    rentAmount: formatMoney(extract.monthly_rent),
    securityDeposit: formatMoney(extract.security_deposit),
    confidence: extract.confidence,
  }))

  return {
    extractKind: 'lease',
    account: {
      companyName: extract.landlord_name ?? '',
      contactName: '',
      email: '',
      phone: '',
    },
    properties:
      building || address.street
        ? [
            {
              name: address.street || building,
              streetAddress: address.street || extract.property_address || '',
              city: address.city,
              state: address.state,
              zipCode: address.zip,
              propertyType: 'single_family_home',
              unitCount: extract.unit ? 1 : 1,
              confidence: extract.confidence,
            },
          ]
        : [],
    units: extract.unit
      ? [{ label: extract.unit, building, confidence: extract.confidence }]
      : [],
    residents,
    vendors: [],
    leases,
    maintenanceIssues: [],
    financialRecords: [],
    imageLabels: [],
    warnings: extract.warnings,
    roleFacts,
    insuranceCertificate: null,
    dwellingPolicy: null,
  }
}

export function mapInsuranceToPortfolio(extract: InsuranceCertificateExtract): MappedPortfolioExtract {
  const roleFacts: ExtractRoleFact[] = []
  const push = (
    role: ExtractRoleFact['role'],
    value: string | null,
    needsReview = extract.confidence < 75 || !value,
  ) => {
    if (!value && role !== 'certificate_holder') return
    roleFacts.push({
      role,
      label: ROLE_LABELS[role],
      value: value || 'Not found on document',
      confidence: extract.confidence,
      needsReview: Boolean(needsReview || !value),
    })
  }
  push('named_insured', extract.named_insured)
  push('certificate_holder', extract.certificate_holder, true)
  for (const name of extract.additional_insured) push('additional_insured', name)
  push('insurance_producer', extract.producer_agency)
  for (const insurer of extract.insurers) push('insurance_carrier', insurer.name)

  const warnings = [...extract.warnings]
  if (extract.certificate_date && !extract.effective_date) {
    warnings.push('Certificate date was not used as the policy effective date.')
  }

  return {
    extractKind: 'insurance_certificate',
    account: emptyAccount(),
    properties: [],
    units: [],
    residents: [],
    vendors: [],
    leases: [],
    maintenanceIssues: [],
    financialRecords: [],
    imageLabels: [],
    warnings,
    roleFacts,
    insuranceCertificate: extract,
    dwellingPolicy: null,
  }
}

export function mapPropertyPolicyToPortfolio(
  extract: DwellingPolicyDeclarations,
): MappedPortfolioExtract {
  const roleFacts: ExtractRoleFact[] = []
  const push = (role: ExtractRoleFact['role'], value: string | null) => {
    if (!value) return
    roleFacts.push({
      role,
      label: ROLE_LABELS[role],
      value,
      confidence: extract.confidence,
      needsReview: extract.confidence < 75,
    })
  }
  push('named_insured', extract.named_insured_primary)
  if (extract.named_insured_secondary) push('named_insured', extract.named_insured_secondary)
  push('insurance_producer', extract.producer_agency_name)
  push('insurance_carrier', extract.insurer_name)
  push('mortgagee', extract.mortgagee_name)

  const address = splitAddress(extract.insured_property_address)
  const building = extract.insured_property_address || ''

  return {
    extractKind: extract.document_type,
    account: emptyAccount(),
    properties:
      building || address.street
        ? [
            {
              name: address.street || building,
              streetAddress: address.street || extract.insured_property_address || '',
              city: address.city,
              state: address.state,
              zipCode: address.zip,
              propertyType: 'single_family_home',
              unitCount: 1,
              confidence: extract.confidence,
            },
          ]
        : [],
    units: [],
    residents: [],
    vendors: [],
    leases: [],
    maintenanceIssues: [],
    financialRecords: [],
    imageLabels: [],
    warnings: extract.warnings,
    roleFacts,
    insuranceCertificate: null,
    dwellingPolicy: extract,
  }
}
