import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { decideCancelConfirm } from "./cancelConfirmDecision.ts"

Deno.test("never mind with one repair asks before closing", () => {
  assertEquals(
    decideCancelConfirm({
      whichRequestConfirmed: false,
      awaitingYes: false,
      affirmative: false,
      negative: false,
      identifiableCount: 1,
      hasNamedTicket: false,
      hasTicket: true,
    }),
    "ask_yes",
  )
})

Deno.test("several open repairs are not guessed", () => {
  assertEquals(
    decideCancelConfirm({
      whichRequestConfirmed: false,
      awaitingYes: false,
      affirmative: false,
      negative: false,
      identifiableCount: 2,
      hasNamedTicket: false,
      hasTicket: true,
    }),
    "ask_which",
  )
})

Deno.test("naming the request after the which-question closes it", () => {
  assertEquals(
    decideCancelConfirm({
      whichRequestConfirmed: true,
      awaitingYes: false,
      affirmative: false,
      negative: false,
      identifiableCount: 2,
      hasNamedTicket: true,
      hasTicket: true,
    }),
    "close",
  )
})

Deno.test("a second cancel phrase is not a yes", () => {
  assertEquals(
    decideCancelConfirm({
      whichRequestConfirmed: false,
      awaitingYes: true,
      affirmative: false,
      negative: false,
      identifiableCount: 1,
      hasNamedTicket: false,
      hasTicket: true,
    }),
    "ask_yes",
  )
})

Deno.test("no before yes leaves the repair open", () => {
  assertEquals(
    decideCancelConfirm({
      whichRequestConfirmed: false,
      awaitingYes: true,
      affirmative: false,
      negative: true,
      identifiableCount: 1,
      hasNamedTicket: false,
      hasTicket: true,
    }),
    "decline",
  )
})

Deno.test("yes confirms the repair already named", () => {
  assertEquals(
    decideCancelConfirm({
      whichRequestConfirmed: false,
      awaitingYes: true,
      affirmative: true,
      negative: false,
      identifiableCount: 1,
      hasNamedTicket: true,
      hasTicket: true,
    }),
    "close",
  )
})
