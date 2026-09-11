import { describe, expect, it } from 'vitest'
import { parseClassifierResponse, resolveTypedExtractKind } from '@shared/onboarding/typedDocumentExtract/classify'
import { parseAndMapTypedExtract } from '@shared/onboarding/typedDocumentExtract/parseAndMap'
import { preferSignatureTenantName } from '@shared/onboarding/typedDocumentExtract/lease'
import { buildOnboardingExtractionReview } from '../onboardingDocumentUpload'

describe('typed document extract routing', () => {
  it('skips classification when the upload category is already known', () => {
    expect(resolveTypedExtractKind('scan.pdf', 'rent_roll')).toBe('rent_roll')
    expect(resolveTypedExtractKind('scan.pdf', 'lease_agreement')).toBe('lease')
    expect(resolveTypedExtractKind('scan.pdf', 'insurance_certificate')).toBe('insurance')
    expect(resolveTypedExtractKind('Vendor Roster.xlsx', 'vendor_contract')).toBe('generic')
  })

  it('classifies from filename when category is unknown', () => {
    expect(resolveTypedExtractKind('April rent roll.xlsx', 'unknown')).toBe('rent_roll')
    expect(resolveTypedExtractKind('Unit-4B-Lease.pdf', 'unknown')).toBe('lease')
    expect(resolveTypedExtractKind('ACORD-COI.pdf', 'unknown')).toBe('insurance_certificate')
  })

  it('parses classifier JSON', () => {
    expect(parseClassifierResponse({ type: 'lease' })).toBe('lease')
    expect(parseClassifierResponse({ type: 'unknown' })).toBe('unknown')
  })
})

