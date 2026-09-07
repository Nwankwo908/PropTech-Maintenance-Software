# Property History (Home Data Graph foundation)

Landlord-facing history on the Property page **Property History** tab. Not a messaging inbox.

## 1. Existing tables used

- `maintenance_requests` / `maintenance_request_enriched` — work orders, assignment, completion, photos
- `maintenance_invoices` — invoice number, amount, approval/payment status
- `vendors` — assigned vendor names
- `units` — unit labels and occupancy (`active` → Occupied, otherwise Vacant in this table)
- `users` — resident names on units
- `workflow_runs` (`template_id = rent_collection`) — landlord-confirmed rent recording
- `operations_graph_events` — additional landlord-facing outcomes (inspections, move-in/out, lease) not already represented by the rows above

## 2. Schema additions

None. History is a read-model assembled in `src/lib/propertyHistory.ts`. New writes still go through `recordActivityLog`.

## 3. Conversations tab → Property History

- Tab id `history`, label **Property History**
- `?tab=conversations` aliases to `history` via `parsePropertyDetailTab`
- `PropertyConversationsList` is no longer mounted on the Property page
- Messages remain on the Communication / Messages page

## 4. Maintenance history assembly

From each in-scope work order, in lifecycle order:

1. `{trade} issue reported`
2. `{vendor} assigned` when assigned
3. Work performed (description / completion) with invoice number, amount, and completion photos
4. Payment pending / invoice approved

Rows share `activityId = maintenance:{ticketId}` and keep `maintenanceRequestId`, `vendorId`, `invoiceId`, and media paths.

## 5. Rent history assembly

From `rent_collection` workflow run metadata (landlord confirmation is authoritative; tenant `PAID` SMS is not):

- Rent due (amount + due date)
- Landlord confirmed Paid / Unpaid / Partial
- Amount received and method
- Remaining balance
- Grace-period reminder dates
- Escalation
- Balance $0 / Paid

## 6. Invoices, vendors, media

Linked by work-order id. Invoice numbers and amounts appear on the work and payment rows. Photo/video paths come from `photo_paths` and `completion_photo_paths` (storage `maintenance-uploads`). The Media column uses the Figma image icon; files open from signed URLs.

## 7. P0 workflows that contribute today

- Maintenance (ticket + vendor assignment + completion)
- Vendor work (assignment row)
- Invoices (number, amount, approval/pending)
- Photos/video on the ticket
- Rent collection / landlord rent recording (`workflow_runs` + `rent.*` graph events not duplicated)

## 8. Gaps vs Figma / spec

- Occupancy chip is **current** unit status, not historical occupancy at event time
- Work-performed copy uses the ticket description when there is no separate “work notes” field
- Late-fee waived and payment-plan offered appear only if already stored on the rent run / graph
- Graph lookup is landlord-scoped then filtered; very old events can fall outside the fetch window
- Future domains (inspections, move-in/out, lease, appliances) can appear from `operations_graph_events` without a new tab

## 9–10. Tests

`src/lib/propertyHistory.test.ts`:

- Property/unit isolation (other buildings excluded)
- Newest-first ordering
- Linked maintenance activity ids
- Rent from landlord confirmation metadata
- `sms_conversations` / `sms_messages` are not source tables; SMS/pipeline graph events are dropped
