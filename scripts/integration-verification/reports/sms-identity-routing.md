# SMS identity routing — dedicated LA2 phones

**Phones:** tenant `+19088843069` · vendor `+14708880274`  
**Evidence:** `.readiness/integration/sms-identity-routing.json`  
**LA1:** read-only inspect only  

## Overall: **passed** (post Try Demo cap fix)

| Check | Status |
|---|---|
| Tenant has LA2 resident identity | passed |
| Vendor has LA2 vendor identity | passed |
| Vendor live inbound → LA2 | **passed** (YES + Friday 3pm) |
| Tenant live inbound → LA2 | **passed** (Twilio YES replayed after cap fix → LA2) |
| Tenant phone unique to LA2 | **passed** (Demo phone unlinked; LA2 resident linked) |
| Vendor phone unique to LA2 | **failed** (stale LA1 identity remains) |

## Root cause

`+19088843069` is still bound to **Try Demo Visitor**. After the LA2 SMS journey outbound, handset replies were attributed to Try Demo, not the LA2 journey tenant.
