import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A, INVOICE_A, RUN_A, TICKET_A, token } from "@/test/adminAuthorizationFixtures";
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  recordActivityLog: vi.fn(),
  clientAvailable: true,
}));
vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return mocks.clientAvailable
      ? { auth: { getSession: mocks.getSession } }
      : null;
  },
}));
vi.mock(
  "@/lib/activeLandlord",
  () => ({ getActiveLandlordId: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
);
vi.mock(
  "@/lib/recordActivityLog",
  () => ({ recordActivityLog: mocks.recordActivityLog }),
);
import {
  ADMIN_SESSION_REQUIRED,
  adminSessionInvokeHeaders,
} from "@/lib/adminSessionHeaders";
import {
  archiveWorkOrders,
  deleteWorkOrderPermanently,
} from "@/api/deleteWorkOrder";
import { cancelEmergencyWorkOrder } from "@/api/emergencyWorkOrderDecision";
import {
  approveMaintenanceInvoice,
  rejectMaintenanceInvoice,
} from "@/api/maintenanceInvoice";
const wire: Array<
  {
    action: string;
    phase: "compat" | "session-only";
    url: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
  }
> = [];
let requests: Array<{ url: string; init: RequestInit }>;
let responseStatus: number;
let sessionToken: string;
const calls = [
  {
    name: "bulk archive",
    invoke: () => archiveWorkOrders([TICKET_A]),
    endpoint: "terminate-work-order",
    body: {
      landlordId: ACCOUNT_A,
      ticketId: TICKET_A,
      mode: "archive",
      source: "dashboard",
      reason: "Archived from Request Management",
    },
  },
  {
    name: "single archive",
    invoke: () =>
      deleteWorkOrderPermanently({
        maintenanceRequestId: TICKET_A,
        workflowRunId: RUN_A,
      }),
    endpoint: "terminate-work-order",
    body: {
      landlordId: ACCOUNT_A,
      workflowRunId: RUN_A,
      ticketId: TICKET_A,
      mode: "archive",
      source: "admin_api",
      reason: "Archived from the workflow pipeline",
    },
  },
  {
    name: "emergency decision",
    invoke: () =>
      cancelEmergencyWorkOrder({ ticketId: TICKET_A, workflowRunId: RUN_A }),
    endpoint: "terminate-work-order",
    body: {
      landlordId: ACCOUNT_A,
      ticketId: TICKET_A,
      workflowRunId: RUN_A,
      mode: "cancel",
      source: "emergency_decline",
      reason: "Emergency work declined by the property team",
    },
  },
  {
    name: "invoice approval",
    invoke: () => approveMaintenanceInvoice(INVOICE_A, " QA note "),
    endpoint: "admin-approve-maintenance-invoice",
    body: {
      invoiceId: INVOICE_A,
      landlordId: ACCOUNT_A,
      action: "approve",
      note: "QA note",
    },
  },
  {
    name: "invoice rejection",
    invoke: () => rejectMaintenanceInvoice(INVOICE_A, "QA reason"),
    endpoint: "admin-approve-maintenance-invoice",
    body: {
      invoiceId: INVOICE_A,
      landlordId: ACCOUNT_A,
      action: "reject",
      rejectionReason: "QA reason",
    },
  },
];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.clientAvailable = true;
  sessionToken = token();
  mocks.getSession.mockResolvedValue({
    data: {
      session: {
        access_token: sessionToken,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      },
    },
    error: null,
  });
  mocks.recordActivityLog.mockResolvedValue(undefined);
  vi.stubEnv("VITE_SUPABASE_URL", "https://f08-ui.invalid");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "unit-anon-key");
  vi.stubEnv("VITE_ADMIN_REASSIGN_SECRET", "unit-public-browser-secret");
  vi.stubEnv("VITE_F08_LEGACY_ADMIN_COMPAT", "false");
  vi.stubEnv(
    "VITE_TERMINATE_WORK_ORDER_URL",
    "https://f08-ui.invalid/functions/v1/terminate-work-order",
  );
  vi.stubEnv(
    "VITE_ADMIN_APPROVE_INVOICE_URL",
    "https://f08-ui.invalid/functions/v1/admin-approve-maintenance-invoice",
  );
  requests = [];
  responseStatus = 200;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (!url.startsWith("https://f08-ui.invalid/")) {
        throw Error("Unexpected network URL");
      }
      requests.push({ url, init });
      return Response.json(
        responseStatus === 200
          ? {
            ok: true,
            archived: true,
            workflowRunId: RUN_A,
            maintenanceRequestId: TICKET_A,
          }
          : {
            error: responseStatus === 401
              ? "Invalid or expired session"
              : "Forbidden",
          },
        { status: responseStatus },
      );
    }),
  );
});
afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("session headers", () => {
  it("sends the real current session in Authorization, not the anon key", async () => {
    const h = await adminSessionInvokeHeaders();
    expect(h.Authorization).toBe("Bearer " + sessionToken);
    expect(h.apikey).toBe("unit-anon-key");
    expect(h).not.toHaveProperty("x-admin-reassign-secret");
    expect(h).not.toHaveProperty("x-ulo-access-token");
  });
  it("works without the old secret configuration", async () => {
    vi.stubEnv("VITE_ADMIN_REASSIGN_SECRET", "");
    expect((await adminSessionInvokeHeaders()).Authorization).toBe(
      "Bearer " + sessionToken,
    );
  });
  it("reads the current session for each separate action", async () => {
    await adminSessionInvokeHeaders();
    const next = token({ email: "changed@example.invalid" });
    mocks.getSession.mockResolvedValueOnce({
      data: { session: { access_token: next } },
      error: null,
    });
    expect((await adminSessionInvokeHeaders()).Authorization).toBe(
      "Bearer " + next,
    );
  });
  it("phase 1 retains only the approved legacy compatibility header alongside the user JWT", async () => {
    vi.stubEnv("VITE_F08_LEGACY_ADMIN_COMPAT", "true");
    const h = await adminSessionInvokeHeaders();
    expect(h.Authorization).toBe("Bearer " + sessionToken);
    expect(h["x-admin-reassign-secret"]).toBe("unit-public-browser-secret");
    expect(h.apikey).toBe("unit-anon-key");
  });
  it("phase 1 never falls back to the legacy credential without a session", async () => {
    vi.stubEnv("VITE_F08_LEGACY_ADMIN_COMPAT", "true");
    mocks.getSession.mockResolvedValueOnce({
      data: { session: null },
      error: null,
    });
    await expect(adminSessionInvokeHeaders()).rejects.toThrow(
      ADMIN_SESSION_REQUIRED,
    );
  });
  it("phase 1 fails clearly if its legacy rollout configuration is absent", async () => {
    vi.stubEnv("VITE_F08_LEGACY_ADMIN_COMPAT", "true");
    vi.stubEnv("VITE_ADMIN_REASSIGN_SECRET", "");
    await expect(adminSessionInvokeHeaders()).rejects.toThrow(
      "Legacy rollout configuration is missing.",
    );
  });
  it("phase 3 ignores a leftover shared-secret configuration", async () => {
    vi.stubEnv("VITE_F08_LEGACY_ADMIN_COMPAT", "false");
    expect(await adminSessionInvokeHeaders()).not.toHaveProperty(
      "x-admin-reassign-secret",
    );
  });
  it("fails clearly without configured Supabase client", async () => {
    mocks.clientAvailable = false;
    await expect(adminSessionInvokeHeaders()).rejects.toThrow(
      ADMIN_SESSION_REQUIRED,
    );
  });
  it("fails clearly when session lookup throws", async () => {
    mocks.getSession.mockRejectedValueOnce(Error("Synthetic session failure"));
    await expect(adminSessionInvokeHeaders()).rejects.toThrow(
      ADMIN_SESSION_REQUIRED,
    );
  });
  it("fails clearly on an expired session", async () => {
    mocks.getSession.mockResolvedValueOnce({
      data: { session: { access_token: sessionToken, expires_at: 1 } },
      error: null,
    });
    await expect(adminSessionInvokeHeaders()).rejects.toThrow(
      ADMIN_SESSION_REQUIRED,
    );
  });
  it("fails clearly on an auth error even if stale token data exists", async () => {
    mocks.getSession.mockResolvedValueOnce({
      data: { session: { access_token: sessionToken } },
      error: Error("Synthetic refresh error"),
    });
    await expect(adminSessionInvokeHeaders()).rejects.toThrow(
      ADMIN_SESSION_REQUIRED,
    );
  });
});
for (const c of calls) {
  describe(c.name, () => {
    it("sends user session and preserves the endpoint and business payload", async () => {
      await c.invoke();
      expect(requests).toHaveLength(1);
      const r = requests[0],
        h = Object.fromEntries(new Headers(r.init.headers));
      expect(r.url).toBe("https://f08-ui.invalid/functions/v1/" + c.endpoint);
      expect(h.authorization).toBe("Bearer " + sessionToken);
      expect(h.apikey).toBe("unit-anon-key");
      expect(h).not.toHaveProperty("x-admin-reassign-secret");
      expect(JSON.parse(String(r.init.body))).toEqual(c.body);
      wire.push({
        action: c.name,
        phase: "session-only",
        url: r.url,
        headers: h,
        body: JSON.parse(String(r.init.body)),
      });
      expect(mocks.recordActivityLog).toHaveBeenCalledTimes(
        c.name === "emergency decision" ? 1 : 0,
      );
    });
    it("phase 1 sends session Authorization plus legacy compatibility without changing the action", async () => {
      vi.stubEnv("VITE_F08_LEGACY_ADMIN_COMPAT", "true");
      await c.invoke();
      expect(requests).toHaveLength(1);
      const r = requests[0],
        h = Object.fromEntries(new Headers(r.init.headers));
      expect(h.authorization).toBe("Bearer " + sessionToken);
      expect(h["x-admin-reassign-secret"]).toBe("unit-public-browser-secret");
      expect(JSON.parse(String(r.init.body))).toEqual(c.body);
      wire.push({
        action: c.name,
        phase: "compat",
        url: r.url,
        headers: h,
        body: JSON.parse(String(r.init.body)),
      });
    });
    it("phase 1 still refuses the action without a user session", async () => {
      vi.stubEnv("VITE_F08_LEGACY_ADMIN_COMPAT", "true");
      mocks.getSession.mockResolvedValueOnce({
        data: { session: null },
        error: null,
      });
      await expect(c.invoke()).rejects.toThrow(ADMIN_SESSION_REQUIRED);
      expect(requests).toHaveLength(0);
      expect(mocks.recordActivityLog).not.toHaveBeenCalled();
    });
    it("does not require old shared-secret configuration", async () => {
      vi.stubEnv("VITE_ADMIN_REASSIGN_SECRET", "");
      await c.invoke();
      expect(requests).toHaveLength(1);
    });
    it("asks to sign in again and sends nothing if no session exists", async () => {
      mocks.getSession.mockResolvedValueOnce({
        data: { session: null },
        error: null,
      });
      await expect(c.invoke()).rejects.toThrow(ADMIN_SESSION_REQUIRED);
      expect(requests).toHaveLength(0);
      expect(mocks.recordActivityLog).not.toHaveBeenCalled();
    });
    it("surfaces a session failure before sending any action", async () => {
      mocks.getSession.mockResolvedValueOnce({
        data: { session: null },
        error: Error("Synthetic auth error"),
      });
      await expect(c.invoke()).rejects.toThrow(ADMIN_SESSION_REQUIRED);
      expect(requests).toHaveLength(0);
      expect(mocks.recordActivityLog).not.toHaveBeenCalled();
    });
    it("uses a clear sign-in-again message for a server 401", async () => {
      responseStatus = 401;
      if (c.name === "bulk archive") {
        const r = await c.invoke() as Awaited<
          ReturnType<typeof archiveWorkOrders>
        >;
        expect(r.errors[0].error).toBe(ADMIN_SESSION_REQUIRED);
        expect(r.archivedIds).toEqual([]);
      } else await expect(c.invoke()).rejects.toThrow(ADMIN_SESSION_REQUIRED);
      expect(mocks.recordActivityLog).not.toHaveBeenCalled();
    });
    it("preserves a server permission refusal without pretending login will grant authority", async () => {
      responseStatus = 403;
      if (c.name === "bulk archive") {
        const r = await c.invoke() as Awaited<
          ReturnType<typeof archiveWorkOrders>
        >;
        expect(r.errors[0].error).toBe("Forbidden");
      } else await expect(c.invoke()).rejects.toThrow("Forbidden");
      expect(mocks.recordActivityLog).not.toHaveBeenCalled();
    });
  });
}
