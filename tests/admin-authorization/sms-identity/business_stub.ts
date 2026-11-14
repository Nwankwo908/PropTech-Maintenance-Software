import { state } from "./sdk_stub.ts";
export function findUnitRow(
  _db: unknown,
  params: { landlordId: string; unitLabel: string; building?: string | null },
) {
  const rows = (state.rows.units ?? []).filter((row) =>
    row.landlord_id === params.landlordId &&
    row.unit_label === params.unitLabel &&
    (!params.building || row.building === params.building)
  );
  return Promise.resolve(
    rows.length === 1 ? { ...rows[0], id: String(rows[0].id), building: rows[0].building } : null,
  );
}
function sync(_db: unknown, params: Record<string, unknown>) {
  state.business.push({ name: "sync", params });
  state.writes++;
  return Promise.resolve({
    id: "synthetic-identity",
    identity_type: params.vendorId ? "vendor" : "resident",
    phone_number: "+12025550123",
    resident_id: params.residentId ?? null,
    vendor_id: params.vendorId ?? null,
    unit_id: params.unitId ?? null,
  });
}
export const syncResidentSmsIdentity = sync;
export const syncVendorSmsIdentity = sync;
