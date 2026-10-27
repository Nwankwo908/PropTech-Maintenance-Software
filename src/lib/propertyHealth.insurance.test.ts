import { describe, expect, it } from 'vitest'
import {
  insuredAddressMatchesProperty,
  propertyPolicyAddressesFromUploads,
} from '@/lib/propertyHealth'

describe('property insurance for the Documentation score', () => {
  it('reads insured addresses from property policies only, never vendor certificates', () => {
    const addresses = propertyPolicyAddressesFromUploads([
      {
        extractedPayload: {
          dwellingPolicy: {
            document_type: 'dwelling_policy_declarations',
            insured_property_address: '563 Springdale Cir, Palm Springs, FL 33461',
          },
        },
      },
      {
        extractedPayload: {
          dwellingPolicy: {
            document_type: 'homeowners_policy_declarations',
            insured_property_address: '109 S Grove St, Austin, TX 78701',
          },
        },
      },
      {
        extractedPayload: {
          insuranceCertificate: { document_type: 'certificate_of_liability_insurance', named_insured: 'Ecosafe Pest' },
          dwellingPolicy: null,
        },
      },
      { extractedPayload: null },
      null,
    ])
    expect(addresses).toEqual([
      '563 Springdale Cir, Palm Springs, FL 33461',
      '109 S Grove St, Austin, TX 78701',
    ])
  })

  it('matches a policy to the property by street address', () => {
    expect(insuredAddressMatchesProperty('109 S Grove St, Austin, TX 78701', ['109 S Grove St'])).toBe(true)
    expect(insuredAddressMatchesProperty('109 S Grove Street, Austin, TX', ['109 S Grove St'])).toBe(true)
    expect(insuredAddressMatchesProperty('111 S Grove St, Austin, TX', ['109 S Grove St'])).toBe(false)
    expect(insuredAddressMatchesProperty('563 Springdale Cir, Palm Springs, FL', ['Sunset'])).toBe(false)
  })
})
