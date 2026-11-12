export const ACCOUNT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const ACCOUNT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const TICKET_A = "11111111-1111-4111-8111-111111111111";
export const TICKET_B = "22222222-2222-4222-8222-222222222222";
export const INVOICE_A = "33333333-3333-4333-8333-333333333333";
export const INVOICE_B = "44444444-4444-4444-8444-444444444444";
export const RUN_A = "55555555-5555-4555-8555-555555555555";
export const RUN_B = "66666666-6666-4666-8666-666666666666";
export const EMAIL = "admin-a@example.invalid";
export function token(claims: Record<string, unknown> = {}) {
  return btoa(JSON.stringify({ alg: "stub" })) + "." +
    btoa(
      JSON.stringify({
        sub: USER,
        email: EMAIL,
        role: "authenticated",
        ...claims,
      }),
    ) + ".stub-signature";
}
