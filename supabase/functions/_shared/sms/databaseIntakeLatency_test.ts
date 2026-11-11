import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import type { WorkflowContext } from "./workflow_types.ts";
import {
  loadIntakePropertyLayout,
  prepareIntakeAndLayout,
} from "./intakePropertyLayout.ts";
import { ensureEarlySmsMaintenanceTicket } from "./ensureEarlySmsTicket.ts";
import { processResidentMaintenanceIntake } from "./residentIntake.ts";
import { createSmsRequestTiming } from "./requestReadCache.ts";

function fakeDb(
  opts: {
    delay?: number;
    missingResident?: boolean;
    missingUnit?: boolean;
    rejectConversation?: boolean;
    unitProperty?: string;
    properties?: unknown[];
    home?: Record<string, unknown>;
    wrongTemplate?: boolean;
  } = {},
) {
  const calls: Array<
    {
      table: string;
      op: string;
      payload: Record<string, unknown> | null;
      filters: Record<string, unknown>;
    }
  > = [];
  let active = 0, maxActive = 0;
  const finished: string[] = [];
  const client = {
    rpc: async (name: string, args?: Record<string, unknown>) => {
      if (name === "claim_sms_intake_draft") {
        calls.push({
          table: "maintenance_requests",
          op: "insert",
          payload: (args?.p_ticket as Record<string, unknown> | undefined) ??
            null,
          filters: {},
        });
        return { data: { id: "draft", created: true }, error: null };
      }
      return { data: null, error: null };
    },
    from(table: string) {
      let op = "read", payload: Record<string, unknown> | null = null;
      const filters: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {};
      for (
        const name of [
          "select",
          "single",
          "maybeSingle",
          "limit",
          "neq",
          "is",
          "in",
          "or",
          "order",
          "lt",
          "gte",
          "not",
        ]
      ) chain[name] = () => chain;
      chain.eq = (key: string, value: unknown) => {
        filters[key] = value;
        return chain;
      };
      for (const name of ["insert", "update"]) {
        chain[name] = (v: Record<string, unknown>) => {
          op = name;
          payload = v;
          return chain;
        };
      }
      chain.then = (
        resolve: (v: unknown) => unknown,
        reject: (e: unknown) => unknown,
      ) => {
        calls.push({ table, op, payload, filters: { ...filters } });
        active++;
        maxActive = Math.max(active, maxActive);
        return new Promise((r) => setTimeout(r, opts.delay ?? 1)).then(() => {
          active--;
          finished.push(table);
          if (
            table === "sms_conversations" && op === "read" &&
            opts.rejectConversation
          ) throw Error("synthetic lookup failure");
          let data: unknown = { id: "audit" };
          if (table === "sms_conversations") {
            data = { workflow_run_id: "shared-run" };
          }
          if (table === "users") {
            data = opts.missingResident ? null : {
              id: "resident",
              full_name: "Test Resident",
              email: "test@example.invalid",
              phone: null,
              unit: opts.missingUnit ? null : "Test Home",
            };
          }
          if (table === "units") {
            data = { property_id: opts.unitProperty ?? "property" };
          }
          if (table === "properties") {
            data = opts.properties ?? [{ id: "property" }];
          }
          if (table === "home_data_graph") {
            data = opts.home ?? { bedrooms: 3, bathrooms: "2" };
          }
          if (table === "maintenance_requests") data = { id: "draft" };
          if (table === "workflow_runs") {
            data = {
              id: filters.id,
              template_id: opts.wrongTemplate
                ? "maintenance_request"
                : "maintenance_intake",
              entity_id: "existing-conversation",
              metadata: {},
            };
          }
          return { data, error: null };
        }).then(resolve, reject);
      };
      return chain;
    },
  } as unknown as SupabaseClient;
  return {
    client,
    calls,
    finished,
    get maxActive() {
      return maxActive;
    },
  };
}
const intake = {
  step: "photo" as const,
  initial_message:
    "The main bedroom closet door is off its track. Do not enter unless someone is home.",
  description: "Closet door off track",
  room_or_area: "main bedroom",
  issue_type: "general",
  vendor_trade: "carpentry",
  diagnostic_facts: { unit_entry: "No" },
};
const ctx = {
  identity: { unit_id: "unit" },
  landlordId: "owner",
} as WorkflowContext;
Deno.test("layout and classification start together, retain results and await both", async () => {
  let active = 0, max = 0;
  const step = async <T>(v: T) => {
    active++;
    max = Math.max(max, active);
    await new Promise((r) => setTimeout(r, 10));
    active--;
    return v;
  };
  const result = await prepareIntakeAndLayout(
    () => step({ state: intake }),
    () => step({ property_bedroom_count: 3 }),
  );
  assertEquals(max, 2);
  assertEquals(active, 0);
  assertEquals(result, {
    started: { state: intake },
    layoutCounts: { property_bedroom_count: 3 },
  });
});
Deno.test("layout/classification rejection waits for the other branch", async () => {
  for (const failLayout of [true, false]) {
    let complete = false;
    const delayed = async () => {
      await new Promise((r) => setTimeout(r, 10));
      complete = true;
      return {};
    };
    await assertRejects(() =>
      prepareIntakeAndLayout(
        failLayout ? delayed : () => Promise.reject(Error("synthetic")),
        failLayout ? () => Promise.reject(Error("synthetic")) : delayed,
      )
    );
    assert(complete);
  }
});
Deno.test("layout keeps unit resolution, counts and single-property fallback", async () => {
  const f = fakeDb();
  assertEquals(await loadIntakePropertyLayout(f.client, ctx), {
    property_bedroom_count: 3,
    property_bathroom_count: 2,
  });
  assertEquals(f.calls.map((c) => c.table), ["units", "home_data_graph"]);
  const g = fakeDb();
  assertEquals(
    await loadIntakePropertyLayout(g.client, {
      ...ctx,
      identity: { ...ctx.identity, unit_id: null },
    }),
    { property_bedroom_count: 3, property_bathroom_count: 2 },
  );
  assertEquals(g.calls.map((c) => c.table), ["properties", "home_data_graph"]);
});
Deno.test("layout does not guess among properties or invent missing counts", async () => {
  const f = fakeDb({ properties: [{ id: "a" }, { id: "b" }] });
  assertEquals(
    await loadIntakePropertyLayout(f.client, {
      ...ctx,
      identity: { ...ctx.identity, unit_id: null },
    }),
    {},
  );
  assertEquals(f.calls.length, 1);
  const g = fakeDb({ home: {} });
  assertEquals(await loadIntakePropertyLayout(g.client, ctx), {});
});
Deno.test("fallback conversation and resident reads overlap before any ticket write", async () => {
  const f = fakeDb({ delay: 10, missingUnit: true });
  const r = await ensureEarlySmsMaintenanceTicket(f.client, {
    landlordId: "owner",
    conversationId: "conv",
    residentId: "resident",
    intake,
  });
  assertEquals(r, { ticketId: null, created: false });
  assertEquals(f.maxActive, 2);
  assertEquals(f.calls.map((c) => c.table), ["sms_conversations", "users"]);
});
Deno.test("server-resolved run skips shared conversation read and retains own run", async () => {
  const f = fakeDb();
  const timing = createSmsRequestTiming("synthetic");
  const r = await ensureEarlySmsMaintenanceTicket(f.client, {
    landlordId: "owner",
    conversationId: "conv",
    residentId: "resident",
    intake,
    workflowRunId: "own-run",
    timing,
  });
  await new Promise((r) => setTimeout(r, 30));
  assertEquals(r, { ticketId: "draft", created: true });
  assertEquals(
    f.calls.filter((c) => c.table === "sms_conversations" && c.op === "read")
      .length,
    0,
  );
  assertEquals(
    f.calls.find((c) => c.table === "workflow_runs")?.filters.id,
    "own-run",
  );
  const writes = f.calls.filter((c) =>
    c.table === "maintenance_requests" && c.op === "insert"
  );
  assertEquals(writes.length, 1);
  assertEquals(writes[0].payload?.entry_ok_if_absent, false);
  assertEquals(writes[0].payload?.issue_category, "carpentry");
  assert(
    !f.calls.some((c) => c.table === "workflow_runs" && c.op === "update"),
  );
  const snapshot = timing.snapshot();
  for (
    const label of [
      "draft.lookup_resident",
      "draft.insert",
      "draft.link_conversation",
      "draft.link_run",
      "draft.audit",
    ]
  ) assertEquals(snapshot.stages[label].count, 1);
  assert(!JSON.stringify(snapshot).includes(intake.initial_message));
});
Deno.test("missing resident creates no ticket and waits for independent lookup", async () => {
  const f = fakeDb({ delay: 10, missingResident: true });
  assertEquals(
    await ensureEarlySmsMaintenanceTicket(f.client, {
      landlordId: "owner",
      conversationId: "conv",
      residentId: "resident",
      intake,
    }),
    { ticketId: null, created: false },
  );
  assertEquals(f.finished.length, 2);
  assert(f.calls.every((c) => c.op === "read"));
});
Deno.test("lookup transport failure waits for both reads and does not write", async () => {
  const f = fakeDb({ delay: 10, rejectConversation: true });
  await assertRejects(() =>
    ensureEarlySmsMaintenanceTicket(f.client, {
      landlordId: "owner",
      conversationId: "conv",
      residentId: "resident",
      intake,
    })
  );
  assertEquals(f.finished.length, 2);
  assert(f.calls.every((c) => c.op === "read"));
});
Deno.test("empty explicit run retains fallback and never retargets other workflow template", async () => {
  const f = fakeDb({ wrongTemplate: true });
  await ensureEarlySmsMaintenanceTicket(f.client, {
    landlordId: "owner",
    conversationId: "conv",
    residentId: "resident",
    intake,
    workflowRunId: "  ",
  });
  await new Promise((r) => setTimeout(r, 30));
  assertEquals(
    f.calls.filter((c) => c.table === "sms_conversations" && c.op === "read")
      .length,
    1,
  );
  assert(
    !f.calls.some((c) => c.table === "workflow_runs" && c.op === "update"),
  );
});
Deno.test("non-mintable intake performs no new reads", async () => {
  const f = fakeDb();
  assertEquals(
    await ensureEarlySmsMaintenanceTicket(f.client, {
      landlordId: "owner",
      conversationId: "conv",
      residentId: "resident",
      intake: { step: "submitted" },
    }),
    { ticketId: null, created: false },
  );
  assertEquals(f.calls, []);
});

