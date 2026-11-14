import { state } from "../routing/sdk_stub.ts";
export function releaseLandlordMainNumber(
  _db: unknown,
  params: Record<string, unknown>,
) {
  if (state.errorTable === "release-business") {
    throw new Error("Synthetic release diagnostic");
  }
  state.business.push({ name: "release", params });
  state.writes++;
  return Promise.resolve({
    status: params.completeRelease ? "released" : "released_pending",
  });
}
