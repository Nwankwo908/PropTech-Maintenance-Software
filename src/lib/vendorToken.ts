/** localStorage key for vendor portal access code (`vendors.portal_api_key`). */
export const VENDOR_TOKEN_STORAGE_KEY = 'vendor_token'

/** Set before full reload to `/vendor` after a 401 so the access code page can show an error. */
export const VENDOR_INVALID_ACCESS_CODE_FLAG = 'vendor_invalid_access_code'

export function readVendorAccessToken(): string {
  try {
    return localStorage.getItem(VENDOR_TOKEN_STORAGE_KEY)?.trim() ?? ''
  } catch {
    return ''
  }
}