Deno.test("fresh intake integrates parallel layout and server run without submission or contact", async () => {
  const key = Deno.env.get("OPENAI_API_KEY");
  Deno.env.delete("OPENAI_API_KEY");
  try {
    const f = fakeDb(), timing = createSmsRequestTiming("synthetic-fresh");
    const context = {
      ...ctx,
      timing,
      workflowRunId: "own-run",
      inbound: {
        from: "+12025550101",
        to: "+12025550100",
        body: intake.initial_message,
        mediaUrls: [],
        provider: "twilio",
      },
      identity: {
        ...ctx.identity,
        resident_id: "resident",
        identity_type: "resident",
      },
      conversationId: "conv",
      messageId: "message",
      maintenanceRequestId: null,
      selfHealed: false,
      continueIntake: false,
      resolutionSource: "identity",
      selfHealingPhase: "none",
      suggestedUnit: null,
    } as unknown as WorkflowContext;
    const r = await processResidentMaintenanceIntake(f.client, context);
    await new Promise((r) => setTimeout(r, 30));
    assertEquals(r.metadata.started, true);
    assert(r.replyHint);
    assertEquals(timing.snapshot().stages["intake.layout"].count, 1);
    assertEquals(
      f.calls.filter((c) =>
        c.table === "maintenance_requests" && c.op === "insert"
      ).length,
      1,
    );
    assertEquals(
      f.calls.find((c) =>
        c.table === "maintenance_requests" && c.op === "insert"
      )?.payload?.entry_ok_if_absent,
      false,
    );
    assert(
      !f.calls.some((c) => c.table === "sms_messages" && c.op === "insert"),
    );
    assert(
      !f.calls.some((c) =>
        c.table === "maintenance_requests" && c.payload?.assigned_vendor_id
      ),
    );
  } finally {
    if (key !== undefined) Deno.env.set("OPENAI_API_KEY", key);
  }
});

