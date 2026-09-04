const TOKEN_BYTES = 32

export function generateInspectionCaptureToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES)
  crypto.getRandomValues(bytes)
  return bytesToHex(bytes)
}

export async function hashInspectionCaptureToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token.trim())
  const digest = await crypto.subtle.digest("SHA-256", data)
  return bytesToHex(new Uint8Array(digest))
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let out = 0
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return out === 0
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
}