describe('rent roll extraction', () => {
  it('1. one occupied unit with one tenant', () => {
    const mapped = parseAndMapTypedExtract('rent_roll', {
      property_name: 'Oak',
      rows: [
        {
          unit: '204',
          tenant_names: ['Maria Alvarez-Kim'],
          lease_start: '2025-06-01',
          lease_end: '2026-05-31',
          monthly_rent: 1850,
          status: 'occupied',
          confidence: 90,
        },
      ],
    })
    expect(mapped.units).toHaveLength(1)
    expect(mapped.residents).toHaveLength(1)
    expect(mapped.residents[0]?.fullName).toBe('Maria Alvarez-Kim')
    expect(mapped.leases).toHaveLength(0)
  })

  it('2. unit with two co-tenants keeps both names', () => {
    const mapped = parseAndMapTypedExtract('rent_roll', {
      rows: [
        {
          unit: '1A',
          tenant_names: ['Alex Rivera', 'Jordan Rivera'],
          status: 'occupied',
          confidence: 90,
        },
      ],
    })
    expect(mapped.residents.map((row) => row.fullName)).toEqual(['Alex Rivera', 'Jordan Rivera'])
  })

  it('3. vacant unit creates a unit and no resident', () => {
    const mapped = parseAndMapTypedExtract('rent_roll', {
      rows: [
        {
          unit: '205',
          tenant_names: [],
          lease_start: null,
          lease_end: null,
          monthly_rent: null,
          status: 'vacant',
          confidence: 90,
        },
      ],
    })
    expect(mapped.units.some((row) => row.label === '205')).toBe(true)
    expect(mapped.residents).toHaveLength(0)
  })

  it('4. model unit creates a unit and no resident', () => {
    const mapped = parseAndMapTypedExtract('rent_roll', {
      rows: [{ unit: 'M1', tenant_names: ['Model Unit'], status: 'model', confidence: 80 }],
    })
    expect(mapped.units.some((row) => row.label === 'M1')).toBe(true)
    expect(mapped.residents).toHaveLength(0)
  })

  it('5. notice unit keeps the listed tenant', () => {
    const mapped = parseAndMapTypedExtract('rent_roll', {
      rows: [{ unit: '4B', tenant_names: ['Jane Smith'], status: 'notice', confidence: 88 }],
    })
    expect(mapped.units.some((row) => row.label === '4B')).toBe(true)
    expect(mapped.residents[0]?.fullName).toBe('Jane Smith')
  })

  it('6. subtotal row between units is ignored', () => {
    const mapped = parseAndMapTypedExtract('rent_roll', {
      rows: [
        { unit: '101', tenant_names: ['A Tenant'], status: 'occupied', confidence: 90 },
        { unit: 'Subtotal', tenant_names: ['Building Subtotal'], monthly_rent: 4000, confidence: 40 },
        { unit: '102', tenant_names: ['B Tenant'], status: 'occupied', confidence: 90 },
      ],
    })
    expect(mapped.units.map((row) => row.label)).toEqual(['101', '102'])
    expect(mapped.residents.some((row) => /subtotal/i.test(row.fullName))).toBe(false)
  })

  it('7. building total row is ignored', () => {
    const mapped = parseAndMapTypedExtract('rent_roll', {
      rows: [{ unit: 'Building Total', tenant_names: [], monthly_rent: 12000, confidence: 40 }],
    })
    expect(mapped.units).toHaveLength(0)
    expect(mapped.residents).toHaveLength(0)
  })

  it('8. different column order still maps by meaning', () => {
    const mapped = parseAndMapTypedExtract('rent_roll', {
      rows: [
        {
          apt: '2C',
          current_rent: '$1,900.00',
          resident: 'Sam Lee',
          occupancy: 'Occupied',
          confidence: 91,
        },
      ],
    })
    expect(mapped.units[0]?.label).toBe('2C')
    expect(mapped.residents[0]?.fullName).toBe('Sam Lee')
    expect(mapped.residents[0]?.monthlyRent).toBe('1900')
  })

  it('9. Resident header instead of Tenant', () => {
    const mapped = parseAndMapTypedExtract('rent_roll', {
      rows: [{ unit: '9', resident: 'Pat Nguyen', status: 'occupied', confidence: 90 }],
    })
    expect(mapped.residents[0]?.fullName).toBe('Pat Nguyen')
  })

  it('10. missing lease dates stay empty rather than guessed', () => {
    const mapped = parseAndMapTypedExtract('rent_roll', {
      rows: [
        {
          unit: '10',
          tenant_names: ['Chris Park'],
          lease_start: 'June sometime',
          lease_end: '',
          status: 'occupied',
          confidence: 70,
        },
      ],
    })
    expect(mapped.residents[0]?.leaseStart).toBe('')
    expect(mapped.residents[0]?.leaseEnd).toBe('')
  })
})

