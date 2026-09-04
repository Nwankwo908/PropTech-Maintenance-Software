/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  normalizeAppOrigin,
  uloAppOrigin,
  uloAppUrl,
} from "./uloAppUrl.ts"

Deno.test("normalizeAppOrigin adds https and strips trailing slash", () => {
  assertEquals(normalizeAppOrigin("app.ulohome.io/"), "https://app.ulohome.io")
  assertEquals(normalizeAppOrigin("https://local.test/"), "https://local.test")
  assertEquals(normalizeAppOrigin(""), "")
})

Deno.test("uloAppOrigin prefers returnOrigin then requestOrigin", () => {
  assertEquals(
    uloAppOrigin({
      returnOrigin: "http://localhost:5173",
      requestOrigin: "https://app.ulohome.io",
      fallback: "https://fallback.test",
    }),
    "http://localhost:5173",
  )
  assertEquals(
    uloAppOrigin({
      requestOrigin: "https://app.ulohome.io",
      fallback: "https://fallback.test",
    }),
    "https://app.ulohome.io",
  )
  const prevApp = Deno.env.get("APP_URL")
  const prevRent = Deno.env.get("RENT_PAYMENT_BASE_URL")
  Deno.env.delete("APP_URL")
  Deno.env.delete("RENT_PAYMENT_BASE_URL")
  try {
    assertEquals(uloAppOrigin({ fallback: "" }), "")
  } finally {
    if (prevApp != null) Deno.env.set("APP_URL", prevApp)
    if (prevRent != null) Deno.env.set("RENT_PAYMENT_BASE_URL", prevRent)
  }
})

Deno.test("uloAppUrl named paths", () => {
  const origin = { returnOrigin: "https://app.example" }
  assertEquals(
    uloAppUrl.vendorVerification("tok-1", origin),
    "https://app.example/v/tok-1",
  )
  assertEquals(
    uloAppUrl.vendorVerification("tok-1", { ...origin, connect: "return" }),
    "https://app.example/v/tok-1?connect=return",
  )
  assertEquals(
    uloAppUrl.workOrder("abc", origin),
    "https://app.example/w/abc",
  )
  assertEquals(
    uloAppUrl.estimate("abc", origin),
    "https://app.example/estimate/abc",
  )
  assertEquals(
    uloAppUrl.invoice("abc", origin),
    "https://app.example/invoice/abc",
  )
  assertEquals(
    uloAppUrl.upload("abc", origin),
    "https://app.example/upload/abc",
  )
  assertEquals(uloAppUrl.admin("", origin), "https://app.example/admin")
  assertEquals(
    uloAppUrl.admin("analytics", origin),
    "https://app.example/admin/analytics",
  )
  assertEquals(
    uloAppUrl.findExternalVendor("ticket-1", origin),
    "https://app.example/admin?findVendor=1&ticket=ticket-1",
  )
  assertEquals(
    uloAppUrl.inspectionCapture("sess-1", "tok-hex", origin),
    "https://app.example/inspection/capture/sess-1?token=tok-hex",
  )

  const rent = uloAppUrl.rentPayment(
    {
      runId: "run-1",
      residentId: "res-1",
      billingPeriod: "2026-07",
      amountDue: 1200,
    },
    origin,
  )
  assertEquals(rent.includes("/pay/rent?"), true)
  assertEquals(rent.includes("run=run-1"), true)
  assertEquals(rent.includes("resident=res-1"), true)
  assertEquals(rent.includes("period=2026-07"), true)
  assertEquals(rent.includes("amount=1200"), true)
})

Deno.test("uloAppUrl relative when origin empty", () => {
  const prevApp = Deno.env.get("APP_URL")
  const prevRent = Deno.env.get("RENT_PAYMENT_BASE_URL")
  Deno.env.delete("APP_URL")
  Deno.env.delete("RENT_PAYMENT_BASE_URL")
  try {
    assertEquals(uloAppUrl.workOrder("t", { fallback: "" }), "/w/t")
    assertEquals(uloAppUrl.estimate("t", { fallback: "" }), "/estimate/t")
  } finally {
    if (prevApp != null) Deno.env.set("APP_URL", prevApp)
    if (prevRent != null) Deno.env.set("RENT_PAYMENT_BASE_URL", prevRent)
  }
})
