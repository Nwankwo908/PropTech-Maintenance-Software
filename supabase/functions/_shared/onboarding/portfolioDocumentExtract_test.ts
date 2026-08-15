import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  buildUserContent,
  extractLooksUnread,
  isExtractedPlaceholderValue,
  normalizePortfolioDocumentExtract,
  pdfNeedsNativeFileRead,
} from "./portfolioDocumentExtract.ts"

Deno.test("PDF with extracted text is sent as text, not an image", () => {
  const parts = buildUserContent(
    "lease-agreement.pdf",
    "lease_agreement",
    "application/pdf",
    new Uint8Array([1, 2, 3]),
    {
      pdfText:
        "RESIDENTIAL LEASE AGREEMENT\n".repeat(20) +
        "Landlord: Acme LLC\nTenant: Jamie Tenant\nPremises: 100 Main St Unit 4B\n" +
        "Term: 2024-03-01 to 2025-02-28\nMonthly rent $1800\nSecurity deposit $1800\n",
    },
  )
  assertEquals(parts.length, 1)
  assertEquals(parts[0]?.type, "text")
  const text = String(parts[0]?.text ?? "")
  assertEquals(/PDF text:/i.test(text), true)
  assertEquals(/lease_agreement/i.test(text), true)
  assertEquals(parts.some((part) => part.type === "image_url"), false)
})

Deno.test("scanned PDF without text is not sent as a fake chat image", () => {
  const parts = buildUserContent(
    "signed-lease.pdf",
    "lease_agreement",
    "application/pdf",
    new Uint8Array([37, 80, 68, 70]),
    { pdfText: "" },
  )
  assertEquals(parts.some((part) => part.type === "image_url"), false)
  assertEquals(parts.some((part) => part.type === "file"), false)
  assertEquals(pdfNeedsNativeFileRead(""), true)
  assertEquals(pdfNeedsNativeFileRead("short"), true)
  assertEquals(pdfNeedsNativeFileRead("RESIDENTIAL LEASE AGREEMENT\n".repeat(20)), false)
})

Deno.test("empty extract warnings about unread files are detected", () => {
  assertEquals(
    extractLooksUnread({
      account: { companyName: "", contactName: "", email: "", phone: "" },
      properties: [],
      units: [],
      residents: [],
      vendors: [],
      leases: [],
      maintenanceIssues: [],
      financialRecords: [],
      imageLabels: [],
      warnings: ["No content could be read from this document."],
    }),
    true,
  )
})

Deno.test("placeholder status values are stripped from extracted fields", () => {
  assertEquals(isExtractedPlaceholderValue("Needs attention"), true)
  const payload = normalizePortfolioDocumentExtract({
    residents: [{ fullName: "Needs attention", unit: "4B", confidence: 40 }],
    leases: [{ residentName: "n/a", unit: "4B" }],
    vendors: [{ name: "unknown" }],
    maintenanceIssues: [{ description: "needs review" }],
    warnings: ["Needs attention", "Page 2 is illegible"],
    imageLabels: ["string", "Kitchen leak"],
    properties: [{ name: "Ready for review" }],
  })
  assertEquals(payload.residents.length, 0)
  assertEquals(payload.leases.length, 0)
  assertEquals(payload.vendors.length, 0)
  assertEquals(payload.maintenanceIssues.length, 0)
  assertEquals(payload.properties.length, 0)
  assertEquals(payload.warnings, ["Page 2 is illegible"])
  assertEquals(payload.imageLabels, ["Kitchen leak"])
})

Deno.test("landlord / management company is read into account.companyName", () => {
  const nested = normalizePortfolioDocumentExtract({
    account: { companyName: "CEO Rentals NJ LLC", contactName: "Alex Manager" },
    residents: [{ fullName: "Jane Smith", unit: "4B" }],
  })
  assertEquals(nested.account.companyName, "CEO Rentals NJ LLC")
  assertEquals(nested.account.contactName, "Alex Manager")

  const fromLandlordLine = normalizePortfolioDocumentExtract({
    landlord: "Acme Property Management",
    leases: [{ residentName: "Jamie Tenant", unit: "1A" }],
  })
  assertEquals(fromLandlordLine.account.companyName, "Acme Property Management")
})
