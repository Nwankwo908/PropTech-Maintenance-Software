/**
 * In-memory stand-in for the Supabase client, for the SMS sandbox.
 *
 * It implements the subset of the PostgREST query builder the inbound SMS
 * pipeline uses (select/insert/update/upsert/delete, the common filters,
 * order/limit, single/maybeSingle, rpc). Unknown tables are empty. Nothing
 * here touches the network or a real database.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"

export type Row = Record<string, unknown>
export type Tables = Record<string, Row[]>
export type RpcHandler = (args: Record<string, unknown>, db: FakeDb) => unknown

export type FakeDbOp = {
  table: string
  op: "select" | "insert" | "update" | "upsert" | "delete" | "rpc"
  rows: number
}

type Filter = (row: Row) => boolean

type Result = {
  data: unknown
  error: { message: string; code?: string } | null
  count?: number | null
  status: number
}

let idCounter = 0
function nextId(): string {
  idCounter += 1
  const hex = idCounter.toString(16).padStart(12, "0")
  return `00000000-0000-4000-8000-${hex}`
}

function readPath(row: Row, column: string): unknown {
  // Supports `col`, `col->key`, `col->>key` (one or more hops).
  const parts = column.split(/->>?/)
  let value: unknown = row[parts[0].trim()]
  for (const key of parts.slice(1)) {
    if (value == null || typeof value !== "object") return undefined
    value = (value as Record<string, unknown>)[key.trim()]
  }
  if (column.includes("->>") && value != null && typeof value !== "string") {
    return typeof value === "object" ? JSON.stringify(value) : String(value)
  }
  return value
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  if (typeof a === "boolean" || typeof b === "boolean") {
    return String(a) === String(b)
  }
  return String(a) === String(b)
}

function compare(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0
  if (a == null) return -1
  if (b == null) return 1
  if (typeof a === "number" && typeof b === "number") return a - b
  const na = Number(a)
  const nb = Number(b)
  if (
    typeof a !== "string" || typeof b !== "string" ||
    (!Number.isNaN(na) && !Number.isNaN(nb) && String(na) === a && String(nb) === b)
  ) {
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb
  }
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0
}

function likeToRegExp(pattern: string, insensitive: boolean): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/%/g, ".*")
    .replace(/_/g, ".")
  return new RegExp(`^${escaped}$`, insensitive ? "is" : "s")
}

function parseListValue(raw: string): string[] {
  const inner = raw.replace(/^\(/, "").replace(/\)$/, "")
  return inner.split(",").map((v) => v.trim().replace(/^"|"$/g, ""))
}

function contains(container: unknown, subset: unknown): boolean {
  if (Array.isArray(subset)) {
    if (!Array.isArray(container)) return false
    return subset.every((item) => container.some((c) => same(c, item) || contains(c, item)))
  }
  if (subset && typeof subset === "object") {
    if (!container || typeof container !== "object") return false
    return Object.entries(subset as Row).every(([k, v]) =>
      contains((container as Row)[k], v)
    )
  }
  return same(container, subset)
}

function opFilter(column: string, op: string, value: unknown): Filter {
  switch (op) {
    case "eq":
      return (r) => same(readPath(r, column), value)
    case "neq":
      return (r) => !same(readPath(r, column), value)
    case "gt":
      return (r) => readPath(r, column) != null && compare(readPath(r, column), value) > 0
    case "gte":
      return (r) => readPath(r, column) != null && compare(readPath(r, column), value) >= 0
    case "lt":
      return (r) => readPath(r, column) != null && compare(readPath(r, column), value) < 0
    case "lte":
      return (r) => readPath(r, column) != null && compare(readPath(r, column), value) <= 0
    case "like":
      return (r) => likeToRegExp(String(value), false).test(String(readPath(r, column) ?? ""))
    case "ilike":
      return (r) => likeToRegExp(String(value), true).test(String(readPath(r, column) ?? ""))
    case "is": {
      const v = value === "null" ? null : value === "true" ? true : value === "false" ? false : value
      return (r) => {
        const cell = readPath(r, column)
        return v === null ? cell == null : same(cell, v)
      }
    }
    case "in": {
      const list = Array.isArray(value) ? value : parseListValue(String(value))
      return (r) => list.some((v) => same(readPath(r, column), v))
    }
    case "cs":
    case "contains": {
      let parsed = value
      if (typeof value === "string") {
        try {
          parsed = JSON.parse(value)
        } catch {
          parsed = parseListValue(value.replace(/^\{/, "(").replace(/\}$/, ")"))
        }
      }
      return (r) => contains(readPath(r, column), parsed)
    }
    default:
      // Unsupported operator: do not filter rows out silently in a way that
      // hides data; treat as a match and let the caller's logic decide.
      return () => true
  }
}

/** Parse a PostgREST `or=(...)` expression: `a.eq.1,b.is.null,and(c.eq.2,d.eq.3)`. */
function parseOr(expr: string): Filter {
  const parts: string[] = []
  let depth = 0
  let current = ""
  for (const ch of expr) {
    if (ch === "(") depth += 1
    if (ch === ")") depth -= 1
    if (ch === "," && depth === 0) {
      parts.push(current)
      current = ""
      continue
    }
    current += ch
  }
  if (current) parts.push(current)
  const filters = parts.map((part) => parseCondition(part.trim()))
  return (r) => filters.some((f) => f(r))
}

