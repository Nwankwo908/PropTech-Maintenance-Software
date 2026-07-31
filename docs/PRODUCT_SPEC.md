# Ulo — Product Spec + UX Stories

Each item: **what it is** · *one-sentence UX story*

---

## 1. Product surfaces


| Spec                                 | UX story                                                                                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Marketing site                       | *A landlord discovers Ulo, understands the promise in one scroll, and starts early access or login without hunting for CTAs.* |
| Landlord admin                       | *After login, a property manager lands in a calm ops home where attention, properties, and Ask Ulo are one click away.*       |
| Resident SMS + `/request` + rent pay | *A tenant texts or submits a form and feels guided, not bounced between portals.*                                             |
| Vendor verify / job / board          | *A vendor finishes setup once, then gets jobs and updates from SMS or a simple board—not a second product to learn.*          |


---



## 2. Landlord onboarding


| Spec                   | UX story                                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Guided setup           | *A new landlord walks property → vendors → residents → rules → payouts and finishes knowing the portfolio is live.*     |
| Fast-track documents   | *A busy owner drops lease packs, reviews AI extraction, and skips typing every unit by hand.*                           |
| Auto tenant activation | *The moment setup ends, residents get a clear welcome text—no “invite each person” chore.*                              |
| Auto vendor invites    | *Preferred vendors get their own verification link automatically so Pending chips start filling without a second pass.* |


---



## 3. Admin dashboard



### Overview


| Spec                                                                        | UX story                                                                                                      |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Portfolio KPIs                                                              | *At a glance, the manager sees open work, building health, and spend before opening any list.*                |
| Needs Your Attention                                                        | *Only decisions that need a human show up here, so the day starts with “what must I decide?”*                 |
| Activity feed                                                               | *They can skim what Ulo and people did today without opening every thread.*                                   |
| Decision rails (SLA, late rent, lease, invoice, external vendor, emergency) | *Clicking an attention item opens a focused rail that explains the situation and offers a clear next action.* |




### Properties


| Spec                          | UX story                                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| Building portfolio            | *They pick a building the way they’d walk a portfolio—by name and health, not by database IDs.*           |
| Property detail tabs          | *Inside a building, units, people, tasks, chats, and vendors live in one place so context doesn’t reset.* |
| Unit occupancy controls       | *Marking a unit vacant or active updates the real world in one menu, not a support ticket.*               |
| Assets / inspections / vision | *Uploading an appliance photo yields a usable assessment instead of a blank “upload received.”*           |
| Property AI insights          | *They ask “what’s going on here?” and get property-scoped answers, not a generic chatbot.*                |




### Communication


| Spec                 | UX story                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------- |
| SMS inbox            | *Every resident and vendor text lands in one inbox so ops never dig through personal phones.*              |
| Thread monitoring    | *Opening a thread shows a plain title and risk so they know if it’s onboarding noise or a real emergency.* |
| Onboarding = NO RISK | *Vendor/tenant welcome threads stay labeled onboarding so they don’t look like plumbing emergencies.*      |




### Work orders


| Spec               | UX story                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| Request management | *They filter open jobs by urgency and trade and reassign without leaving the ticket list.*                |
| Change vendor      | *If a plumber flakes, swapping vendors feels like one intentional decision, not a rebuild of the ticket.* |




### Vendors


| Spec                  | UX story                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| Roster + status chips | *Pending vs Active is obvious: unfinished verification never looks “ready for work.”*          |
| Add vendor → invite   | *Adding a roofer immediately starts verification so the roster grows into a usable network.*   |
| Compliance profile    | *On the vendor page they see license, insurance, and docs at a glance before assigning a job.* |




### Active tasks


| Spec                             | UX story                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Workflow kanban                  | *Maintenance, lease, and payment work show as living pipelines, not buried spreadsheet rows.*           |
| Start move-in / out / inspection | *Starting a lifecycle from the board feels like starting a run of the same engine, not a separate app.* |




### Residents


| Spec            | UX story                                                                                           |
| --------------- | -------------------------------------------------------------------------------------------------- |
| Resident roster | *They find a tenant, see activation state, and resend welcome without leaving Residents.*          |
| Resident detail | *Lease, open workflows, and SMS history sit together so they answer “who is this?” in one screen.* |




### Analytics


| Spec                         | UX story                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| Spend & projections          | *Finance-minded owners see where maintenance money went and what’s still waiting approval.* |
| Invoice approve in analytics | *Approving a pending invoice happens where spend is visible, not in a disconnected email.*  |