describe('lease extraction', () => {
  it('1. individual landlord', () => {
    const mapped = parseAndMapTypedExtract('lease', {
      landlord_name: 'Maria Chen',
      tenant_names: ['Jamie Tenant'],
      property_address: '100 Main St',
      unit: '4B',
      confidence: 90,
    })
    expect(mapped.account.companyName).toBe('')
    expect(mapped.account.contactName).toBe('Maria Chen')
    expect(mapped.roleFacts.some((row) => row.role === 'landlord_lessor' && row.value === 'Maria Chen')).toBe(
      true,
    )
  })

  it('2. LLC landlord stays one string', () => {
    const mapped = parseAndMapTypedExtract('lease', {
      landlord_name: 'Grove Holdings LLC',
      tenant_names: ['Jamie Tenant'],
      confidence: 90,
    })
    expect(mapped.account.companyName).toBe('Grove Holdings LLC')
  })

  it('swaps tenant and landlord when the model reversed an LLC and a person', () => {
    const mapped = parseAndMapTypedExtract('lease', {
      landlord_name: 'Jane Smith',
      tenant_names: ['Grove Holdings LLC'],
      confidence: 90,
    })
    expect(mapped.account.companyName).toBe('Grove Holdings LLC')
    expect(mapped.residents.map((row) => row.fullName)).toEqual(['Jane Smith'])
  })

  it('3. two tenants', () => {
    const mapped = parseAndMapTypedExtract('lease', {
      tenant_names: ['Alex Rivera', 'Jordan Rivera'],
      unit: '1A',
      confidence: 90,
    })
    expect(mapped.residents).toHaveLength(2)
    expect(mapped.leases).toHaveLength(2)
  })

  it('4. tenant + guarantor does not put the guarantor in residents', () => {
    const mapped = parseAndMapTypedExtract('lease', {
      tenant_names: ['Jamie Tenant'],
      guarantor_names: ['Pat Guarantor'],
      confidence: 90,
    })
    expect(mapped.residents.map((row) => row.fullName)).toEqual(['Jamie Tenant'])
    expect(mapped.roleFacts.some((row) => row.role === 'guarantor' && row.value === 'Pat Guarantor')).toBe(
      true,
    )
  })

  it('5. property manager signing for landlord is not the landlord', () => {
    const mapped = parseAndMapTypedExtract('lease', {
      landlord_name: 'Oak LLC',
      property_manager_name: 'Riley Agent',
      tenant_names: ['Jamie Tenant'],
      confidence: 90,
    })
    expect(mapped.account.companyName).toBe('Oak LLC')
    expect(
      mapped.roleFacts.some((row) => row.role === 'property_manager' && row.value === 'Riley Agent'),
    ).toBe(true)
  })

  it('6. same tenant name repeated is not duplicated', () => {
    const mapped = parseAndMapTypedExtract('lease', {
      tenant_names: ['Jamie Tenant', 'Jamie Tenant'],
      confidence: 90,
    })
    expect(mapped.residents).toHaveLength(1)
  })

  it('7. signature spelling is preferred when it is the same party', () => {
    expect(preferSignatureTenantName('John A. Smith', 'John Smith')).toBe('John Smith')
  })

  it('8. missing guarantor', () => {
    const mapped = parseAndMapTypedExtract('lease', {
      tenant_names: ['Jamie Tenant'],
      guarantor_names: [],
      confidence: 90,
    })
    expect(mapped.roleFacts.some((row) => row.role === 'guarantor')).toBe(false)
  })

  it('9. missing property manager', () => {
    const mapped = parseAndMapTypedExtract('lease', {
      landlord_name: 'Oak LLC',
      tenant_names: ['Jamie Tenant'],
      confidence: 90,
    })
    expect(mapped.roleFacts.some((row) => row.role === 'property_manager')).toBe(false)
  })
})

