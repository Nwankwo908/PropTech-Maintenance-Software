import {
  attestExternalCoiOnFile,
  attestExternalLicenseNumber,
  isProviderCredentialed,
  lookupExternalVendorCompliance,
} from "./complianceLookup.ts"

Deno.test("Thumbtack licensed vendors skip board/Certificial", async () => {
  const result = await lookupExternalVendorCompliance({
    name: "Igreen Builders Inc",
    sources: ["thumbtack"],
    priceLabel: "Licensed · From $85",
    tradeLabel: "Plumbing",
  })
  if (!isProviderCredentialed({
    name: "Igreen Builders Inc",
    sources: ["thumbtack"],
    priceLabel: "Licensed · From $85",
  })) {
    throw new Error("expected credentialed")
  }
  if (result.license.simulated || result.coi.simulated) {
    throw new Error("Thumbtack licensed results should not be simulated")
  }
  if (result.license.checkSource !== "thumbtack" || result.coi.checkSource !== "thumbtack") {
    throw new Error("expected thumbtack check source")
  }
  if (result.license.status !== "auto_verified") throw new Error("license")
  if (result.coi.status !== "monitoring") throw new Error("coi")
})

Deno.test("Unlicensed Thumbtack vendors use live board/Certificial results", async () => {
  const result = await lookupExternalVendorCompliance(
    {
      name: "BrightWire Electric",
      sources: ["thumbtack"],
      phone: "(312) 555-0144",
      tradeLabel: "Electrical",
    },
    {
      lookupLicense: async () => ({
        status: "auto_verified",
        licenseNumber: "EL-4411",
        detail: "EL-4411 · Active · State Electrical Contractor Board",
        boardLabel: "State Electrical Contractor Board",
        expirationDate: "2027-01-01",
        simulated: false,
        checkSource: "state_board",
      }),
      lookupCoi: async () => ({
        status: "not_found",
        policyNumber: null,
        carrier: null,
        detail: "No insurance certificate on file. Upload a COI to verify coverage.",
        expirationDate: null,
        monitoringActive: false,
        simulated: false,
        checkSource: "certificial",
      }),
    },
  )
  if (result.license.checkSource !== "state_board") throw new Error("license source")
  if (result.coi.checkSource !== "certificial") throw new Error("coi source")
  if (result.license.simulated || result.coi.simulated) {
    throw new Error("expected live (non-simulated) checks")
  }
})

Deno.test("manual license attestation accepts any valid number", () => {
  const ok = attestExternalLicenseNumber({
    subject: { name: "BrightWire Electric", sources: ["thumbtack"] },
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