function parseCondition(part: string): Filter {
  const andMatch = /^and\((.*)\)$/.exec(part)
  if (andMatch) {
    const inner = parseOr(andMatch[1])
    // parseOr splits on commas; reuse its splitter but require all.
    const pieces: Filter[] = []
    let depth = 0
    let current = ""
    for (const ch of andMatch[1]) {
      if (ch === "(") depth += 1
      if (ch === ")") depth -= 1
      if (ch === "," && depth === 0) {
        pieces.push(parseCondition(current.trim()))
        current = ""
        continue
      }
      current += ch
    }
    if (current) pieces.push(parseCondition(current.trim()))
    void inner
    return (r) => pieces.every((f) => f(r))
  }
  const orMatch = /^or\((.*)\)$/.exec(part)
  if (orMatch) return parseOr(orMatch[1])
  const m = /^([^.]+)\.(not\.)?([a-z]+)\.(.*)$/s.exec(part)
  if (!m) return () => true
  const [, column, negate, op, value] = m
  const base = opFilter(column, op, value)
  return negate ? (r) => !base(r) : base
}

class QueryBuilder implements PromiseLike<Result> {
  private filters: Filter[] = []
  private orders: Array<{ column: string; ascending: boolean; nullsFirst: boolean }> = []
  private limitCount: number | null = null
  private rangeFrom: number | null = null
  private rangeTo: number | null = null
  private mode: "select" | "insert" | "update" | "upsert" | "delete" = "select"
  private payload: Row[] = []
  private patch: Row = {}
  private onConflict: string[] = ["id"]
  private ignoreDuplicates = false
  private returning = false
  private singleMode: "none" | "single" | "maybe" = "none"
  private countMode: string | null = null
  private headOnly = false

  constructor(private db: FakeDb, private table: string) {}

  select(_columns?: string, opts?: { count?: string; head?: boolean }): this {
    if (this.mode !== "select") this.returning = true
    if (opts?.count) this.countMode = opts.count
    if (opts?.head) this.headOnly = true
    return this
  }

  insert(values: Row | Row[]): this {
    this.mode = "insert"
    this.payload = Array.isArray(values) ? values : [values]
    return this
  }

  upsert(
    values: Row | Row[],
    opts?: { onConflict?: string; ignoreDuplicates?: boolean },
  ): this {
    this.mode = "upsert"
    this.payload = Array.isArray(values) ? values : [values]
    if (opts?.onConflict) {
      this.onConflict = opts.onConflict.split(",").map((c) => c.trim())
    }
    this.ignoreDuplicates = opts?.ignoreDuplicates === true
    return this
  }

  update(values: Row): this {
    this.mode = "update"
    this.patch = values
    return this
  }

  delete(): this {
    this.mode = "delete"
    return this
  }

  private add(f: Filter): this {
    this.filters.push(f)
    return this
  }

