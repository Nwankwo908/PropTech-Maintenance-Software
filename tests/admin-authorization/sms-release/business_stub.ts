import { state } from "../routing/sdk_stub.ts";
export function releaseLandlordMainNumber(
  _db: unknown,
  params: Record<string, unknown>,
) {
  state.business.push({ name: "release", params });
  state.writes++;
  return Promise.resolve({
    status: params.completeRelease ? "released" : "released_pending",
  });
}
