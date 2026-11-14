/** Shape of public.get_staff_metrics() output, captured from the migration on a disposable database. */
export const STAFF_METRICS_SHAPE_FIXTURE = {
    "ai": {
        "ask_ulo_tokens": 0,
        "ask_ulo_answers": 0,
        "ask_ulo_refused": 0,
        "classifications": 0,
        "ask_ulo_cost_usd": 0.00,
        "classifications_reviewed": 0,
        "ask_ulo_median_latency_ms": null,
        "ask_ulo_blocked_or_clarified": 0,
        "classification_low_confidence": 0,
        "classification_review_accuracy": null,
        "classification_rules_only_rate": null
    },
    "sms": {
        "inbound": 0,
        "outbound": 0,
        "outbound_failed": 0,
        "outbound_delivered": 0,
        "residents_opted_out": 0,
        "outbound_failure_rate": null,
        "residents_activation_failed": 0,
        "residents_activated_in_window": 0
    },
    "money": {
        "rent_due": 0,
        "rent_late_events": 0,
        "maintenance_spend": 0,
        "rent_collected_online": 0,
        "invoices_waiting_count": 0,
        "invoices_waiting_total": 0,
        "invoices_approved_total": 0,
        "rent_reported_by_tenants": 0
    },
    "since": "2026-10-15T00:00:00Z",
    "growth": {
        "units": 0,
        "funnel": {
            "signed_up": 5,
            "added_property": 0,
            "added_residents": 0,
            "first_work_order": 0,
            "activated_a_resident": 0,
            "onboarding_completed": 0
        },
        "residents": 0,
        "properties": 0,
        "landlords_new": 5,
        "landlords_total": 5,
        "landlords_active": 0,
        "waitlist_signups": 0,
        "residents_activated": 0,
        "new_landlords_by_source": [
            {
                "count": 5,
                "source": "unknown"
            }
        ],
        "resident_activation_rate": null
    },
    "vendors": {
        "offers": 0,
        "ratings": 0,
        "accepted": 0,
        "declined": 0,
        "no_response": 0,
        "active_vendors": 0,
        "average_rating": null,
        "acceptance_rate": null,
        "median_minutes_to_respond": null
    },
    "data_health": {
        "delivery_retries_7d": 0,
        "required_crons_total": 14,
        "required_crons_paused": 6,
        "required_crons_missing": 0,
        "crons_needing_attention": [
            {
                "status": "paused",
                "jobname": "ulo-lease-renewals",
                "scheduled": false,
                "failed_runs_24h": 0
            },
            {
                "status": "paused",
                "jobname": "ulo-vendor-compliance-expiry",
                "scheduled": false,
                "failed_runs_24h": 0
            },
            {
                "status": "paused",
                "jobname": "ulo-vendor-delayed-auto-reassign",
                "scheduled": false,
                "failed_runs_24h": 0
            },
            {
                "status": "paused",
                "jobname": "ulo-vendor-incident-protocols",
                "scheduled": false,
                "failed_runs_24h": 0
            },
            {
                "status": "paused",
                "jobname": "ulo-vendor-performance-standards",
                "scheduled": false,
                "failed_runs_24h": 0
            },
            {
                "status": "paused",
                "jobname": "ulo-workflow-escalations",
                "scheduled": false,
                "failed_runs_24h": 0
            }
        ],
        "unit_mismatch_findings_7d": 0,
        "work_orders_missing_property": 0,
        "required_cron_failed_runs_24h": 0
    },
    "maintenance": {
        "weekly": [
            {
                "created": 0,
                "completed": 0,
                "week_start": "2026-10-12"
            },
            {
                "created": 0,
                "completed": 0,
                "week_start": "2026-10-19"
            },
            {
                "created": 0,
                "completed": 0,
                "week_start": "2026-10-26"
            },
            {
                "created": 0,
                "completed": 0,
                "week_start": "2026-11-02"
            },
            {
                "created": 0,
                "completed": 0,
                "week_start": "2026-11-09"
            }
        ],
        "created": 0,
        "by_trade": [
        ],
        "open_now": 0,
        "reopened": 0,
        "cancelled": 0,
        "completed": 0,
        "emergencies": 0,
        "overdue_now": 0,
        "stalled_now": 0,
        "needs_staff_now": 0,
        "p90_hours_to_assign": null,
        "p90_hours_to_complete": null,
        "median_hours_to_assign": null,
        "median_hours_to_complete": null
    },
    "window_days": 30,
    "generated_at": "2026-11-14T00:00:00Z",
    "include_demo": false
} as const