  eq(c: string, v: unknown) { return this.add(opFilter(c, "eq", v)) }
  neq(c: string, v: unknown) { return this.add(opFilter(c, "neq", v)) }
  gt(c: string, v: unknown) { return this.add(opFilter(c, "gt", v)) }
  gte(c: string, v: unknown) { return this.add(opFilter(c, "gte", v)) }
  lt(c: string, v: unknown) { return this.add(opFilter(c, "lt", v)) }
  lte(c: string, v: unknown) { return this.add(opFilter(c, "lte", v)) }
  like(c: string, v: string) { return this.add(opFilter(c, "like", v)) }
  ilike(c: string, v: string) { return this.add(opFilter(c, "ilike", v)) }
  is(c: string, v: unknown) { return this.add(opFilter(c, "is", v === null ? "null" : v)) }
  in(c: string, v: unknown[]) { return this.add(opFilter(c, "in", v)) }
  contains(c: string, v: unknown) { return this.add(opFilter(c, "contains", v)) }
  match(obj: Row) {
    for (const [k, v] of Object.entries(obj)) this.add(opFilter(k, "eq", v))
    return this
  }
  not(c: string, op: string, v: unknown) {
    const base = opFilter(c, op, op === "is" && v === null ? "null" : v)
    return this.add((r) => !base(r))
  }
  filter(c: string, op: string, v: unknown) { return this.add(opFilter(c, op, v)) }
  or(expr: string) { return this.add(parseOr(expr)) }
  textSearch() { return this }
  abortSignal() { return this }

  order(column: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
    const ascending = opts?.ascending !== false
    this.orders.push({
      column,
      ascending,
      nullsFirst: opts?.nullsFirst ?? !ascending,
    })
    return this
  }

  limit(n: number) {
    this.limitCount = n
    return this
  }

  range(from: number, to: number) {
    this.rangeFrom = from
    this.rangeTo = to
    return this
  }

  single() {
    this.singleMode = "single"
    return this
  }

  maybeSingle() {
    this.singleMode = "maybe"
    return this
  }

  then<T1 = Result, T2 = never>(
    onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve()
      .then(() => this.execute())
      .then(onfulfilled, onrejected)
  }

  private matching(): Row[] {
    const rows = this.db.rows(this.table)
    return rows.filter((r) => this.filters.every((f) => f(r)))
  }

  private shape(rows: Row[]): Result {
    let out = [...rows]
    for (const o of [...this.orders].reverse()) {
      out.sort((a, b) => {
        const va = readPath(a, o.column)
        const vb = readPath(b, o.column)
        if (va == null && vb == null) return 0
        if (va == null) return o.nullsFirst ? -1 : 1
        if (vb == null) return o.nullsFirst ? 1 : -1
        const c = compare(va, vb)
        return o.ascending ? c : -c
      })
    }
    const total = out.length
    if (this.rangeFrom != null && this.rangeTo != null) {
      out = out.slice(this.rangeFrom, this.rangeTo + 1)
    }
    if (this.limitCount != null) out = out.slice(0, this.limitCount)
    const copies = out.map((r) => structuredClone(r))
    const count = this.countMode ? total : null
    if (this.headOnly) return { data: null, error: null, count, status: 200 }
    if (this.singleMode === "single") {
      if (copies.length !== 1) {
        return {
          data: null,
          error: {
            message: `JSON object requested, multiple (or no) rows returned (${copies.length})`,
            code: "PGRST116",
          },
          count,
          status: 406,
        }
      }
      return { data: copies[0], error: null, count, status: 200 }
    }
    if (this.singleMode === "maybe") {
      if (copies.length > 1) {
        return {
          data: null,
          error: {
            message: "JSON object requested, multiple rows returned",
            code: "PGRST116",
          },
          count,
          status: 406,
        }
      }
      return { data: copies[0] ?? null, error: null, count, status: 200 }
    }
    return { data: copies, error: null, count, status: 200 }
  }

