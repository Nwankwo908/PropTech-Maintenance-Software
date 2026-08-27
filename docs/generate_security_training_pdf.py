#!/usr/bin/env python3
"""Generate docs/Ulo-Engineer-Security-Training.pdf"""

from pathlib import Path

from fpdf import FPDF

OUT = Path(__file__).with_name("Ulo-Engineer-Security-Training.pdf")

TEAL = (24, 97, 121)
INK = (16, 24, 40)
MUTED = (75, 85, 99)
RULE = (229, 231, 235)
PILL = (240, 253, 244)


class TrainingPDF(FPDF):
    def header(self):
        if self.page_no() == 1:
            return
        self.set_font("Helvetica", "", 9)
        self.set_text_color(*MUTED)
        self.cell(0, 8, "Ulo  |  Engineer security training", align="L")
        self.cell(0, 8, "Internal  |  Do not distribute exploits", align="R", new_x="LMARGIN", new_y="NEXT")
        self.set_draw_color(*RULE)
        self.line(self.l_margin, 16, self.w - self.r_margin, 16)
        self.ln(6)

    def footer(self):
        self.set_y(-14)
        self.set_font("Helvetica", "", 8)
        self.set_text_color(*MUTED)
        self.cell(0, 8, f"Page {self.page_no()}/{{nb}}", align="C")

    def h1(self, text):
        self.set_font("Helvetica", "B", 18)
        self.set_text_color(*TEAL)
        self.multi_cell(0, 9, text)
        self.ln(3)

    def h2(self, text):
        self.ln(4)
        self.set_font("Helvetica", "B", 13)
        self.set_text_color(*TEAL)
        self.multi_cell(0, 7, text)
        self.ln(2)

    def h3(self, text):
        self.ln(2)
        self.set_font("Helvetica", "B", 11)
        self.set_text_color(*INK)
        self.multi_cell(0, 6, text)
        self.ln(1)

    def body(self, text):
        self.set_font("Helvetica", "", 10)
        self.set_text_color(*INK)
        self.multi_cell(0, 5.4, text)
        self.ln(1.5)

    def bullet(self, text):
        self.set_font("Helvetica", "", 10)
        self.set_text_color(*INK)
        x = self.get_x()
        self.cell(6, 5.4, "-")
        self.multi_cell(0, 5.4, text)
        self.set_x(x)

    def check(self, text):
        self.set_font("Helvetica", "", 10)
        self.set_text_color(*INK)
        x = self.get_x()
        self.cell(8, 5.4, "[ ]")
        self.multi_cell(0, 5.4, text)
        self.set_x(x)

    def kv_table(self, rows, col1=48, col2=52, col3=None):
        self.set_font("Helvetica", "B", 9)
        self.set_fill_color(*TEAL)
        self.set_text_color(255, 255, 255)
        headers = rows[0]
        widths = [col1, col2] if col3 is None else [col1, col2, col3]
        if col3 is None and len(headers) == 3:
            widths = [42, 55, 73]
        for i, h in enumerate(headers):
            self.cell(widths[i], 7, h, border=0, fill=True)
        self.ln()
        self.set_font("Helvetica", "", 9)
        self.set_text_color(*INK)
        fill = False
        for row in rows[1:]:
            self.set_fill_color(247, 249, 250) if fill else self.set_fill_color(255, 255, 255)
            # measure height
            line_h = 5
            max_lines = 1
            for i, cell in enumerate(row):
                lines = self.multi_cell(widths[i], line_h, cell, dry_run=True, output="LINES")
                max_lines = max(max_lines, len(lines))
            h = line_h * max_lines + 2
            y = self.get_y()
            x0 = self.l_margin
            if y + h > self.page_break_trigger:
                self.add_page()
                y = self.get_y()
            for i, cell in enumerate(row):
                self.set_xy(x0 + sum(widths[:i]), y)
                self.multi_cell(widths[i], line_h, cell, fill=True)
            self.set_y(y + h)
            fill = not fill
        self.ln(2)