Deno.test("SMS atomic finalization skips context reload and updates the post-action audit scope", async()=>{
 const key=Deno.env.get("OPENAI_API_KEY");Deno.env.delete("OPENAI_API_KEY");
 try{
  const {maintenanceIntakeTemplate}=await import("../engine/templates/maintenance.ts");
  const f=fakeDb(),timing=createSmsRequestTiming("atomic-wiring");const rpcCalls:string[]=[];
  (f.client as any).rpc=async(name:string,args:any)=>{rpcCalls.push(name);return name==="finalize_sms_intake_run"?{data:{id:args.p_run_id,landlord_id:args.p_landlord_id,template_id:"maintenance_intake",status:"active",entity_type:"maintenance_request",entity_id:args.p_ticket_id,current_step:"photo",metadata:{kept:true,intake_state:{draft_ticket_id:"draft",diagnostic_facts:{unit_entry:"No"}}}},error:null}:{data:null,error:null}};
  const sms={...ctx,timing,atomicWorkflowWrites:true,inbound:{from:"+12025550101",to:"+12025550100",body:intake.initial_message,mediaUrls:[],provider:"twilio"},identity:{...ctx.identity,resident_id:"resident",identity_type:"resident"},conversationId:"conv",messageId:"message",maintenanceRequestId:null,selfHealed:false,continueIntake:false,resolutionSource:"existing_identity",selfHealingPhase:"none",suggestedUnit:null};
  const execution:any={landlordId:"owner",trigger:"sms_inbound",runId:"own-run",sms};
  const result=await maintenanceIntakeTemplate.act(f.client,execution,{templateId:"maintenance_intake",runId:"own-run",confidence:"high",reason:"existing_workflow_run"});
  await new Promise(r=>setTimeout(r,30));assertEquals(result.metadata.draft_ticket_id,"draft");assert(rpcCalls.includes("finalize_sms_intake_run"));assertEquals(sms.maintenanceRequestId,"draft");assertEquals(execution.activeRun.entity_id,"draft");
  assertEquals(timing.snapshot().stages["intake.run_context"],undefined);assertEquals(timing.snapshot().stages["intake.run_finalize"].count,1);
  assertEquals(timing.snapshot().stages["draft.link_run"],undefined);
  assert(!f.calls.some(c=>c.table==="workflow_runs"));
 }finally{if(key!==undefined)Deno.env.set("OPENAI_API_KEY",key)}
});
Deno.test("atomic finalization failure cannot fall through to legacy conversation/run rewrites",async()=>{
 let attempts=0;const f={rpc:async()=>{attempts++;return {data:null,error:{code:"synthetic_failure"}}},from(){throw Error("Legacy replay forbidden")}} as never;
 const {finalizeSmsIntakeRun}=await import("../engine/workflowRuns.ts");await assertRejects(()=>finalizeSmsIntakeRun(f,{landlordId:"owner",conversationId:"conv",runId:"run",ticketId:"draft"}));assertEquals(attempts,1);
});

