/** Component-level user simulations: real production decisions, no I/O or live accounts. */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  reduceScheduleFsm,
  type ScheduleFsmEvent,
  type VendorScheduleFsmState,
} from "../../vendor_schedule_fsm.ts";
import { recognizeInboundIntentSync } from "../recognizeInboundIntent.ts";
import {
  pickLandlordIdFromRecentOutboundRows,
  uniqueLandlordIdFromRows,
} from "../inbound_db.ts";
import { parseTenantScheduleDecision } from "../tenantScheduleConfirm.ts";
import { parseEstimateDecisionKeyword } from "../estimateDecisionInbound.ts";
import {
  shouldClarifyAmbiguousYesPendingAsks,
  shouldYieldRentReplyToSpecificPendingAsk,
} from "../shortReplyArbitration.ts";
import { classifyTenantComplianceKeyword } from "../tenantMessaging.ts";
import { deliverVendorTextWithRetry } from "../vendorRescheduleSms.ts";
import { mergeAndRankExternalHits } from "../../external_vendor/ranking.ts";

const ACCOUNT_A = "sim-account-a";
const ACCOUNT_B = "sim-account-b";
const at = (minutes: number) =>
  new Date(Date.UTC(2026, 9, 24, 12, minutes)).toISOString();

class SchedulingJourney {
  state: VendorScheduleFsmState | null = null;
  effects: string[] = [];
  act(event: ScheduleFsmEvent) {
    const transition = reduceScheduleFsm(this.state, event);
    this.state = transition.state;
    if (!transition.suppressReply && transition.effect.kind !== "noop") {
      this.effects.push(transition.effect.kind);
    }
    return transition;
  }
  accept() {
    return this.act({
      type: "JOB_ACCEPTED",
      ticketId: "sim-job-a",
      at: at(0),
      inboundSid: "sim-accept",
    });
  }
  propose() {
    return this.act({
      type: "AVAILABILITY_TEXT",
      at: at(1),
      inboundSid: "sim-window",
      windowText: "Tomorrow 9am",
      scheduledAt: "2026-10-25T13:00:00.000Z",
      outcome: "resolved",
    });
  }
  resident(body: string, sid = "sim-resident", minute = 2) {
    const decision = parseTenantScheduleDecision(body);
    assertEquals(["accept", "decline"].includes(decision ?? ""), true);
    return this.act({
      type: decision === "accept" ? "TENANT_YES" : "TENANT_NO",
      at: at(minute),
      inboundSid: sid,
    });
  }
}

Deno.test("simulated resident → vendor → resident: repair through confirmed visit", () => {
  assertEquals(
    recognizeInboundIntentSync("Water is leaking under my sink").showMenu,
    false,
  );
  const journey = new SchedulingJourney();
  journey.accept();
  journey.propose();
  assertEquals(journey.resident("YES").effect.kind, "persist");
  journey.act({ type: "SAVE_OK", at: at(3), windowText: "Tomorrow 9am" });
  assertEquals(journey.state?.step, "scheduled");
  assertEquals(journey.state?.ticketId, "sim-job-a");
  assertEquals(journey.effects.slice(0, 3), [
    "ask_availability",
    "ask_tenant",
    "persist",
  ]);
});

Deno.test("simulated resident declines first slot; vendor proposes another", () => {
  const journey = new SchedulingJourney();
  journey.accept();
  journey.propose();
  assertEquals(journey.resident("NO").effect.kind, "tenant_declined");
  assertEquals(journey.state?.step, "awaiting_availability");
  journey.act({
    type: "AVAILABILITY_TEXT",
    at: at(3),
    inboundSid: "sim-second-slot",
    windowText: "Monday 2pm",
    scheduledAt: "2026-10-26T18:00:00.000Z",
    outcome: "resolved",
  });
  assertEquals(
    journey.resident("YES", "sim-second-yes", 4).effect.kind,
    "persist",
  );
  assertEquals(journey.state?.pendingWindowText, "Monday 2pm");
});

Deno.test("simulated webhook redelivery cannot repeat resident confirmation effect", () => {
  const journey = new SchedulingJourney();
  journey.accept();
  journey.propose();
  journey.resident("YES");
  const before = journey.effects.length;
  const replay = journey.resident("YES", "sim-resident", 3);
  assertEquals(replay.suppressReply, true);
  assertEquals(journey.effects.length, before);
});

Deno.test("simulated out-of-order vendor reply cannot overwrite newer proposal", () => {
  const journey = new SchedulingJourney();
  journey.accept();
  journey.propose();
  const before = structuredClone(journey.state);
  const stale = journey.act({
    type: "AVAILABILITY_TEXT",
    at: at(0),
    inboundSid: "sim-stale",
    windowText: "Wrong old slot",
    scheduledAt: null,
    outcome: "needs_clarification",
  });
  assertEquals(stale.suppressReply, true);
  assertEquals(journey.state?.pendingWindowText, before?.pendingWindowText);
});