### Notifications hub


| Spec                            | UX story                                                                           |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| Delivery history                | *They prove a message sent—or see why it failed—without guessing.*                 |
| Broadcasts / inspection notices | *Sending the building a notice feels like drafting one message, not twenty texts.* |
| Override automation             | *When automation is wrong, they pause or override it with a clear human control.*  |




### Settings


| Spec                    | UX story                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| Organization / branding | *Company name and voice show up in tenant texts so messages feel like the property team.* |
| Connected email         | *They connect inbox discovery so email ops sit beside SMS, not in a side tool.*           |
| Notification prefs      | *They choose which events ping them so attention stays signal, not noise.*                |




### Shell


| Spec             | UX story                                                                              |
| ---------------- | ------------------------------------------------------------------------------------- |
| Universal search | *Typing a unit or name jumps them to the right person or building instantly.*         |
| Ask Ulo dock     | *Questions about the portfolio stay one click away without leaving the current page.* |


---



## 4. Resident experience


| Spec                      | UX story                                                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| SMS intake wizard         | *A tenant describes a problem and answers short follow-ups like texting a thoughtful PM, then gets a clear “we’re on it.”* |
| Trade classification      | *They never pick “plumbing vs HVAC” from a menu—Ulo figures the trade from plain language.*                                |
| Multi-issue split         | *Mouse + broken cabinets becomes two jobs after a simple YES, so the right vendors each get their piece.*                  |
| Same-trade same vendor    | *Two plumbing problems in one unit go to one plumber so the tenant isn’t juggling two strangers.*                          |
| Visit windows → vendors   | *When they offer Saturday after 3, vendors see those times when accepting and scheduling.*                                 |
| Photos in SMS             | *Snapping a picture in-thread means the vendor arrives knowing what to expect.*                                            |
| Unknown-number self-heal  | *Someone texting from a new phone can prove their unit and still get help without a dead end.*                             |
| Tenant activation         | *Moving in, they get a warm welcome and a clear YES to opt in—not a cryptic code.*                                         |
| Schedule confirm          | *When a vendor proposes a window, the tenant YES/NO’s in SMS and feels in control of access.*                              |
| Lease early inquiry       | *Asking “when’s my renewal / 1 or 2 years?” gets a human acknowledgment and a noted preference, not a maintenance quiz.*   |
| Lease YES/NO/QUESTIONS    | *Near lease end, renewing or leaving is three clear replies, not a portal scavenger hunt.*                                 |
| Rent reminders + pay link | *A reminder explains what’s due and how to pay so catching up doesn’t require calling the office.*                         |
| Web `/request`            | *Tenants who prefer forms get the same outcome as SMS without learning the admin product.*                                 |


---



## 5. Vendor experience


| Spec                               | UX story                                                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Verification invite                | *They get a short invite that says who it’s from, why, and a 5-minute link—then they’re eligible for work.*    |
| Verification form                  | *One form covers license, insurance, background, W-9, and trades so they aren’t emailed five PDFs.*            |
| Inbox + SMS status after submit    | *They text-ack that the form was received and whether anything’s still missing.*                               |
| Job offer SMS                      | *A YES/NO work order arrives with unit, issue, and resident availability when known.*                          |
| Availability ask                   | *After accept, they’re asked for a window that fits the resident’s times—or the closest they can do.*          |
| Tenant confirm loop                | *They don’t show up blind; the tenant confirms the window first.*                                              |
| Reschedule                         | *Life happens—they propose a new time and the resident confirms without calling the office.*                   |
| Estimate / upload / invoice tokens | *Each step is a focused link: price it, photo it, bill it—no full vendor SaaS login required.*                 |
| Vendor board                       | *Pros who want a board see accept → in progress → complete in one place.*                                      |
| External find + invite             | *When the roster can’t cover a trade, ops finds a local pro and invites them into the same verification path.* |
| Auto-reassign / incidents          | *If someone no-shows or stalls, the system rematches so the tenant isn’t stuck waiting forever.*               |


---



## 6. Workflow engine


| Spec                                 | UX story                                                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Shared pipeline                      | *Every domain feels like the same product: something starts, Ulo acts, and if it’s stuck a human gets it.* |
| Maintenance intake run               | *A text becomes a tracked run that ends in real work orders, not a lost SMS.*                              |
| Vendor job response run              | *Accept and schedule stay on the same job thread so status never forks.*                                   |
| Lease / rent / identity runs         | *Renewals, rent, and unknown callers use the same engine language landlords already trust.*                |
| Lifecycle move-in / out / inspection | *Starting those from the board feels like another workflow card—not a bolted-on module.*                   |


