import {
  ACCOUNT_A,
  ACCOUNT_B,
  INVOICE_A,
  INVOICE_B,
  RUN_A,
  RUN_B,
  TICKET_A,
  TICKET_B,
} from "./runtime.ts";
type Row = Record<string, unknown>;
type Result = { data: Row | null; error: { message: string } | null };
export const state = {
  clientCreations: 0,
  reads: [] as Array<{ table: string; filters: Array<[string, unknown]> }>,
  writes: [] as Array<{ table: string; filters: Array<[string, unknown]> }>,
  business: [] as Array<{ name: string; params: Record<string, unknown> }>,
  errorTable: "",
  rows: {} as Record<string, Row[]>,
};
export function reset() {
  state.clientCreations = 0;
  state.reads = [];
  state.writes = [];
  state.business = [];
  state.errorTable = "";
  state.rows = {
    workflow_runs: [
      {
        id: RUN_A,
        landlord_id: ACCOUNT_A,
        template_id: "maintenance_request",
        entity_type: null,
        entity_id: null,
        metadata: {},
        status: "completed",
      },
      {
        id: RUN_B,
        landlord_id: ACCOUNT_B,
        template_id: "maintenance_request",
        entity_type: null,
        entity_id: null,
        metadata: {},
        status: "completed",
      },
    ],
    maintenance_requests: [{ id: TICKET_A, landlord_id: ACCOUNT_A }, {
      id: TICKET_B,
      landlord_id: ACCOUNT_B,
    }],
    maintenance_invoices: [
      {
        id: INVOICE_A,
        landlord_id: ACCOUNT_A,
        maintenance_request_id: TICKET_A,
        status: "submitted",
        metadata: {},
      },
      {
        id: INVOICE_B,
        landlord_id: ACCOUNT_B,
        maintenance_request_id: TICKET_B,
        status: "submitted",
        metadata: {},
      },
    ],
  };
}
class Query implements PromiseLike<Result> {
  filters: Array<[string, unknown]> = [];
  operation = "select";
  values: Row = {};
  constructor(readonly table: string) {}
  select(_columns?: string) {
    return this;
  }
  eq(key: string, value: unknown) {
    this.filters.push([key, value]);
    return this;
  }
  update(values: Row) {
    this.operation = "update";
    this.values = values;
    return this;
  }
  delete() {
    this.operation = "delete";
    return this;
  }
  private result(): Result {
    const rows = (state.rows[this.table] ?? []).filter((row) =>
      this.filters.every(([k, v]) => row[k] === v)
    );
    if (this.operation === "select") {
      state.reads.push({ table: this.table, filters: [...this.filters] });
    }
    if (state.errorTable === this.table) {
      return { data: null, error: { message: "Synthetic database error" } };
    }
    if (this.operation !== "select") {
      state.writes.push({ table: this.table, filters: [...this.filters] });
      for (const row of rows) Object.assign(row, this.values);
    }
    return { data: rows[0] ?? null, error: null };
  }
  async maybeSingle() {
    return this.result();
  }
  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.result()).then(onfulfilled, onrejected);
  }
}
export function createClient(_url: string, _key: string, _options?: unknown) {
  state.clientCreations++;
  return { from: (table: string) => new Query(table) };
}
