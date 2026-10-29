import { expect, it, vi } from "vitest";
import { actHomeCheckGuide } from "./guideAct.ts";
import { type HomeCheckGuideState, reduceHomeCheckGuide } from "./guide.ts";
import { sendInboundAutoReply } from "../sms/inboundReply.ts";
// Transport-failure probe only: fixed scheduling result, not a parser test.
vi.mock(
  "../vendor_availability_parse.ts",
  () => ({
    parseAvailabilityResolved: (body: string) =>
      body.includes("Thu")
        ? {
          scheduledAt: "2026-10-29T18:00:00Z",
          endAt: "2026-10-29T20:00:00Z",
          windowLabel: "Thu 2-4pm",
        }
        : null,
  }),
);
vi.mock(
  "../graph/recordActivityLog.ts",
  () => ({ recordActivityLog: vi.fn(async () => {}) }),
);
vi.mock(
  "../sms/inbound_db.ts",
  () => ({
    normalizeSmsPhone: (p: string) => p,
    findOrCreateConversation: async () => ({ conversationId: "tenant-thread" }),
  }),
);
vi.mock(
  "../sms/inboundReply.ts",
  () => ({
    sendInboundAutoReply: vi.fn(async () => ({
      ok: false,
      error: "Injected provider outage",
    })),
  }),
);
vi.mock(
  "../sms/landlordSmsOnboarding.ts",
  () => ({
    resolveOutboundLandlordSmsLine: async () => ({
      id: "line",
      phone: "+15550100002",
    }),
  }),
);
vi.mock("./service.ts", () => ({
  requireData: ({ data, error }: any) => {
    if (error) throw error;
    return data;
  },
  createHomeCheck: async () => ({
    check: { id: "check" },
    deliveryError: "Injected provider outage",
  }),
}));
const now = new Date("2026-10-28T15:00:00Z");
const catalog = {
  timeZone: "America/New_York",
  properties: [{
    id: "oak",
    label: "12 Oak St",
    propertyType: "multi_family",
    units: [{ id: "u2", label: "2B" }],
  }],
  vendors: [{ id: "near", name: "Test Contractor", distanceKm: 1 }],
  tenant: { name: "Test Resident", phone: "+15550100001", optedOut: false },
};
function stateAfter(messages: string[]) {
  let state: HomeCheckGuideState | null = null;
  for (const body of messages) {
    state =
      reduceHomeCheckGuide({ state, body, catalog, now, sender: "landlord" })
        .state;
  }
  return state;
}
function db(state: HomeCheckGuideState | null) {
  let intake: any = { home_check_guide: state };
  return {
    from(table: string) {
      let fields = "";
      let update: any = null;
      const b: any = {
        select(s: string) {
          fields = s;
          return b;
        },
        eq() {
          return b;
        },
        update(v: any) {
          update = v;
          return b;
        },
        then(resolve: any) {
          let data: any = [];
          if (table === "sms_conversations") {
            if (update) intake = update.intake_state;
            data = [{ id: "thread", intake_state: intake }];
          }
          if (table === "properties") {
            data = fields.includes("latitude")
              ? [{ latitude: 1, longitude: 1 }]
              : [{
                id: "oak",
                name: "12 Oak St",
                street_address: "12 Oak St",
                property_type: "multi_family",
              }];
          }
          if (table === "units") {
            data = [{ id: "u2", property_id: "oak", unit_label: "2B" }];
          }
          if (table === "landlords") {
            data = [{
              name: "Test",
              phone: "+15550100003",
              time_zone: "America/New_York",
            }];
          }
          if (table === "vendors") {
            data = [{
              id: "near",
              name: "Test Contractor",
              phone: "+15550100004",
              latitude: 1,
              longitude: 1,
              active: true,
            }];
          }
          if (table === "occupancy") data = [{ resident_id: "resident" }];
          if (table === "users") {
            data = [{
              full_name: "Test Resident",
              phone: "+15550100001",
              sms_consent_status: "opted_in",
            }];
          }
          return Promise.resolve(resolve({ data, error: null }));
        },
        async maybeSingle() {
          const r: any = await b;
          return { ...r, data: r.data[0] ?? null };
        },
        single() {
          return b.maybeSingle();
        },
      };
      return b;
    },
  };
}
it("reports tenant invitation failure instead of claiming it will ask the tenant", async () => {
  const state = stateAfter(["CHECK CONTRACTOR 12 Oak St / 2B", "YES", "YES"]);
  expect(state?.step).toBe("pick_window");
  const result = await actHomeCheckGuide(db(state) as any, "disposable", {
    body: "Thu 2-4pm",
    conversationId: "thread",
    sender: "landlord",
    initiatorPhone: "+15550100003",
    now,
  });
  expect(result.reply).toMatch(/failed|unable|could not|try again/i);
  expect(result.reply).toContain('No contractor link was sent');
});
it("does not claim the contractor has the link when delivery failed", async () => {
  vi.mocked(sendInboundAutoReply).mockClear();
  const state = stateAfter([
    "CHECK CONTRACTOR 12 Oak St / 2B",
    "YES",
    "YES",
    "Thu 2-4pm",
  ]);
  expect(state?.step).toBe("awaiting_tenant");
  const result = await actHomeCheckGuide(db(state) as any, "disposable", {
    body: "Thu 2-4pm and I'll be home",
    conversationId: "thread",
    sender: "tenant",
    initiatorPhone: "+15550100003",
    now,
  });
  expect(result.reply).toContain('could not send the photo instructions to the contractor');
  expect(sendInboundAutoReply).not.toHaveBeenCalled();
  expect(
    [
      result.reply,
      ...vi.mocked(sendInboundAutoReply).mock.calls.map((c: any) => c[1].body),
    ].join(" "),
  ).not.toContain("contractor has the photo link");
});