describe('insurance certificate extraction', () => {
  it('1. named insured + certificate holder stay separate', () => {
    const mapped = parseAndMapTypedExtract('insurance_certificate', {
      named_insured: 'Flex Plumbing LLC',
      certificate_holder: 'Ulo Home Inc',
      confidence: 90,
    })
    expect(mapped.residents).toHaveLength(0)
    expect(mapped.vendors).toHaveLength(0)
    expect(mapped.insuranceCertificate?.named_insured).toBe('Flex Plumbing LLC')
    expect(mapped.insuranceCertificate?.certificate_holder).toBe('Ulo Home Inc')
  })

  it('2. named insured + additional insured', () => {
    const mapped = parseAndMapTypedExtract('insurance_certificate', {
      named_insured: 'Flex Plumbing LLC',
      additional_insured: ['Landlord LLC', 'Ulo Home Inc'],
      confidence: 90,
    })
    expect(mapped.insuranceCertificate?.additional_insured).toEqual(['Landlord LLC', 'Ulo Home Inc'])
  })

  it('3. producer is not the insurer', () => {
    const mapped = parseAndMapTypedExtract('insurance_certificate', {
      producer_agency: 'Harbor Insurance Agency',
      insurer_name: 'Hartford',
      confidence: 90,
    })
    expect(mapped.insuranceCertificate?.producer_agency).toBe('Harbor Insurance Agency')
    expect(mapped.insuranceCertificate?.insurers[0]?.name).toBe('Hartford')
  })

  it('4. multiple insurers', () => {
    const mapped = parseAndMapTypedExtract('insurance_certificate', {
      insurers: [
        { name: 'Hartford', policy_number: 'GL-1' },
        { name: 'Travelers', policy_number: 'WC-2' },
      ],
      confidence: 90,
    })
    expect(mapped.insuranceCertificate?.insurers).toHaveLength(2)
    expect(mapped.roleFacts.filter((row) => row.role === 'insurance_carrier')).toHaveLength(2)
  })

  it('5. certificate holder can be a management company', () => {
    const mapped = parseAndMapTypedExtract('insurance_certificate', {
      named_insured: 'Vendor Co',
      certificate_holder: 'CEO Rentals NJ LLC',
      confidence: 90,
    })
    expect(mapped.account.companyName).toBe('')
    expect(mapped.insuranceCertificate?.certificate_holder).toBe('CEO Rentals NJ LLC')
  })

  it('6. missing certificate holder is flagged', () => {
    const mapped = parseAndMapTypedExtract('insurance_certificate', {
      named_insured: 'Vendor Co',
      confidence: 90,
    })
    expect(
      mapped.roleFacts.some((row) => row.role === 'certificate_holder' && row.needsReview),
    ).toBe(true)
  })

  it('7. policy effective and expiration dates', () => {
    const mapped = parseAndMapTypedExtract('insurance_certificate', {
      named_insured: 'Vendor Co',
      effective_date: '2026-01-01',
      expiration_date: '2027-01-01',
      confidence: 90,
    })
    expect(mapped.insuranceCertificate?.effective_date).toBe('2026-01-01')
    expect(mapped.insuranceCertificate?.expiration_date).toBe('2027-01-01')
  })

  it('8. certificate date does not replace effective date', () => {
    const mapped = parseAndMapTypedExtract('insurance_certificate', {
      named_insured: 'Vendor Co',
      certificate_date: '2026-03-15',
      confidence: 90,
    })
    expect(mapped.insuranceCertificate?.effective_date).toBeNull()
    expect(mapped.insuranceCertificate?.certificate_date).toBe('2026-03-15')
    expect(mapped.warnings.some((row) => /certificate date/i.test(row))).toBe(true)
  })

  it('9. producer near named insured stays producer', () => {
    const mapped = parseAndMapTypedExtract('insurance_certificate', {
      named_insured: 'Flex Plumbing LLC',
      producer_agency: 'Harbor Insurance Agency',
      confidence: 90,
    })
    expect(mapped.insuranceCertificate?.named_insured).toBe('Flex Plumbing LLC')
    expect(mapped.insuranceCertificate?.producer_agency).toBe('Harbor Insurance Agency')
  })
})

describe('insurance merge does not create vendors or residents', () => {
  it('keeps insurance parties in role review only', () => {
    const review = buildOnboardingExtractionReview([
      {
        id: 'coi',
        fileName: 'COI.pdf',
        fileType: 'pdf',
        fileSize: 12,
        documentCategory: 'insurance_certificate',
        categoryGroup: 'vendor',
        uploadStatus: 'ready_for_review',
        uploadProgress: 100,
        extractionStatus: 'ready_for_review',
        processingLabel: 'Ready for review',
        errorMessage: null,
        imageLabels: [],
        hasHandwriting: false,
        extractedPayload: {
          extractKind: 'insurance_certificate',
          properties: [],
          units: [],
          residents: [],
          vendors: [{ name: 'Hartford', category: 'Insurance', phone: '', email: '', confidence: 90 }],
          leases: [],
          maintenanceIssues: [],
          financialRecords: [],
          imageLabels: [],
          warnings: [],
          roleFacts: [
            {
              role: 'named_insured',
              label: 'Named Insured',
              value: 'Flex Plumbing LLC',
              confidence: 90,
              needsReview: false,
            },
            {
              role: 'insurance_producer',
              label: 'Insurance Producer',
              value: 'Harbor Agency',
              confidence: 90,
              needsReview: false,
            },
          ],
        },
      },
    ])
    expect(review.vendors).toHaveLength(0)
    expect(review.residents).toHaveLength(0)
    expect(review.needsReview.some((row) => row.label === 'Named Insured')).toBe(true)
    expect(review.needsReview.some((row) => row.label === 'Insurance Producer')).toBe(true)
  })
})