def build():
    pdf = TrainingPDF(format="Letter")
    pdf.alias_nb_pages()
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.set_margins(18, 18, 18)
    pdf.add_page()

    pdf.set_fill_color(*TEAL)
    pdf.rect(0, 0, 216, 42, "F")
    pdf.set_y(14)
    pdf.set_font("Helvetica", "B", 22)
    pdf.set_text_color(255, 255, 255)
    pdf.cell(0, 10, "Ulo engineer security training", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 11)
    pdf.cell(0, 7, "Application-specific  |  Property operations platform", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(16)

    pdf.set_text_color(*INK)
    pdf.set_font("Helvetica", "", 10)
    pdf.multi_cell(
        0,
        5.5,
        "Audience: anyone shipping src/ or supabase/functions/.\n"
        "Goal: do not leak another landlord's data, do not send money to the wrong Connect account, "
        "and do not turn a public token or SMS into an admin action.\n\n"
        "This is defensive training for this codebase. It is not a penetration-test playbook "
        "and does not include exploit steps or attack payloads.",
    )

    pdf.h2("Stack to keep in mind")
    pdf.body(
        "Vite + React SPA talks to Supabase (Postgres, Auth, Storage) and Deno Edge Functions. "
        "Many Edge Functions use the service role, so Row Level Security does not save a missing filter. "
        "Payments go through Stripe. Tenant and vendor messaging goes through SMS."
    )

    pdf.h2("Module 1  -  Tenancy (landlord_id is the wall)")
    pdf.body("Ulo is multi-tenant. Almost every row is scoped to a landlord.")
    pdf.h3("Rules")
    pdf.bullet(
        "Every query, insert, and workflow run must bind landlordId from a trusted source "
        "(session, invite token -> verification row, cron job landlord). Never from an unbound client field."
    )
    pdf.bullet(
        "Dashboard: getActiveLandlordId() / workspace context. Edge: resolve landlord from the "
        "authenticated principal or the token row, then filter .eq(\"landlord_id\", ...)."
    )
    pdf.bullet("Do not load maintenance_requests, vendors, or users by UUID alone.")
    pdf.h3("Discussion exercise")
    pdf.body(
        "A new Edge action takes { landlordId, ticketId } from the JSON body. What is wrong, "
        "and how should it resolve tenancy?"
    )

    pdf.h2("Module 2  -  Three auth worlds (do not mix them)")
    pdf.kv_table(
        [
            ["Who", "How they prove it", "Typical code"],
            [
                "Resident / landlord user",
                "Supabase JWT -> auth.getUser",
                "submit-maintenance-request",
            ],
            [
                "Property-team admin tools",
                "ADMIN_REASSIGN_SECRET (header or Bearer)",
                "requireAdminReassignAuth",
            ],
            [
                "Vendor (portal / SMS)",
                "Portal API key, SMS identity, or /v/:token",
                "vendor-verification, Connect session",
            ],
            [
                "Cron / ops",
                "Dedicated secrets; sometimes admin fallback",
                "authorizedCronBearer",
            ],
        ]
    )
    pdf.h3("Hard facts in this repo")
    pdf.bullet(
        "VITE_ADMIN_REASSIGN_SECRET is a browser env var. Treat it as a dashboard install secret, "
        "not a user password. Anyone with the built app can see it. Admin Edges that use it still "
        "must be landlord-scoped and must not run as any landlord."
    )
    pdf.bullet("Never put SUPABASE_SERVICE_ROLE_KEY or STRIPE_SECRET_KEY in VITE_*.")
    pdf.bullet(
        "Many functions set verify_jwt = false and check auth inside the handler. Copying that "
        "flag without a real guard is an open endpoint."
    )
    pdf.body(
        "Do: reuse requireAdminReassignAuth, proxied_message_auth, and token lookup on "
        "vendor_verifications. Do not invent a fourth header or a temporary unauthenticated POST."
    )

    pdf.h2("Module 3  -  Public links")
    pdf.body(
        "Unauthenticated pages are first-class attack surface: /v/:token, work orders, estimates, "
        "and /pay/rent."
    )
    pdf.h3("Rules")
    pdf.bullet("Tokens must be unguessable. Never sequential IDs in the URL.")
    pdf.bullet(
        "A token proves that vendor, job, or payment - not admin. Create Connect Account Sessions "
        "from the row's acct_ id, never from a client-supplied account id."
    )
    pdf.bullet(
        "On save/submit, reload the row by token and ignore extra landlordId / vendorId in the body."
    )
    pdf.bullet("W-9: store last4 + fingerprint, not the full TIN.")
    pdf.bullet("Payout UI: masked last4 only (loadPayoutMethods).")
    pdf.h3("Discussion exercise")
    pdf.body("Why create_account_session must not accept accountId from the browser.")

    pdf.h2("Module 4  -  Money (Stripe)")
    pdf.body("Keep the two money paths separate. Destinations, payers, and ledgers differ.")
    pdf.kv_table(
        [
            ["Flow", "Direction", "Destination"],
            ["Rent", "Tenant -> landlord", "Landlord Connect"],
            ["Invoice", "Landlord -> vendor", "Vendor Connect"],
        ]
    )
    pdf.body(
        "Ready means a valid acct_ id AND charges_enabled === true. Use isStripeConnectReady "
        "(edge: _shared/stripeConnect.ts; client: src/lib/stripeConnectReady.ts). Do not invent a second check."
    )
    pdf.h3("Rules")
    pdf.bullet("Never send landlord Connect as an invoice destination, or vendor Connect as rent.")
    pdf.bullet("Do not trust client amount or destination without server-side ticket and policy.")
    pdf.bullet("Live Connect return URLs must be HTTPS. Localhost plus sk_live_ fails for hosted links.")

    pdf.h2("Module 5  -  SMS and conversations")
    pdf.body("Inbound SMS is a trusted control plane (YES/NO, STOP, cancel work orders).")
    pdf.h3("Rules")
    pdf.bullet(
        "Handler registry: one message -> one action, only with stored pending context. "
        "Do not add a keyword handler that mutates tickets without a pending ask."
    )
    pdf.bullet("Cancel must close the ticket and the workflow run (closeWorkOrderCancelledByResident).")
    pdf.bullet("Do not treat status questions as new work orders.")
    pdf.bullet("Admin SMS (admin-conversation-sms) still needs tenancy and auth.")
    pdf.bullet("STOP/HELP are compliance. Do not retry welcome SMS after STOP.")
    pdf.body(
        "PII: threads contain phones, addresses, and unit numbers. Do not log full bodies to "
        "third parties. Activity feed copy stays landlord-facing, not raw payloads."
    )

    pdf.h2("Module 6  -  Data writes and the graph")
    pdf.bullet("Edge Functions with the service role bypass RLS. Your filter is the security model.")
    pdf.bullet(
        "Never raw-insert operations_graph_events or property_operations_graph. Use recordActivityLog."
    )
    pdf.bullet("New migrations only. Do not edit old migration files.")
    pdf.bullet("Storage: signed URLs / policies. Do not make maintenance uploads world-readable.")

    pdf.h2("Module 7  -  Secrets and shipping")
    pdf.kv_table(
        [
            ["Goes in the browser", "Stays on Edge / CI"],
            ["VITE_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
            ["VITE_STRIPE_PUBLISHABLE_KEY", "STRIPE_SECRET_KEY"],
            [
                "VITE_ADMIN_REASSIGN_SECRET (known limitation)",
                "Cron / misconduct / similar secrets",
            ],
        ],
        col1=85,
        col2=85,
    )
    pdf.bullet("Do not commit .env.")
    pdf.bullet(
        "Align Dashboard Edge ADMIN_REASSIGN_SECRET with local VITE_ADMIN_REASSIGN_SECRET or admin actions 401."
    )
    pdf.bullet("Deploy the function you changed. A SPA deploy does not update Deno.")

    pdf.h2("90-minute workshop")
    pdf.bullet("20 min - Walk a request: vendor /v/:token -> vendor-verification -> service role -> landlord_id on the row.")
    pdf.bullet("20 min - Walk rent vs invoice Connect.")
    pdf.bullet("20 min - Walk SMS inbound: registry vs workflow engine.")
    pdf.bullet("20 min - Run the PR threat checklist on a real recent PR.")
    pdf.bullet("10 min - Q&A: would I put this in VITE_?")

    pdf.h2("PR threat checklist")
    pdf.body("Paste into reviews:")
    pdf.check("Landlord scope from a trusted binding, not a free-form id")
    pdf.check("Auth matches the actor (JWT vs admin secret vs token vs cron)")
    pdf.check("No service role in the client")
    pdf.check("Money: correct Connect destination + shared readiness helper")
    pdf.check("Public token cannot change another vendor or landlord")
    pdf.check("SMS: pending gate; cancel closes workflow runs")
    pdf.check("recordActivityLog for state changes")
    pdf.check("Secrets not in git; new Edge verify_jwt / handler auth is explicit")

    pdf.ln(6)
    pdf.set_font("Helvetica", "I", 9)
    pdf.set_text_color(*MUTED)
    pdf.multi_cell(
        0,
        5,
        "Ulo internal training. For questions, review supabase/functions/_shared/admin_edge_auth.ts, "
        "stripeConnect.ts, and the SMS inbound handler registry.",
    )

    pdf.output(OUT)
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    build()
