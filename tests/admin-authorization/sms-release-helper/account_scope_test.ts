import { releaseLandlordMainNumber } from "../../../supabase/functions/_shared/sms/smsNumberPool.ts";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
for (const rowAccount of [B, null]) {
  Deno.test(`actual release helper refuses mismatched/unbound number before effects ${rowAccount}`, async () => {
    let effects = 0;
    const query = {
      select() {
        return this;
      },
      eq() {
        return this;
      },
      maybeSingle() {
        return Promise.resolve({
          data: {
            id: "synthetic-number",
            landlord_id: rowAccount,
            status: "active",
            purpose: "landlord_main",
          },
          error: null,
        });
      },
      update() {
        effects++;
        throw Error("Unexpected mutation");
      },
      delete() {
        effects++;
        throw Error("Unexpected mutation");
      },
    };
    const db = {
      from(table: string) {
        if (table !== "sms_numbers") {
          effects++;
          throw Error("Unexpected table");
        }
        return query;
      },
    };
    let denied = false;
    try {
      await releaseLandlordMainNumber(
        db as unknown as Parameters<typeof releaseLandlordMainNumber>[0],
        { landlordId: A, smsNumberId: "synthetic-number" },
      );
    } catch (e) {
      denied = e instanceof Error && e.message === "SMS number not found";
    }
    if (!denied || effects !== 0) {
      throw Error("Account mismatch reached release effects");
    }
  });
}
Deno.test("actual release helper preserves an own-account pending release without effects", async () => {
  const query = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    maybeSingle() {
      return Promise.resolve({
        data: {
          id: "synthetic-number",
          landlord_id: A,
          phone_number: "+12025550123",
          status: "released_pending",
          purpose: "landlord_main",
        },
        error: null,
      });
    },
  };
  const db = {
    from(table: string) {
      if (table !== "sms_numbers") throw Error("Unexpected effect");
      return query;
    },
  };
  const result = await releaseLandlordMainNumber(
    db as unknown as Parameters<typeof releaseLandlordMainNumber>[0],
    { landlordId: A, smsNumberId: "synthetic-number" },
  );
  if (
    result.status !== "released_pending" || result.providerReleased ||
    result.returnedToPool
  ) throw Error("Pending release changed unexpectedly");
});
