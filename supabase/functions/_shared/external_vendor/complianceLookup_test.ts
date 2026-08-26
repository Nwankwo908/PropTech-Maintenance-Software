import {
  attestExternalCoiOnFile,
  attestExternalLicenseNumber,
  isProviderCredentialed,
  lookupExternalVendorCompliance,
} from "./complianceLookup.ts"

Deno.test("NetVendor credentialed vendors skip simulated board/Certificial", () => {
  const result = lookupExternalVendorCompliance({
    name: "Credentialed Flow Plumbing",
    sources: ["netvendor"],
    priceLabel: "Compliant · COI on file",
    tradeLabel: "Plumbing",
  })
  if (!isProviderCredentialed({
    name: "Credentialed Flow Plumbing",
    sources: ["netvendor"],
    priceLabel: "Compliant · COI on file",
  })) {
    throw new Error("expected credentialed")
  }
  if (result.license.simulated || result.coi.simulated) {
    throw new Error("NetVendor results should not be simulated")
  }
  if (result.license.checkSource !== "netvendor" || result.coi.checkSource !== "netvendor") {
    throw new Error("expected netvendor check source")
  }
  if (result.license.status !== "auto_verified") throw new Error("license")
  if (result.coi.status !== "monitoring") throw new Error("coi")
})

Deno.test("Google/Yelp vendors use simulated seams", () => {
  const result = lookupExternalVendorCompliance({
    name: "BrightWire Electric",
    sources: ["google"],
    phone: "(312) 555-0144",
    tradeLabel: "Electrical",
  })
  if (result.license.checkSource !== "state_board") throw new Error("license source")
  if (result.coi.checkSource !== "certificial") throw new Error("coi source")
  if (!result.license.simulated || !result.coi.simulated) {
    throw new Error("expected simulated board/Certificial")
  }
})

Deno.test("manual license attestation accepts any valid number", () => {
  const ok = attestExternalLicenseNumber({
    subject: { name: "BrightWire Electric", sources: ["google"] },
    licenseNumber: "IL-998877",
    approverName: "Alex",
  })
  if ("error" in ok) throw new Error(ok.error)
  if (ok.status !== "manual_verified") throw new Error("status")
  if (ok.simulated) throw new Error("manual should not be simulated")
  if (ok.checkSource !== "admin_attestation") throw new Error("source")
})

Deno.test("manual COI attestation enrolls monitoring", () => {
  const ok = attestExternalCoiOnFile({
    subject: { name: "BrightWire Electric" },
    approverName: "Alex",
  })
  if (ok.status !== "monitoring" || !ok.monitoringActive) throw new Error("coi")
  if (ok.simulated) throw new Error("attest should not be simulated")
})
