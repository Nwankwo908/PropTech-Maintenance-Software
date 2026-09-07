import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { resolvePropertyLocation } from "../properties/propertyLocation.ts"
import {
  formatExpectedInspectionAddress,
  inspectionReportAddressMatches,
  normalizeAddressText,
} from "./inspectionAddressMatch.ts"
import type { InspectionReportExtract } from "./extractInspectionReport.ts"

export type InspectionAddressGateCode =
  | "address_mismatch"
  | "address_missing"
  | "property_address_missing"

export class InspectionAddressGateError extends Error {
  readonly code: InspectionAddressGateCode
  readonly extractedAddress: string
  readonly expectedAddress: string
  readonly httpStatus: number

  constructor(input: {
    code: InspectionAddressGateCode
    message: string
    extractedAddress: string
    expectedAddress: string
    httpStatus?: number
  }) {
    super(input.message)
    this.name = "InspectionAddressGateError"
    this.code = input.code
    this.extractedAddress = input.extractedAddress
    this.expectedAddress = input.expectedAddress
    this.httpStatus = input.httpStatus ?? 409
  }

  toJSON() {
    return {
      error: this.message,
      code: this.code,
      extractedAddress: this.extractedAddress,
      expectedAddress: this.expectedAddress,
    }
  }
}

export function formatExtractedInspectionAddress(
  address: InspectionReportExtract["propertyAddress"],
): string {
  return formatExpectedInspectionAddress({
    street: address.street,
    city: address.city,
    state: address.state,
    zip: address.zip,
    building: address.raw,
  })
}

export async function assertInspectionReportMatchesProperty(input: {
  supabase: SupabaseClient
  landlordId: string
  building: string
  propertyId?: string | null
  extract: InspectionReportExtract
}): Promise<void> {
  const location = await resolvePropertyLocation(input.supabase, input.landlordId, {
    propertyId: input.propertyId,
    building: input.building,
  })
  const expectedAddress = formatExpectedInspectionAddress({
    street: location.streetAddress,
    city: location.city,
    state: location.state,
    zip: location.zipCode,
    building: input.building,
  })
  const extractedAddress = formatExtractedInspectionAddress(input.extract.propertyAddress)

  const expectedStreet = (location.streetAddress ?? "").trim()
  const expectedZip = (location.zipCode ?? "").trim()
  if (!expectedStreet && !expectedZip) {
    throw new InspectionAddressGateError({
      code: "property_address_missing",
      message:
        "This property has no street address on file. Add the address in property details before uploading an inspection report.",
      extractedAddress,
      expectedAddress: input.building,
      httpStatus: 409,
    })
  }

  const extracted = input.extract.propertyAddress
  const extractedNorm = normalizeAddressText(
    [extracted.raw, extracted.street, extracted.city, extracted.state, extracted.zip]
      .filter(Boolean)
      .join(" "),
  )
  if (!extractedNorm) {
    throw new InspectionAddressGateError({
      code: "address_missing",
      message:
        "We could not find a property address on this report, so it was not saved. Upload a report that lists this property’s address.",
      extractedAddress: "",
      expectedAddress,
    })
  }

  const matches = inspectionReportAddressMatches({
    extracted,
    expectedStreet,
    expectedCity: location.city ?? "",
    expectedState: location.state ?? "",
    expectedZip,
    expectedBuilding: input.building,
  })
  if (!matches) {
    throw new InspectionAddressGateError({
      code: "address_mismatch",
      message: expectedAddress
        ? `This report is for ${extractedAddress || "a different address"}, not ${expectedAddress}. It was not saved.`
        : "This report does not match this property’s address. It was not saved.",
      extractedAddress,
      expectedAddress,
    })
  }
}
