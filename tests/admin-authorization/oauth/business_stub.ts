export const business = { saved: [] as unknown[], events: 0 };
export function saveLandlordThumbtackRefreshToken(
  _s: unknown,
  id: string,
  _token: string,
  options: unknown,
) {
  business.saved.push({ id, options });
  return Promise.resolve({ ok: true, error: undefined as string | undefined });
}
export function recordActivityLog(_s: unknown, _input: unknown) {
  business.events++;
  return Promise.resolve(null);
}
