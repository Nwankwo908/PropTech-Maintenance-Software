import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_A,
  RUN_A,
  TICKET_A,
  token,
} from "@/test/adminAuthorizationFixtures";
const state = vi.hoisted(() => ({
  getSession: vi.fn(),
  landlord: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
}));
vi.mock(
  "@/lib/supabase",
  () => ({ supabase: { auth: { getSession: state.getSession } } }),
);
vi.mock(
  "@/lib/activeLandlord",
  () => ({ getActiveLandlordId: () => state.landlord }),
);
import { postAdminReassignVendor } from "@/api/adminReassignVendor";
import {
  postAdminMoveWorkflowStage,
  postAdminSetVisitTime,
} from "@/api/adminMoveWorkflowStage";
import { adminSessionInvokeHeaders } from "@/lib/adminSessionHeaders";
let requests: Array<
    { url: string; headers: Headers; body: Record<string, unknown> }
  > = [],
  status = 200;
const calls = [
  {
    name: "reassign",
    endpoint: "admin-reassign-vendor",
    invoke: () =>
      postAdminReassignVendor({
        url: "https://candidate.invalid/functions/v1/admin-reassign-vendor",
        secret: "ignored-untrusted-input",
        ticketId: TICKET_A,
        vendorId: "77777777-7777-4777-8777-777777777777",
      }),
  },
  {
    name: "stage",
    endpoint: "admin-move-workflow-stage",
    invoke: () =>
      postAdminMoveWorkflowStage({
        ticketId: TICKET_A,
        runId: RUN_A,
        fromStage: "new_intake",
        toStage: "in_progress",
      }),
  },
  {
    name: "visit",
    endpoint: "admin-move-workflow-stage",
    invoke: () =>
      postAdminSetVisitTime({
        ticketId: TICKET_A,
        visitDate: "2026-12-01",
        windowText: "9am-11am",
      }),
  },
];
beforeEach(() => {
  requests = [];
  status = 200;
  state.landlord = ACCOUNT_A;
  state.getSession.mockResolvedValue({
    data: {
      session: { access_token: token(), expires_at: Date.now() / 1000 + 3600 },
    },
    error: null,
  });
  vi.stubEnv("VITE_SUPABASE_URL", "https://candidate.invalid");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "unit-anon-key");
  vi.stubEnv("VITE_ADMIN_REASSIGN_SECRET", "unit-public-browser-secret");
  vi.stubEnv("VITE_ADMIN_AUTH_LEGACY_COMPAT", "false");
  vi.stubEnv("VITE_F08_LEGACY_ADMIN_COMPAT", "false");
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    requests.push({
      url,
      headers: new Headers(init.headers),
      body: JSON.parse(String(init.body)),
    });
    return Response.json(
      status === 200
        ? {
          ok: true,
          ticketId: TICKET_A,
          workOrderRef: "WO-UNIT",
          stage: "in_progress",
        }
        : { error: status === 401 ? "Session rejected" : "Forbidden" },
      { status },
    );
  });
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
for (const c of calls) {
  describe(c.name, () => {
    it("sends user session, selected account and endpoint without legacy value", async () => {
      await c.invoke();
      expect(requests).toHaveLength(1);
      const r = requests[0];
      expect(r.url).toBe(
        "https://candidate.invalid/functions/v1/" + c.endpoint,
      );
      expect(r.body.landlordId).toBe(ACCOUNT_A);
      expect(r.headers.get("Authorization")).toBe("Bearer " + token());
      expect(r.headers.get("apikey")).toBe("unit-anon-key");
      expect(r.headers.has("x-admin-reassign-secret")).toBe(false);
    });
    it("compatibility mode adds only the configured legacy value beside user identity", async () => {
      vi.stubEnv("VITE_ADMIN_AUTH_LEGACY_COMPAT", "true");
      await c.invoke();
      expect(requests[0].headers.get("Authorization")).toBe(
        "Bearer " + token(),
      );
      expect(requests[0].headers.get("x-admin-reassign-secret")).toBe(
        "unit-public-browser-secret",
      );
    });
    it("new compatibility flag never substitutes for missing session", async () => {
      vi.stubEnv("VITE_ADMIN_AUTH_LEGACY_COMPAT", "true");
      state.getSession.mockResolvedValue({
        data: { session: null },
        error: null,
      });
      await expect(c.invoke()).rejects.toThrow("Please sign in again");
      expect(requests).toHaveLength(0);
    });
    it("expired session stops before request", async () => {
      state.getSession.mockResolvedValue({
        data: { session: { access_token: token(), expires_at: 1 } },
        error: null,
      });
      await expect(c.invoke()).rejects.toThrow("Please sign in again");
      expect(requests).toHaveLength(0);
    });
    it("missing account stops before action", async () => {
      state.landlord = "";
      await expect(c.invoke()).rejects.toThrow("No active landlord");
      expect(requests).toHaveLength(0);
    });
    it("HTTP 401 gives sign-in-again error", async () => {
      status = 401;
      await expect(c.invoke()).rejects.toThrow("Please sign in again");
    });
    it("HTTP 403 preserves authorization refusal", async () => {
      status = 403;
      await expect(c.invoke()).rejects.toThrow("Forbidden");
    });
    it("session-only mode works without shared-key configuration", async () => {
      vi.stubEnv("VITE_ADMIN_REASSIGN_SECRET", "");
      await c.invoke();
      expect(requests).toHaveLength(1);
      expect(requests[0].headers.has("x-admin-reassign-secret")).toBe(false);
    });
  });
}
it("new compatibility mode does not re-enable legacy headers for prior F08 callers", async () => {
  vi.stubEnv("VITE_ADMIN_AUTH_LEGACY_COMPAT", "true");
  expect(await adminSessionInvokeHeaders()).not.toHaveProperty(
    "x-admin-reassign-secret",
  );
  await calls[0].invoke();
  expect(requests[0].headers.has("x-admin-reassign-secret")).toBe(true);
});