---



## 7. Lease & rent


| Spec                   | UX story                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| Cron renewal outreach  | *Before lease end, tenants get a clear stay-or-go ask at the right time.*                               |
| Escalated renewal      | *Silence after outreach becomes a Needs Attention item so renewals don’t die in a void.*                |
| Incentive message      | *Ops can offer a renewal perk in the same thread where the decision lives.*                             |
| Rent collection runs   | *Due and overdue feel progressive and fair: remind, then escalate, with a pay path.*                    |
| Stripe Connect payouts | *Landlords receive rent into their connected account; vendors receive invoice payouts into theirs — each payee verifies once with Stripe.* |
| Ready = charges enabled | *Online rent or invoice pay only works after that payee’s Stripe Connect account can accept charges.* |


---



## 8. Ask Ulo


| Spec                                                   | UX story                                                                                      |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Modes (Agent / Legal / Finance / Maintenance / Market) | *They pick a lens so answers sound like the specialist they meant to ask.*                    |
| Ops Q&A (WOs, vendors, decisions, workflows)           | *“What’s waiting on me?” gets a grounded answer from live portfolio data.*                    |
| Legal / market / comps                                 | *They ask about rules or rents and get cited, careful answers—not vibes.*                     |
| Draft communication                                    | *They ask for a notice draft and leave with copy they can send, not a blank page.*            |
| Streaming + history                                    | *Answers appear live and past chats stay findable so investigations don’t restart from zero.* |


---



## 9. Communications platform


| Spec                  | UX story                                                                                |
| --------------------- | --------------------------------------------------------------------------------------- |
| Landlord SMS line     | *Outbound texts come from the property’s Ulo number so tenants always know who it is.*  |
| Proxied admin reply   | *Ops replies in-thread and the resident still experiences one continuous conversation.* |
| Broadcasts            | *One message fans out to the right audience with delivery tracked.*                     |
| Retry failed delivery | *A failed welcome or job SMS can be retried without rebuilding the whole flow.*         |
| Writing standard      | *Every SMS/email reads like a calm PM wrote it—never like a status enum.*               |


---



## 10. Money & compliance


| Spec                    | UX story                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| Invoice → approve → pay | *Vendor bills move from submit to landlord approval to Stripe Checkout; funds destination-charge the vendor’s Connect account.* |
| Landlord rent payouts | *Tenants pay online only after the landlord’s payout account is ready.* |
| Vendor payout readiness | *Vendors finish Stripe Connect during verification so approved invoices can pay out.* |
| Verification readiness  | *Work isn’t assigned to “Active” vendors until required docs are actually done.*              |
| Expiry / suspend        | *Expired insurance quietly blocks dispatch so risk doesn’t wait for a lawsuit.*               |


---



## 11. Intelligence & automation


| Spec                 | UX story                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------- |
| Issue classification | *Messy tenant wording still lands on the right trade and urgency.*                           |
| SLA + auto-reassign  | *Jobs that sit too long get a new vendor without the landlord babysitting a timer.*          |
| Vision assess        | *A photo of equipment becomes structured insight for the property file.*                     |
| Weather / emergency  | *Storm or emergency context surfaces where decisions happen, not in a separate weather app.* |


---



## 12. Operations graph & attention


| Spec                       | UX story                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Graph events               | *Every meaningful action is remembered so Ask Ulo and the feed can explain “what happened.”*                              |
| Needs Your Attention kinds | *Invoice ready, assign vendor, escalations, late rent, renewals, and unknown occupants each arrive as a clear human ask.* |


---



## 13. Integrations


| Spec                    | UX story                                                                        |
| ----------------------- | ------------------------------------------------------------------------------- |
| Twilio / Telnyx         | *Texts just work on the carrier the landlord’s line uses.*                      |
| Resend email            | *Invites and ops emails arrive branded and readable alongside SMS.*             |
| Stripe                  | *Paying rent or an invoice feels like normal checkout, not a wire instruction.* |
| OpenAI + discovery APIs | *Classification, Ask Ulo, and “find a vendor nearby” feel instant and local.*   |


---



## 14. Public / growth


| Spec                   | UX story                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| Landing + early access | *A visitor understands Ulo in one viewport and can request access without a sales call first.* |
| Legal pages            | *Trust and compliance are one click from the footer when they’re deciding to adopt.*           |
| Admin login            | *Operators get in securely and land in the ops product, not the marketing site.*               |


