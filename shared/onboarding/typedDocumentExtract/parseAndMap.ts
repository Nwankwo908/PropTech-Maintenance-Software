import { normalizeInsuranceCertificateExtract, validateInsuranceCertificateExtract } from './insurance.ts'
import {
  normalizePropertyPolicyExtract,
  validatePropertyPolicyExtract,
} from './insurancePolicy.ts'
import { normalizeLeaseExtract, validateLeaseExtract } from './lease.ts'
import {
  mapInsuranceToPortfolio,
  mapLeaseToPortfolio,
  mapPropertyPolicyToPortfolio,
  mapRentRollToPortfolio,
  type MappedPortfolioExtract,
} from './mapToPortfolio.ts'
import { normalizeRentRollExtract, validateRentRollExtract } from './rentRoll.ts'
import { isPropertyPolicyKind, type TypedExtractKind } from './types.ts'

export function parseAndMapTypedExtract(
  kind: TypedExtractKind,
  raw: unknown,
): MappedPortfolioExtract {
  if (kind === 'rent_roll') {
    return mapRentRollToPortfolio(validateRentRollExtract(normalizeRentRollExtract(raw)))
  }
  if (kind === 'lease') {
    return mapLeaseToPortfolio(validateLeaseExtract(normalizeLeaseExtract(raw)))
  }
  if (isPropertyPolicyKind(kind)) {
    return mapPropertyPolicyToPortfolio(
      validatePropertyPolicyExtract(normalizePropertyPolicyExtract(raw, kind)),
    )
  }
  return mapInsuranceToPortfolio(
    validateInsuranceCertificateExtract(normalizeInsuranceCertificateExtract(raw)),
  )
}

export type { MappedPortfolioExtract }
