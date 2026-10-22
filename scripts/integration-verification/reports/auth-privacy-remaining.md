# Auth / privacy remaining verification

**Date:** 2026-10-22  
**Command:** `npm run verify:auth-privacy-remaining` + SMS identity routing probe  
**Evidence JSON:** `.readiness/integration/auth-privacy-remaining.json`  
**SMS routing evidence:** `.readiness/integration/sms-identity-routing.json`  
**LA1:** not signed into / not modified / not messaged  

## Overall: **failed** (SMS tenant identity routing)

### 1. Tenant access

| Check | Status |
|---|---|
| Fixture roster + password-session API denials (landlord B) | passed |
| Product **email OTP** on `/request` | **passed** — operator completed real inbox code (not simulated) |

### 2. Social login

| Check | Status |
|---|---|
| Google → Limited Alpha 2 portal | **passed** — operator + `nwankwo908@gmail.com`; portal member of LA2 only |
| Wrong-account / LA1 link | **passed** — not a LA1 portal member |
| Apple | **not_applicable** |
| Logout + sign back in | **passed** — operator logged out then Google again |

### 3. Phone verification / SMS identity routing

| Check | Status |
|---|---|
| Auth phone OTP feature | **not_applicable** — app does not ship phone OTP login |
| Incorrect / expired / reused phone codes | **not_applicable** |
| Vendor SMS identity (`+14708880274`) | **passed** — LA2 vendor identity; live inbound YES / availability on LA2 thread only |
| Tenant SMS identity (`+19088843069`) | **failed** — LA2 resident identity exists, but live inbound after LA2 outbound routed to **Try Demo** (`…0001`) as “Try Demo Visitor” |

Resident/admin identity codes are **email OTP**, not SMS codes.

### SMS routing failure detail

- `+19088843069` is on **2** roster users (LA2 journey tenant + Try Demo Visitor) and **5** `sms_identities` across landlords (including LA1 + Try Demo).
- After LA2 journey outbound on conv `f760d841-…`, handset replies (`Yes`, `My sink is leaking`) landed on Try Demo conv `345ced5b-…`.
- `+14708880274` still has a stale LA1 `sms_identity` (unlinked resident), but live vendor inbound stayed on LA2.
- Shared Ulo DID `+18775803356` is owned by LA1 (`landlord_main`); inbound landlord is chosen via identity/conversation match.
