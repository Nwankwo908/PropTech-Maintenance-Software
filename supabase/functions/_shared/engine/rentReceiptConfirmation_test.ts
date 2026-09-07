/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  askAlreadyTracked,
  buildLandlordRentPartialConfirmSms,
  buildLandlordRentReceiptAskSms,
  checkPartialAmount,
  formatRentReceiptAmount,
  formatRentReceiptUnitLabel,
  hasLandlordRentReceiptPending,
  parseLandlordRentReceiptReply,
  parseMoneyAmountFromSms,
  parseRentPaymentMethod,
  readLandlordRentReceiptIntake,
  writeLandlordRentReceiptIntake,
} from "./rentReceiptConfirmation.ts"

Deno.test("formatRentReceiptAmount drops .00", () => {
  assertEquals(formatRentReceiptAmount(2400), "$2,400")
  assertEquals(formatRentReceiptAmount(2400.5), "$2,400.50")
})

Deno.test("formatRentReceiptUnitLabel prefixes Unit", () => {
  assertEquals(formatRentReceiptUnitLabel("2B"), "Unit 2B")
  assertEquals(formatRentReceiptUnitLabel("Unit 2B"), "Unit 2B")
})

Deno.test("buildLandlordRentReceiptAskSms includes PARTIAL", () => {
  const body = buildLandlordRentReceiptAskSms({
    runId: "r1",
    residentId: "u1",
    unitLabel: "2B",
    amountDue: 2400,
    billingPeriod: "2026-09",
    dueToday: true,
  })
  assertEquals(
    body,
    "Unit 2B — $2,400 rent due today. Did you receive it?\n\nReply YES, NO, or PARTIAL.",
  )
})

Deno.test("parseLandlordRentReceiptReply yes/no/partial/method", () => {
  assertEquals(parseLandlordRentReceiptReply("YES"), { kind: "yes" })
  assertEquals(parseLandlordRentReceiptReply("yes zelle"), {
    kind: "yes",
    method: "zelle",
  })
  assertEquals(parseLandlordRentReceiptReply("NO"), { kind: "no" })
  assertEquals(parseLandlordRentReceiptReply("PARTIAL"), {
    kind: "partial",
    amountStatus: "missing",
    method: undefined,
  })
  assertEquals(parseLandlordRentReceiptReply("PARTIAL 1200"), {
    kind: "partial",
    amountStatus: "ok",
    amount: 1200,
    method: undefined,
  })
  assertEquals(parseLandlordRentReceiptReply("PARTIAL 1200 Zelle"), {
    kind: "partial",
    amountStatus: "ok",
    amount: 1200,
    method: "zelle",
  })
  assertEquals(parseLandlordRentReceiptReply("PARTIAL 1200 or 1300"), {
    kind: "partial",
    amountStatus: "ambiguous",
    method: undefined,
  })
  assertEquals(parseLandlordRentReceiptReply("Venmo"), { kind: "method", method: "venmo" })
  assertEquals(parseLandlordRentReceiptReply("1200"), { kind: "amount", amount: 1200 })
  assertEquals(parseLandlordRentReceiptReply("hello"), null)
})

Deno.test("parseMoneyAmountFromSms ignores unit labels", () => {
  assertEquals(parseMoneyAmountFromSms("$1,200"), { status: "ok", amount: 1200 })
  assertEquals(parseMoneyAmountFromSms("1200.50"), { status: "ok", amount: 1200.5 })
})

Deno.test("checkPartialAmount validates range", () => {
  assertEquals(checkPartialAmount(1200, 2400), { ok: true, remaining: 1200 })
  assertEquals(checkPartialAmount(0, 2400), { ok: false, reason: "not_positive" })
  assertEquals(checkPartialAmount(2500, 2400), { ok: false, reason: "exceeds_balance" })
  assertEquals(checkPartialAmount(2400, 2400), { ok: true, remaining: 0 })
})

Deno.test("partial confirmation copy", () => {
  assertEquals(
    buildLandlordRentPartialConfirmSms(
      {
        runId: "r1",
        residentId: "u1",
        unitLabel: "2B",
        amountDue: 2400,
        billingPeriod: "2026-09",
      },
      "zelle",
      1200,
      1200,
    ),
    "Got it. $1,200 received via Zelle for Unit 2B. $1,200 is still due.",
  )
})

Deno.test("parseRentPaymentMethod aliases", () => {
  assertEquals(parseRentPaymentMethod("bank transfer"), "ach")
  assertEquals(parseRentPaymentMethod("cheque"), "check")
})

Deno.test("intake pending + queue tracking includes amount wait", () => {
  const written = writeLandlordRentReceiptIntake({}, {
    awaiting: null,
    awaitingAmount: {
      runId: "a",
      residentId: "r",
      unitLabel: "2B",
      amountDue: 2400,
      billingPeriod: "2026-09",
    },
    awaitingMethod: null,
    queue: [{
      runId: "b",
      residentId: "r2",
      unitLabel: "3A",
      amountDue: 200,
      billingPeriod: "2026-09",
    }],
    processedMessageIds: ["msg-1"],
    lastReply: "queued",
  })
  const read = readLandlordRentReceiptIntake(written)
  assertEquals(hasLandlordRentReceiptPending(written), true)
  assertEquals(askAlreadyTracked(read, "a"), true)
  assertEquals(askAlreadyTracked(read, "b"), true)
  assertEquals(askAlreadyTracked(read, "c"), false)
  assertEquals(read.processedMessageIds.includes("msg-1"), true)
  assertEquals(hasLandlordRentReceiptPending({}), false)
})
