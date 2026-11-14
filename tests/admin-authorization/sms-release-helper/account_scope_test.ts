import { releaseLandlordMainNumber } from "../../../supabase/functions/_shared/sms/smsNumberPool.ts";
for (
  const number of [
    { name: "shared Ulo number", id: "+18775803356" },
    { name: "formatted shared number", id: "(877) 580-3356" },
    { name: "retired platform number", id: "+19734005760" },
    { name: "unknown platform-number row", id: "synthetic-platform-id" },
    { name: "legacy dedicated-number row", id: "synthetic-legacy-id" },
    { name: "pool-number row", id: "synthetic-pool-id" },
  ]
) {
  for (const completeRelease of [false, true]) {
    Deno.test(`retired actual helper refuses ${number.name}, complete=${completeRelease} before any lookup`, async () => {
      let effects = 0;
      const db = {
        from() {
          effects++;
          throw Error("Retired helper must not access the database");
        },
      };
      let refused = false;
      try {
        await releaseLandlordMainNumber(
          db as unknown as Parameters<typeof releaseLandlordMainNumber>[0],
          {
            landlordId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            smsNumberId: number.id,
            completeRelease,
          },
        );
      } catch (e) {
        refused = e instanceof Error &&
          e.message ===
            "SMS number release is retired; platform numbers cannot be released";
      }
      if (!refused || effects !== 0) {
        throw Error("Number release was not safely retired");
      }
    });
  }
}
Deno.test("retired actual helper cannot default to a configured or account-selected number", async () => {
  const db = {
    from() {
      throw Error("Unexpected lookup");
    },
  };
  try {
    await releaseLandlordMainNumber(
      db as unknown as Parameters<typeof releaseLandlordMainNumber>[0],
      {},
    );
  } catch (e) {
    if (e instanceof Error && e.message.includes("release is retired")) return;
    throw e;
  }
  throw Error("Release must be refused");
});
