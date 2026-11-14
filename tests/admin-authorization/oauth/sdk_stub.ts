export const db = {
  rows: [] as Record<string, unknown>[],
  connections: [] as string[],
  writes: 0,
  error: false,
};
// deno-lint-ignore no-explicit-any
export type SupabaseClient = any;
class Query {
  filters: Array<[string, unknown]> = [];
  op = "read";
  constructor(public table: string) {}
  select(_columns?: string) {
    return this;
  }
  eq(k: string, v: unknown) {
    this.filters.push([k, v]);
    return this;
  }
  gt(k: string, v: unknown) {
    this.filters.push(["gt:" + k, v]);
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  insert(v: Record<string, unknown>) {
    db.rows.push(v);
    db.writes++;
    return this;
  }
  async maybeSingle() {
    return this.result();
  }
  result() {
    if (db.error) return { data: null, error: { message: "synthetic" } };
    if (this.table === "landlord_thumbtack_oauth") {
      return {
        data: db.connections.includes(String(this.filters[0]?.[1]))
          ? { landlord_id: this.filters[0][1], refresh_token: "synthetic-existing" }
          : null,
        error: null,
      };
    }
    const i = db.rows.findIndex((r) =>
      this.filters.every(([k, v]) =>
        k.startsWith("gt:") ? String(r[k.slice(3)]) > String(v) : r[k] === v
      )
    );
    const row = i < 0 ? null : db.rows[i];
    if (row && this.op === "delete") {
      db.rows.splice(i, 1);
      db.writes++;
    }
    return { data: row, error: null };
  }
  then(resolve: (x: ReturnType<Query["result"]>) => unknown) {
    return Promise.resolve(this.result()).then(resolve);
  }
}
export function createClient(_url: string, _key: string) {
  return { from: (t: string) => new Query(t) };
}
