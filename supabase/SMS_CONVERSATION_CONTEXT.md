# SMS conversation context

Resident SMS interpretation and maintenance classification receive request-local conversation context. The database continues to hold the durable transcript and workflow state; model requests remain stateless.

The context contains:

- Up to 20 earlier inbound/outbound messages, oldest first, with timestamps and roles. Text is bounded to 700 characters per message and 8,000 characters overall, keeping the newest messages when the budget fills.
- The latest nonfailed Ulo message separately, up to 2,000 characters, so a reminder remains visible even after a burst of inbound messages. Its delivery status is included. Accepted/queued messages are not represented as confirmed delivery.
- The actual pending intake question reconstructed from saved state, including dynamic diagnostic and clarification questions.
- Server-validated landlord, conversation, resident, property/unit and linked ticket identifiers, the ticket's actual status, and the current inbound timestamp.

There is no short time cutoff that discards a reminder after a delayed reply. History is anchored strictly before the current inbound's database timestamp; the current message is passed separately and later concurrent webhook activity is excluded. Messages sharing the anchor's exact timestamp are omitted rather than assumed to precede it.

Before reading history, the loader validates the conversation's landlord, resident, unit, external phone, absence of a vendor identity, and Ulo number. Message reads are restricted to that conversation/account and participant/line pair. Failed, undelivered, cancelled and unknown-status outbound messages are excluded. Linked tickets must belong to the same landlord and resident and match the known location. A matching phone cannot override an explicit different resident owner. Missing or conflicting scope leaves the extra context unavailable; it does not trigger a search across other conversations.

Only text and scoped metadata enter the prompt. Provider payloads and attachment URLs are not loaded; links in historical bodies are replaced with `[link]` to avoid passing upload capabilities or signed URLs. History is quoted JSON data, never instructions or authorization. Completed/cancelled tickets remain historical; ambiguous references require clarification. Existing routing, confirmation, compliance and reminder cadence rules remain authoritative.

Heuristic interpretations and explicit confirmations still bypass the interpreter's model path. Context is reused by initial intake, clarification and diagnostic follow-up classification without introducing another model call. Model providers are unchanged by this fix.

## Verification and rollout

```sh
npx vitest run --config scripts/vitest.sms-context.config.ts
```

The fixture suite covers delayed reminders, message order, bounded context, delivery status, current-message anchoring, tenant/account/unit/line isolation, ticket ownership, URL redaction, database outages, actual model prompt construction and deterministic confirmations. Existing Deno interpretation, follow-up, ticket-state, classification and rent-precedence tests also cover the preserved routing rules.

No schema migration is needed for this context fix. Deploy `sms-inbound` through the existing authenticated Supabase workflow after reviewing the local changes. This working tree also contains Home Check changes; apply their migration prerequisites in [HOME_CHECK.md](HOME_CHECK.md) before deploying the whole branch. Tests use mocked I/O and send no SMS; live model/SMS behavior has not been exercised in this environment. Broad Edge type checks still encounter existing repository errors.
