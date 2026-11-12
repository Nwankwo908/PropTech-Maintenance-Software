import {
  ACCOUNT_A,
  ACCOUNT_B,
  RUN_A,
  RUN_B,
  TICKET_A,
  TICKET_B,
} from "./runtime.ts";
export const VENDOR_A = "77777777-7777-4777-8777-777777777777",
  VENDOR_B = "88888888-8888-4888-8888-888888888888";
export const REPORT_A = "99999999-9999-4999-8999-999999999999",
  REPORT_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
type Row = Record<string, unknown>;
type ErrorValue = { message: string } | null;
export const state = {
  clients: 0,
  reads: [] as Array<{ table: string; filters: Array<[string, unknown]> }>,
  business: [] as Array<{ name: string; params: unknown }>,
  writes: 0,
  errorTable: "",
  rows: {} as Record<string, Row[]>,
};
export function reset() {
  state.clients = 0;
  state.reads = [];
  state.business = [];
  state.writes = 0;
  state.errorTable = "";
  state.rows = {
    maintenance_requests: [{
      id: TICKET_A,
      landlord_id: ACCOUNT_A,
      assigned_vendor_id: VENDOR_A,
      vendor_work_status: "unassigned",
    }, {
      id: TICKET_B,
      landlord_id: ACCOUNT_B,
      assigned_vendor_id: VENDOR_B,
      vendor_work_status: "unassigned",
    }],
    vendors: [{
      id: VENDOR_A,
      landlord_id: ACCOUNT_A,
      active: true,
      name: "QA A",
    }, { id: VENDOR_B, landlord_id: ACCOUNT_B, active: true, name: "QA B" }],
    workflow_runs: [{ id: RUN_A, landlord_id: ACCOUNT_A }, {
      id: RUN_B,
      landlord_id: ACCOUNT_B,
    }],
    inspection_reports: [{ id: REPORT_A, landlord_id: ACCOUNT_A }, {
      id: REPORT_B,
      landlord_id: ACCOUNT_B,
    }],
    broadcast_notification_log: [true, false].map((success) => ({
      landlord_id: ACCOUNT_A,
      success,
      created_at: new Date().toISOString(),
    })).concat(
      [true, true, true, false].map((success) => ({
        landlord_id: ACCOUNT_B,
        success,
        created_at: new Date().toISOString(),
      })),
    ),
  };
}
class Query implements
  PromiseLike<
    { data: Row[] | null; error: ErrorValue; count: number | null }
  > {
  filters: Array<[string, unknown]> = [];
  constructor(readonly table: string) {}
  select(_c?: string, _options?: unknown) {
    return this;
  }
  eq(k: string, v: unknown) {
    this.filters.push([k, v]);
    return this;
  }
  gte(_k: string, _v: unknown) {
    return this;
  }
  ilike(_k: string, _v: unknown) {
    return this;
  }
  limit(_n: number) {
    return this;
  }
  order(_k: string, _v?: unknown) {
    return this;
  }
  insert(_v: unknown) {
    state.writes++;
    return this;
  }
  update(_v: unknown) {
    state.writes++;
    return this;
  }
  is(k: string, v: unknown) {
    return this.eq(k, v);
  }
  private result() {
    state.reads.push({ table: this.table, filters: [...this.filters] });
    const error = state.errorTable === this.table
      ? { message: "Synthetic failure" }
      : null;
    const rows = (state.rows[this.table] ?? []).filter((r) =>
      this.filters.every(([k, v]) => r[k] === v)
    );
    return {
      data: error ? null : rows,
      error,
      count: error ? null : rows.length,
    };
  }
  async maybeSingle() {
    const r = this.result();
    return { data: r.data?.[0] ?? null, error: r.error };
  }
  async single() {
    return this.maybeSingle();
  }
  then<
    T = { data: Row[] | null; error: ErrorValue; count: number | null },
    E = never,
  >(
    resolve?:
      | ((
        r: { data: Row[] | null; error: ErrorValue; count: number | null },
      ) => T | PromiseLike<T>)
      | null,
    reject?: ((r: unknown) => E | PromiseLike<E>) | null,
  ): PromiseLike<T | E> {
    return Promise.resolve(this.result()).then(resolve, reject);
  }
}
export function createClient(_u: string, _k: string, _opts?: unknown) {
  state.clients++;
  return { from: (t: string) => new Query(t) };
}
