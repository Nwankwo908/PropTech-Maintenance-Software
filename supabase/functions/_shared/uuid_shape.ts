/** Any 128-bit UUID string Postgres accepts (incl. md5()::uuid demo seed ids). */
export const UUID_SHAPE_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuidShape(value: string): boolean {
  return UUID_SHAPE_RE.test(value.trim())
}
