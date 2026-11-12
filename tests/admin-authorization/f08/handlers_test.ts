import { handlers } from "./server_stub.ts";
import { reset, state } from "./sdk_stub.ts";
import {
  ACCOUNT_A,
  ACCOUNT_B,
  type AuthOptions,
  authRuntime,
  env,
  equal,
  INVOICE_A,
  INVOICE_B,
  RUN_A,
  RUN_B,
  TICKET_A,
  TICKET_B,
  token,
  truth,
  user,
} from "./runtime.ts";
await import("../../../supabase/functions/admin-delete-work-order/index.ts");
await import(
  "../../../supabase/functions/admin-approve-maintenance-invoice/index.ts"
);
await import("../../../supabase/functions/terminate-work-order/index.ts");
const definitions = [
  {
    name: "archive",
    handler: handlers[0],
    body: { landlordId: ACCOUNT_A, workflowRunId: RUN_A } as Record<
      string,
      unknown
    >,
  },
  {
    name: "invoice",
    handler: handlers[1],
    body: {
      landlordId: ACCOUNT_A,
      invoiceId: INVOICE_A,
      action: "reject",
    } as Record<string, unknown>,
  },
  {
    name: "terminate",
    handler: handlers[2],
    body: {
      landlordId: ACCOUNT_A,
      ticketId: TICKET_A,
      mode: "archive",
      notifyVendor: false,
    } as Record<string, unknown>,
  },
];
const keys = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ADMIN_REASSIGN_SECRET",
];
async function run(
  index: number,
  options: {
    auth?: AuthOptions;
    headers?: Record<string, string>;
    body?: Record<string, unknown>;
    method?: string;
    mutate?: () => void;
  } = {},
) {
  reset();
  options.mutate?.();
  const before = JSON.stringify(state.rows);
  const previous = keys.map((k) => Deno.env.get(k));
  for (const k of keys) Deno.env.set(k, env(k)!);
  const original = globalThis.fetch;
  const auth = authRuntime(options.auth);
  globalThis.fetch = auth.runtime.fetch;
  const definition = definitions[index];
  const method = options.method ?? "POST";
  try {
    const response = await definition.handler(
      new Request("https://handler.invalid", {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(options.headers ?? { Authorization: "Bearer " + token() }),
        },
        body: method === "POST"
          ? JSON.stringify({ ...definition.body, ...options.body })
          : undefined,
      }),
    );
    const status = response.status;
    const body = await response.text();
    return {
      status,
      body,
      headers: response.headers,
      authCalls: auth.calls,
      before,
      after: JSON.stringify(state.rows),
    };
  } finally {
    globalThis.fetch = original;
    keys.forEach((k, i) =>
      previous[i] === undefined
        ? Deno.env.delete(k)
        : Deno.env.set(k, previous[i]!)
    );
  }
}
for (let i = 0; i < definitions.length; i++) {
  const d = definitions[i];
  for (
    const scenario of [
      {
        name: "public browser credential only",
        headers: { "x-admin-reassign-secret": "unit-public-browser-secret" },
        status: 401,
      },
      {
        name: "anonymous bearer plus public credential",
        headers: {
          Authorization: "Bearer unit-anon-key",
          "x-admin-reassign-secret": "unit-public-browser-secret",
        },
        status: 401,
      },
      {
        name: "foreign landlord despite public credential",
        headers: {
          Authorization: "Bearer " + token(),
          "x-admin-reassign-secret": "unit-public-browser-secret",
        },
        auth: { access: false },
        status: 403,
      },
      {
        name: "invalid session despite public credential",
        headers: {
          Authorization: "Bearer " + token(),
          "x-admin-reassign-secret": "unit-public-browser-secret",
        },
        auth: { authStatus: 401 },
        status: 401,
      },
    ]
  ) {
    Deno.test(
      "regression: " + d.name + " rejects " + scenario.name +
        " before resource access",
      async () => {
        const result = await run(i, {
          ...scenario,
          headers: "headers" in scenario
            ? scenario.headers as Record<string, string>
            : undefined,
        });
        equal(result.status, scenario.status);
        equal(state.clientCreations, 0);
        equal(state.reads, []);
        equal(state.writes, []);
        equal(state.business, []);
        equal(result.after, result.before);
      },
    );
  }
  for (
    const scenario of [
      {
        name: "banned former user",
        auth: { account: { ...user(), banned_until: "2099-01-01T00:00:00Z" } },
        status: 403,
      },
      { name: "removed membership", auth: { access: false }, status: 403 },
      { name: "authorization failure", auth: { rpcStatus: 500 }, status: 503 },
    ]
  ) {
    Deno.test("handler: " + d.name + " blocks " + scenario.name, async () => {
      const result = await run(i, {
        ...scenario,
        headers: "headers" in scenario
          ? scenario.headers as Record<string, string>
          : undefined,
      });
      equal(result.status, scenario.status);
      equal(state.reads, []);
      equal(state.writes, []);
      equal(state.business, []);
      equal(result.after, result.before);
    });
  }
  Deno.test(
    "handler: " + d.name +
      " own authorized positive control without shared credential",
    async () => {
      const result = await run(i);
      equal(result.status, 200);
      truth(state.writes.length + state.business.length > 0);
      equal(result.authCalls.at(-1)?.authorization, "Bearer " + token());
      for (const read of state.reads) {
        truth(
          read.filters.some(([k, v]) => k === "landlord_id" && v === ACCOUNT_A),
          "Resource reads must be account scoped",
        );
      }
    },
  );
  Deno.test(
    "handler: " + d.name + " accepts user header with anonymous gateway bearer",
    async () => {
      const result = await run(i, {
        headers: {
          Authorization: "Bearer unit-anon-key",
          "x-ulo-access-token": token(),
        },
      });
      equal(result.status, 200);
    },
  );
  Deno.test(
    "handler: " + d.name + " blocks a foreign resource with own landlordId",
    async () => {
      const body = i === 0
        ? { workflowRunId: RUN_B }
        : i === 1
        ? { invoiceId: INVOICE_B }
        : { ticketId: TICKET_B };
      const result = await run(i, { body });
      equal(result.status, 404);
      equal(state.writes, []);
      equal(state.business, []);
      equal(result.after, result.before);
    },
  );
  Deno.test(
    "handler: " + d.name + " preflight is side-effect free",
    async () => {
      const result = await run(i, { method: "OPTIONS", headers: {} });
      equal(result.status, 200);
      equal(result.authCalls, []);
      equal(state.clientCreations, 0);
    },
  );
  Deno.test(
    "handler: " + d.name + " rejects unsupported method without side effects",
    async () => {
      const result = await run(i, { method: "GET", headers: {} });
      equal(result.status, 405);
      equal(result.authCalls, []);
      equal(state.clientCreations, 0);
    },
  );
}
Deno.test("handler: invoice APPROVE checks account before invoking approval logic", async () => {
  const result = await run(1, { body: { action: "approve" } });
  equal(result.status, 200);
  equal(state.business.map((x) => x.name), ["approve"]);
});
Deno.test("handler: invoice linked to foreign job cannot approve or reject", async () => {
  for (const action of ["approve", "reject"]) {
    const result = await run(1, {
      body: { action },
      mutate: () => {
        state.rows.maintenance_invoices[0].maintenance_request_id = TICKET_B;
      },
    });
    equal(result.status, 404);
    equal(state.writes, []);
    equal(state.business, []);
    equal(result.after, result.before);
  }
});
Deno.test("handler: invoice rejection writes remain landlord scoped", async () => {
  const result = await run(1);
  equal(result.status, 200);
  equal(state.writes.length, 2);
  for (const w of state.writes) {
    truth(w.filters.some(([k, v]) => k === "landlord_id" && v === ACCOUNT_A));
  }
});
Deno.test("handler: archive cannot pass a foreign body ticket to termination", async () => {
  const result = await run(0, { body: { maintenanceRequestId: TICKET_B } });
  equal(result.status, 404);
  equal(state.writes, []);
  equal(state.business, []);
  equal(result.after, result.before);
});
Deno.test("handler: archive own linked job reaches existing business helper", async () => {
  const result = await run(0, { body: { maintenanceRequestId: TICKET_A } });
  equal(result.status, 200);
  equal(state.business.map((x) => x.name), ["terminate", "detach"]);
});
Deno.test("handler: foreign cleanup request cannot reach deletion branches", async () => {
  const result = await run(2, {
    body: {
      ticketId: TICKET_B,
      source: "cleanup",
      prepareForHardDelete: true,
      notifyVendor: false,
    },
  });
  equal(result.status, 404);
  equal(state.writes, []);
  equal(state.business, []);
  equal(result.after, result.before);
});
for (let i = 0; i < definitions.length; i++) {
  Deno.test(
    "handler: " + definitions[i].name + " database failure cannot reach writes",
    async () => {
      const result = await run(i, {
        mutate: () => {
          state.errorTable = i === 0
            ? "workflow_runs"
            : i === 1
            ? "maintenance_invoices"
            : "maintenance_requests";
        },
      });
      equal(result.status, 500);
      equal(state.writes, []);
      equal(state.business, []);
      equal(result.after, result.before);
    },
  );
}

for (let index = 0; index < definitions.length; index++) {
  Deno.test(
    definitions[index].name +
      " OPTIONS returns the shared explicit CORS headers",
    async () => {
      const result = await run(index, { method: "OPTIONS", headers: {} });
      equal(result.status, 200);
      const { adminEdgeCorsHeaders } = await import(
        "../../../supabase/functions/_shared/admin_edge_cors.ts"
      );
      for (const [name, value] of Object.entries(adminEdgeCorsHeaders)) {
        equal(result.headers.get(name), value);
      }
      equal(state.clientCreations, 0);
      equal(result.authCalls, []);
    },
  );
}