Deno.test("simulated unanswered confirmation expires and requests fresh availability", () => {
  const journey = new SchedulingJourney();
  journey.accept();
  journey.propose();
  const expiry = Date.parse(journey.state!.expiresAt!);
  const result = journey.act({
    type: "TTL_CHECK",
    at: new Date(expiry + 1).toISOString(),
  });
  assertEquals(result.effect.kind, "tenant_confirm_expired");
  assertEquals(journey.state?.step, "awaiting_availability");
  assertEquals(journey.effects.includes("persist"), false);
});

Deno.test("simulated shared number follows recent outbound account; ambiguity fails closed", () => {
  assertEquals(
    pickLandlordIdFromRecentOutboundRows([{
      landlord_id: ACCOUNT_B,
      created_at: at(2),
    }, { landlord_id: ACCOUNT_A, created_at: at(0) }]),
    ACCOUNT_B,
  );
  assertEquals(
    uniqueLandlordIdFromRows([{ landlord_id: ACCOUNT_A }, {
      landlord_id: ACCOUNT_B,
    }]),
    null,
  );
  assertEquals(uniqueLandlordIdFromRows([]), null);
});

Deno.test("simulated YES with competing schedule and estimate asks needs clarification", () => {
  const intakeState = {
    awaiting_schedule_confirmation: true,
    awaiting_estimate_decision: { ticketId: "sim-job-b" },
  };
  assertEquals(
    shouldClarifyAmbiguousYesPendingAsks({ intakeState, body: "YES" }),
    true,
  );
  assertEquals(
    shouldYieldRentReplyToSpecificPendingAsk({ intakeState, body: "YES" }),
    true,
  );
  assertEquals(parseEstimateDecisionKeyword("APPROVE"), "approve");
  assertEquals(parseEstimateDecisionKeyword("DECLINE"), "reject");
});

Deno.test("simulated resident hazards bypass the normal intake menu", () => {
  for (
    const body of [
      "I smell gas",
      "carbon monoxide alarm is going off",
      "Huele a gas en la cocina",
    ]
  ) {
    const recognized = recognizeInboundIntentSync(body);
    assertEquals(recognized.intent, "emergency", body);
    assertEquals(recognized.layer, "emergency_net", body);
    assertEquals(recognized.showMenu, false, body);
  }
});

Deno.test("simulated STOP is compliance, while stopped heater remains a repair", () => {
  assertEquals(classifyTenantComplianceKeyword("STOP"), "stop");
  assertEquals(
    classifyTenantComplianceKeyword("My heater stopped working"),
    null,
  );
  assertEquals(
    recognizeInboundIntentSync("My heater stopped working").showMenu,
    false,
  );
});

Deno.test("simulated carrier outage recovers on one retry without a third send", async () => {
  const attempts: number[] = [];
  const result = await deliverVendorTextWithRetry(() => {
    attempts.push(attempts.length + 1);
    return Promise.resolve(
      attempts.length === 1
        ? { ok: false, error: "simulated_outage" }
        : { ok: true, conversationId: "sim-vendor-thread" },
    );
  });
  assertEquals(result.ok, true);
  assertEquals(result.attempts, 2);
  assertEquals(attempts.length, 2);
  assertEquals(result.conversationId, "sim-vendor-thread");
});

Deno.test("simulated permanent delivery failure preserves handoff reason and stops retrying", async () => {
  let attempts = 0;
  const result = await deliverVendorTextWithRetry(() => {
    attempts++;
    return Promise.resolve({ ok: false, error: "simulated_carrier_rejection" });
  });
  assertEquals(result.ok, false);
  assertEquals(attempts, 2);
  assertEquals(result.reason, "simulated_carrier_rejection");
  assertEquals(result.conversationId, null);
});

Deno.test("simulated vendor discovery deduplicates suggestions before presenting choices", () => {
  const choices = mergeAndRankExternalHits([
    {
      name: "Sim Plumbing",
      rating: 4.9,
      reviewCount: 150,
      priceLabel: null,
      source: "mock",
    },
    {
      name: "sim plumbing",
      rating: 4.8,
      reviewCount: 100,
      priceLabel: null,
      source: "mock",
    },
    {
      name: "Sim Backup",
      rating: 3.0,
      reviewCount: 2,
      priceLabel: null,
      source: "mock",
    },
  ], { limit: 2 });
  assertEquals(choices.length, 2);
  assertEquals(choices[0].name.toLowerCase(), "sim plumbing");
});
