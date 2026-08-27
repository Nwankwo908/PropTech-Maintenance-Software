import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  mapBoardStatus,
  parseStateLicenseRecord,
} from "./stateLicenseApi.ts"
import { parseExtractedCoiFields, parseExtractedLicenseFields } from "./documentExtract.ts"
import { parseCertificialCoverage } from "./certificialApi.ts"

Deno.test("parseStateLicenseRecord maps board JSON", () => {
  const row = parseStateLicenseRecord({
    state: "CA",
    license_number: "1000003",
    business_name: "JR MAYORGA WOODWORKING",
    license_type: "Contractor",
    authority: "California Contractors State License Board",
    status: "active",
    expiration_date: "2027-01-31",
  })
  assertEquals(row?.licenseNumber, "1000003")
  assertEquals(row?.authority, "California Contractors State License Board")
  assertEquals(mapBoardStatus(row?.status ?? null, row?.expirationDate ?? null, true), "verified")
})

Deno.test("mapBoardStatus treats expired board status as expired", () => {
  assertEquals(mapBoardStatus("Expired", "2020-01-01", false), "expired")
  assertEquals(mapBoardStatus("unknown", null, false), "not_found")
})

Deno.test("parseExtractedLicenseFields ignores empty invented-looking blanks", () => {
  const fields = parseExtractedLicenseFields({
    licenseNumber: " 055-123456 ",
    licenseState: "IL",
    licenseType: "Plumbing",
    expirationDate: "2027-06-01",
    status: "active",
  })
  assertEquals(fields.licenseNumber, "055-123456")
  assertEquals(fields.licenseState, "IL")
})

Deno.test("parseExtractedCoiFields reads GL money strings", () => {
  const fields = parseExtractedCoiFields({
    carrier: "Travelers",
    policyNumber: "GL-99",
    generalLiability: "$1,000,000",
    expirationDate: "2027-12-31",
    additionalInsured: true,
  })
  assertEquals(fields.generalLiability, 1000000)
  assertEquals(fields.additionalInsured, true)
})

Deno.test("parseCertificialCoverage requires a real coverage field", () => {
  assertEquals(parseCertificialCoverage({ hello: "world" }), null)
  const parsed = parseCertificialCoverage({
    carrier: "Hartford",
    policy_number: "ABC",
    general_liability: 1000000,
    additional_insured: true,
  })
  assertEquals(parsed?.found, true)
  assertEquals(parsed?.carrier, "Hartford")
})
