# Option A: OTP codes for all residents (one-time dashboard setup)

## Getting a confirmation link instead of a six-digit code?

The app already calls **`signInWithOtp`** (no `emailRedirectTo`) and verifies with **`verifyOtp`** using the code. Supabase still emails **whatever your templates contain**. The stock **Confirm signup** and **Magic link** templates usually show only **`{{ .ConfirmationURL }}`** (a clickable link), not **`{{ .Token }}`**. There is no client-side flag to “force OTP email only”; you must change the templates (below).

**Do this:** open both **Confirm signup** and **Magic link**, put **`{{ .Token }}`** in the body, and **remove** or de-emphasize **`{{ .ConfirmationURL }}`** / “click to confirm” if you want a code-only experience. Save each template, then request a new code from the maintenance form.

---

Resident sign-in uses **`signInWithOtp`** and in-app verification (`verifyOtp`). **You do not configure anything per resident** in User Management or the `users` table.

**Email behavior is controlled only by Supabase Auth email templates.** Editing a template applies to **every** send that uses that template for your whole project—this is Option A.

## What to edit (two templates)

`signInWithOtp` with `shouldCreateUser: true` (see `src/lib/residentAuth.ts`) can trigger different emails:

| Scenario | Template to edit |
|----------|------------------|
| **First time** this email signs in (new Auth user) | **Confirm signup** |
| **Returning** passwordless sign-in | **Magic link** |

If you only change **Magic link**, new addresses still get **Confirm signup** with link-only content and no visible code—update **both** so all residents see `{{ .Token }}`.

## Steps (Supabase Dashboard)

1. Open **[Authentication](https://supabase.com/dashboard/project/_/auth/templates) → Email → Templates** for your project.
2. Open **Confirm signup**.
   - Include **`{{ .Token }}`** in the body so the numeric/alphanumeric code appears in the email.
   - For OTP-only UX, remove or omit **`{{ .ConfirmationURL }}`** and “click to confirm” style links so users are not pushed to magic-link flows.
3. Open **Magic link** and make the **same** change: show **`{{ .Token }}`**, optional removal of link-only flow.
4. Click **Save** for each template.

### Example body (HTML or plain text)

Use this pattern in **both** templates:

```
Your verification code is: {{ .Token }}

Enter this code in the app to continue. It expires after a short time.
```

- **`{{ .Token }}`** — the code the app expects (often 6 digits; some projects use 8–10 digits or a short alphanumeric value). The resident portal accepts flexible lengths (see `src/lib/emailOtp.ts`).
- Use **`{{ .Token }}` once** in the visible body. Duplicating it or mixing **`{{ .TokenHash }}`** with confusing copy can look like a wrong “long” code.

## Applies to all residents automatically

- **No** bulk list, **no** per-row setup in **Admin → Residents** or **`public.users`** for templates.
- After you save, **any** resident who receives that template gets the same OTP-in-email behavior.

## URL configuration

Under **Authentication → URL Configuration**, set **Site URL** and **Redirect URLs** for your app (e.g. production URL and `http://localhost:5173` / `http://localhost:4173` for local preview). The app verifies codes in the modal; links in email should not be required if you use OTP-only templates.

## Custom SMTP

If you use **custom SMTP**, keep **`{{ .Token }}`** in the same templates. Verify domain / SPF / DKIM so messages are delivered.

## Email rate limits

See the **Rate limits** section under **Authentication** in the dashboard. Low **emails per hour** (e.g. 2/h) makes testing difficult—wait between test sends or raise the limit if your plan allows.

Mitigations:

- **Custom SMTP** may improve deliverability and headroom.
- During UI work, **`npm run dev`** skips the resident OTP gate (`isResidentAuthEnabled` in `src/lib/residentAuth.ts`), so you send fewer Auth emails.

## Related code

- `sendEmailOtp` / `verifyEmailOtpAndSignIn` — `src/lib/residentAuth.ts`
- OTP input validation — `src/lib/emailOtp.ts`
- Verify modal — `src/components/VerifyIdentityModal.tsx`
