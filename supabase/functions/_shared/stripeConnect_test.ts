/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  assertConnectReturnOriginForStripe,
  connectAccountSessionParams,
  connectHttpsRequiredMessage,
  isEmbeddedNoDashboardConnectAccount,
  resolveConnectAppBaseUrl,
  stripeErrorMessage,
  stripePublishableKeyFromEnv,
} from "./stripeConnect.ts"

Deno.test("stripeErrorMessage explains live HTTPS redirect requirement", () => {
  const msg = stripeErrorMessage({
    error: { message: "Livemode requests must always be redirected via HTTPS." },
  })
  assertStringIncludes(msg, "HTTPS")
  assertStringIncludes(msg, "sk_test_")
})

Deno.test("resolveConnectAppBaseUrl keeps localhost for test keys", () => {
  const prev = Deno.env.get("STRIPE_SECRET_KEY")
  Deno.env.set("STRIPE_SECRET_KEY", "sk_test_abc")
  try {
    assertEquals(
      resolveConnectAppBaseUrl({ returnOrigin: "http://localhost:5173" }),
      "http://localhost:5173",
    )
  } finally {
    if (prev == null) Deno.env.delete("STRIPE_SECRET_KEY")
    else Deno.env.set("STRIPE_SECRET_KEY", prev)
  }
})

Deno.test("resolveConnectAppBaseUrl falls back to https APP_URL in live mode", () => {
  const prevKey = Deno.env.get("STRIPE_SECRET_KEY")
  const prevApp = Deno.env.get("APP_URL")
  Deno.env.set("STRIPE_SECRET_KEY", "sk_live_abc")
  Deno.env.set("APP_URL", "https://app.ulohome.io")
  try {
    assertEquals(
      resolveConnectAppBaseUrl({ returnOrigin: "http://localhost:5173" }),
      "https://app.ulohome.io",
    )
  } finally {
    if (prevKey == null) Deno.env.delete("STRIPE_SECRET_KEY")
    else Deno.env.set("STRIPE_SECRET_KEY", prevKey)
    if (prevApp == null) Deno.env.delete("APP_URL")
    else Deno.env.set("APP_URL", prevApp)
  }
})

Deno.test("connectAccountSessionParams enables embedded account onboarding", () => {
  const body = connectAccountSessionParams("acct_test_123")
  assertEquals(body.get("account"), "acct_test_123")
  assertEquals(body.get("components[account_onboarding][enabled]"), "true")
  assertEquals(
    body.get("components[account_onboarding][features][external_account_collection]"),
    "true",
  )
  assertEquals(
    body.get("components[account_onboarding][features][disable_stripe_user_authentication]"),
    "true",
  )
})

Deno.test("isEmbeddedNoDashboardConnectAccount requires dashboard none", () => {
  assertEquals(
    isEmbeddedNoDashboardConnectAccount({
      controller: {
        requirement_collection: "application",
        stripe_dashboard: { type: "none" },
      },
    }),
    true,
  )
  assertEquals(
    isEmbeddedNoDashboardConnectAccount({
      type: "express",
      controller: {
        requirement_collection: "stripe",
        stripe_dashboard: { type: "express" },
      },
    }),
    false,
  )
})

Deno.test("assertConnectReturnOriginForStripe blocks live http origins", () => {
  const prev = Deno.env.get("STRIPE_SECRET_KEY")
  Deno.env.set("STRIPE_SECRET_KEY", "sk_live_abc")
  try {
    const result = assertConnectReturnOriginForStripe("http://localhost:5173")
    assertEquals(result.ok, false)
    if (!result.ok) {
      assertEquals(result.error, connectHttpsRequiredMessage())
    }
  } finally {
    if (prev == null) Deno.env.delete("STRIPE_SECRET_KEY")
    else Deno.env.set("STRIPE_SECRET_KEY", prev)
  }
})

Deno.test("stripePublishableKeyFromEnv prefers STRIPE_PUBLISHABLE_KEY", () => {
  const prev = Deno.env.get("STRIPE_PUBLISHABLE_KEY")
  const prevVite = Deno.env.get("VITE_STRIPE_PUBLISHABLE_KEY")
  Deno.env.set("STRIPE_PUBLISHABLE_KEY", "pk_test_edge")
  Deno.env.set("VITE_STRIPE_PUBLISHABLE_KEY", "pk_test_vite")
  try {
    assertEquals(stripePublishableKeyFromEnv(), "pk_test_edge")
  } finally {
    if (prev == null) Deno.env.delete("STRIPE_PUBLISHABLE_KEY")
    else Deno.env.set("STRIPE_PUBLISHABLE_KEY", prev)
    if (prevVite == null) Deno.env.delete("VITE_STRIPE_PUBLISHABLE_KEY")
    else Deno.env.set("VITE_STRIPE_PUBLISHABLE_KEY", prevVite)
  }
})