Deno.test("fresh engine finalization can own the early run link without redundant reads or update", async () => {
  const f=fakeDb();const timing=createSmsRequestTiming("synthetic")
  const r=await ensureEarlySmsMaintenanceTicket(f.client,{landlordId:"owner",conversationId:"conv",residentId:"resident",intake,workflowRunId:"own-run",timing,deferRunLinkToFinalizer:true})
  await new Promise(r=>setTimeout(r,30))
  assertEquals(r,{ticketId:"draft",created:true})
  assert(!f.calls.some(c=>c.table==="workflow_runs"))
  assertEquals(f.calls.filter(c=>c.table==="sms_conversations"&&c.op==="update").length,1)
  assertEquals(f.calls.find(c=>c.table==="maintenance_requests"&&c.op==="insert")?.payload?.entry_ok_if_absent,false)
  assertEquals(timing.snapshot().stages["draft.link_run"],undefined)
})
Deno.test("deferring without a server-resolved run does not skip legacy link validation", async()=>{
  const f=fakeDb();await ensureEarlySmsMaintenanceTicket(f.client,{landlordId:"owner",conversationId:"conv",residentId:"resident",intake,deferRunLinkToFinalizer:true})
  await new Promise(r=>setTimeout(r,30))
  assert(f.calls.some(c=>c.table==="workflow_runs"&&c.filters.id==="shared-run"))
})