  private execute(): Result {
    const now = this.db.now()
    switch (this.mode) {
      case "select": {
        if (this.db.readFailures.has(this.table)) return { data: null, error: { message: "sandbox lookup failure" }, status: 503 }
        const rows = this.matching()
        this.db.log({ table: this.table, op: "select", rows: rows.length })
        return this.shape(rows)
      }
      case "insert": {
        const table = this.db.rows(this.table)
        const inserted: Row[] = []
        for (const value of this.payload) {
          const row: Row = {
            id: nextId(),
            created_at: now,
            updated_at: now,
            ...value,
          }
          const conflict = this.db.uniqueConflict(this.table, row)
          if (conflict) {
            this.db.log({ table: this.table, op: "insert", rows: 0 })
            return {
              data: null,
              error: { message: `duplicate key value violates unique constraint (${conflict})`, code: "23505" },
              status: 409,
            }
          }
          table.push(row)
          inserted.push(row)
        }
        this.db.log({ table: this.table, op: "insert", rows: inserted.length })
        if (!this.returning) return { data: null, error: null, status: 201 }
        return this.shape(inserted)
      }
      case "upsert": {
        const table = this.db.rows(this.table)
        const touched: Row[] = []
        for (const value of this.payload) {
          const existing = table.find((r) =>
            this.onConflict.every((c) => value[c] !== undefined && same(r[c], value[c]))
          )
          if (existing) {
            if (!this.ignoreDuplicates) {
              Object.assign(existing, value, { updated_at: now })
            }
            touched.push(existing)
          } else {
            const row: Row = { id: nextId(), created_at: now, updated_at: now, ...value }
            table.push(row)
            touched.push(row)
          }
        }
        this.db.log({ table: this.table, op: "upsert", rows: touched.length })
        if (!this.returning) return { data: null, error: null, status: 201 }
        return this.shape(touched)
      }
      case "update": {
        const rows = this.matching()
        for (const row of rows) Object.assign(row, this.patch)
        this.db.log({ table: this.table, op: "update", rows: rows.length })
        if (!this.returning) return { data: null, error: null, status: 204 }
        return this.shape(rows)
      }
      case "delete": {
        const rows = this.matching()
        const table = this.db.rows(this.table)
        for (const row of rows) table.splice(table.indexOf(row), 1)
        this.db.log({ table: this.table, op: "delete", rows: rows.length })
        if (!this.returning) return { data: null, error: null, status: 204 }
        return this.shape(rows)
      }
    }
  }
}

export class FakeDb {
  readonly tables: Tables
  readonly ops: FakeDbOp[] = []
  readonly readFailures = new Set<string>()
  private clock: () => string

  constructor(
    seed: Tables = {},
    private rpcHandlers: Record<string, RpcHandler> = {},
    private uniqueKeys: Record<string, string[][]> = {},
    clock?: () => string,
  ) {
    this.tables = structuredClone(seed)
    this.clock = clock ?? (() => new Date().toISOString())
  }

  now(): string {
    return this.clock()
  }

  rows(table: string): Row[] {
    if (!this.tables[table]) this.tables[table] = []
    return this.tables[table]
  }

  log(op: FakeDbOp) {
    this.ops.push(op)
  }

  uniqueConflict(table: string, row: Row): string | null {
    for (const cols of this.uniqueKeys[table] ?? []) {
      if (cols.some((c) => row[c] == null)) continue
      const clash = this.rows(table).some((r) => cols.every((c) => same(r[c], row[c])))
      if (clash) return `${table}(${cols.join(",")})`
    }
    return null
  }

  from(table: string): QueryBuilder {
    return new QueryBuilder(this, table)
  }

  async rpc(name: string, args: Record<string, unknown> = {}): Promise<Result> {
    this.log({ table: name, op: "rpc", rows: 0 })
    const handler = this.rpcHandlers[name]
    if (!handler) return { data: null, error: null, status: 200 }
    try {
      return { data: await handler(args, this), error: null, status: 200 }
    } catch (e) {
      return { data: null, error: { message: e instanceof Error ? e.message : String(e) }, status: 400 }
    }
  }

  /** The object handed to production code as a SupabaseClient. */
  client(): SupabaseClient {
    const storageBucket = {
      upload: () => Promise.resolve({ data: { path: "sim" }, error: null }),
      download: () => Promise.resolve({ data: null, error: { message: "sim: no storage" } }),
      createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://sim.invalid/file" }, error: null }),
      getPublicUrl: () => ({ data: { publicUrl: "https://sim.invalid/file" } }),
      remove: () => Promise.resolve({ data: [], error: null }),
      list: () => Promise.resolve({ data: [], error: null }),
    }
    const client = {
      from: (table: string) => this.from(table),
      rpc: (name: string, args?: Record<string, unknown>) => this.rpc(name, args ?? {}),
      storage: { from: () => storageBucket },
      functions: {
        invoke: () => Promise.resolve({ data: null, error: null }),
      },
      auth: {
        getUser: () => Promise.resolve({ data: { user: null }, error: null }),
        admin: {
          getUserById: () => Promise.resolve({ data: { user: null }, error: null }),
        },
      },
      channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
      removeChannel: () => Promise.resolve("ok"),
    }
    return client as unknown as SupabaseClient
  }
}
