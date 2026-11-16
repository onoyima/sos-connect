# Subscriptions and billing (platform owner)

SOS Connect is sold to institutions as a subscription. Everything is run from the platform owner's admin area.

## Pages

| Page | What it's for |
| --- | --- |
| **Institutions** | Every institution, its plan and status (free trial, active, payment due, lapsed, cancelled), members against its limit, revenue and unpaid totals. Filter and search. |
| **Institution** (open one) | Change its plan, billing period, status and dates; agree a special price or member limit; extend a trial (+7/14/30/60 days); create an invoice; record a payment (bank transfer, cash, cheque, waived); cancel an invoice; see its billing history. |
| **Plans** | The packages: name, monthly and yearly price, member limit, trial length, which features are included, whether schools can see it, archive it. |
| **Billing** | The switches below, and the Paystack status and webhook address. |

## The switches (Platform → Billing)

* **Enforce subscriptions.** Off (the default after upgrading): plans, trials and invoices are tracked, but no institution loses anything. On: features follow each plan, new members stop at the plan's limit, and unpaid subscriptions lapse after the grace period.
* **Free trial (days)**, **grace period (days)**, **remind admins (days before)**, **currency**, the plan and billing period **new institutions start on**.
* **Lapsed institutions lose features.** On: after the grace period only SOS, notices, safety checks and offline SOS keep working. Off: they keep their plan's features while you follow up by hand.
* **Schools choose their own plan.** On: school admins pick a plan and get an invoice. Off: their choice comes to you in the platform chat.
* **Online payment (Paystack)**, **bank transfer** (with the bank details schools see) and when invoices fall due.

**SOS is never part of a plan and never stops**, whatever the subscription.

## How a subscription moves (checked every hour by `sos:billing`)

```
free trial ──(trial ends, plan costs money)──▶ payment due ──(grace period over)──▶ lapsed
    │                                              ▲    │
    │(free plan)                                   │    └─(paid)─▶ active ──(period ends)──┘
    └──────────────▶ active (renews by itself) ◀───┘
```

* When a trial or paid period ends, an invoice for the next period is created automatically.
* Paying an invoice (online, or recorded by you) makes the subscription active until the end of the invoice's period. Paying early never loses days.
* "End at the end of this period" (by the school or by you) cancels it when the period ends.

## Existing institutions

When this was added, every existing institution was put on the **Enterprise** plan (every feature, no member limit) with a fresh **30-day trial**, and enforcement is **off**. So nothing changes for them until you:

1. Set your prices under **Plans** (they all start at 0).
2. Open each institution and set its real plan and dates (or record what it has already paid).
3. Switch **Enforce subscriptions** on under **Billing**.

## Paystack

1. In `.env`: `PAYSTACK_SECRET_KEY=sk_live_…` and `PAYSTACK_PUBLIC_KEY=pk_live_…`, then `php artisan config:cache`.
2. In the Paystack dashboard (Settings → API keys and webhooks), set the **webhook URL** shown on the Billing page (`https://your-domain/webhooks/paystack`).
3. Switch **Online payment** on under Billing.

Payments are confirmed with Paystack's own servers before an invoice is marked paid, and the amount and currency must match the invoice. Webhooks are accepted only with Paystack's signature. Use `sk_test_…` keys first to try it with test cards.
