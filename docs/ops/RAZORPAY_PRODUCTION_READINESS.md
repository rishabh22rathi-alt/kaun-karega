# Razorpay × Vercel — Production Payment Readiness Checklist

> **Operator runbook.** Work top-to-bottom. **Do not set `PAYMENT_ENABLED=true`
> until the final Go / No-Go check passes.** Every step is a manual action in the
> Vercel or Razorpay dashboard — no secrets are pasted anywhere except directly
> into those dashboards. **Never paste secret values into chat, tickets, or this
> file.**

---

## 0. Prerequisites
- [ ] Admin access to the Vercel project **and** the Razorpay account in **Live mode** (Live requires completed KYC/activation).
- [ ] Production DB already has the payments/invoice objects (`issue_invoice_for_paid_order` function + `payment_orders` / `provider_plans` / `invoices` tables). If a payments/invoice migration is unapplied in prod, apply it first or invoices cannot be issued.

## 1. Where to check Vercel Production env vars
- [ ] **vercel.com → Kaun Karega project → Settings → Environment Variables**.
- [ ] Filter to **Environment = Production** (Preview/Development values do **not** apply to prod).

## 2. Vars that must be LIVE (Production scope)
- [ ] `PAYMENT_ENABLED` = `true` — **set LAST**, only after §3–§8 pass.
- [ ] `RAZORPAY_KEY_ID` = `rzp_live_…` (see §3).
- [ ] `RAZORPAY_KEY_SECRET` = the **Live** secret paired with that Key ID.
- [ ] `RAZORPAY_WEBHOOK_SECRET` = strong, unique, **matches** the Razorpay Live webhook secret; **not** the old placeholder (see §4).
- [ ] `KK_INVOICE_LEDGER_ENABLED` = `true`.

> Vercel masks secret **values** after saving — if you cannot confirm a secret is correct, **re-enter (rotate)** it rather than guess.

## 3. Identify rzp_test vs rzp_live
- [ ] **Key ID prefix** is the reliable signal: `rzp_test_` = Test, `rzp_live_` = Live → prod must be `rzp_live_`.
- [ ] **Key SECRET has no visible prefix** — its mode equals the dashboard mode it was generated in. Get both from **Razorpay → Live Mode toggle → Settings → API Keys → Generate Live Keys**. Never mix a live Key ID with a test secret (auth will fail).

## 4. Rotate / set a strong webhook secret (Razorpay Live)
- [ ] Razorpay Dashboard → **toggle to Live Mode**.
- [ ] **Settings → Webhooks** → create or **Edit** the webhook.
- [ ] In **Secret**, paste a strong random 32+ character string (generate it with a password manager).
- [ ] **Save**, copy it once.
- [ ] Paste the identical value into Vercel **Production** `RAZORPAY_WEBHOOK_SECRET`.
- [ ] They must match **byte-for-byte** (a mismatch makes every event fail signature verification → no plan activations).

## 5. Webhook URL
- [ ] In the same Live webhook, set **URL** = `https://kaunkarega.com/api/payments/webhook`.
- [ ] Confirm it is the **Live** webhook and **Active** (Test-mode webhooks are separate).

## 6. Webhook events to enable
- [ ] **`payment.captured`** — required (activates the plan + issues the invoice).
- [ ] **`payment.failed`** — recommended (records the failure + alerts admins).
- [ ] Leave all others off (the app safely ignores and acks them with 200).

## 7. Redeploy after env changes — REQUIRED
- [ ] After **any** env change: **Vercel → Deployments → latest Production → “⋯” → Redeploy** (or push / promote a build).
- [ ] Reason: Vercel snapshots env vars into a deployment; running prod will not pick up new values without a fresh deploy.
- [ ] Wait for the deploy to show **Ready** before testing.

## 8. One low-value live payment verification
> There is no ₹1 plan; the cheapest is **regions_5 (~₹36.58 incl. GST)**. Use it, then refund.
- [ ] With `PAYMENT_ENABLED=true` deployed, log in as a **real provider** (a throwaway provider account is fine) on a real device.
- [ ] Buy the **regions_5** plan → complete a real **UPI** payment.
- [ ] **Razorpay (Live) → Payments**: the payment shows **Captured**.
- [ ] **Razorpay → Webhooks → Recent Deliveries**: the `payment.captured` delivery returned **HTTP 200**.
- [ ] **Refund** the payment from the Razorpay dashboard once verification is done.

## 9. States to check after the test payment
**Razorpay (Live):**
- [ ] Payment = Captured; webhook delivery = 200.

**Admin dashboard (`/admin/dashboard`):**
- [ ] **Payments tab** — the order shows **paid**; a **“New plan subscribed”** admin alert appears (bell / Alerts).
- [ ] **No** **“Payment amount mismatch — not activated”** alert and **no** **“Invoice issuance failed”** alert (their presence means something went wrong → see §10).
- [ ] **Invoices tab** — an invoice exists for the order. If its PDF status is pending, click **Generate PDF**, then confirm it **downloads**.

**Provider dashboard:**
- [ ] Plan card shows the **new plan active**, the **regions** updated, and a **period end ~30 days** out.

**(Optional, read-only DB spot check):** `payment_orders.status = paid`, a `provider_plans` row updated for that provider, an `invoices` row for the order.

## 10. Rollback if payment fails
**A. Stop everything (any serious problem):**
- [ ] Set Vercel Production `PAYMENT_ENABLED` = `false` → **Redeploy** (new orders + webhooks return 503; no further charges/activations).
- [ ] (Optional) In Razorpay, set the Live webhook to **Inactive** to halt deliveries.

**B. By symptom:**
- [ ] **All deliveries 400 (BAD_SIGNATURE):** secrets don't match → redo §4 (identical secret in Razorpay + Vercel), **redeploy**, then **Resend** the failed `payment.captured` events in Razorpay.
- [ ] **“Payment amount mismatch — not activated” alert** (customer paid, no plan): the order is left in `created` → **refund** in Razorpay, or manually activate the correct plan; investigate why the amount differed before re-enabling.
- [ ] **“Invoice issuance failed” alert** (plan active, no invoice): go to **Admin → Invoices → Backfill** to issue it, then **Generate PDF**.
- [ ] **Captured in Razorpay but nothing in the app:** check **Razorpay → Webhooks → Recent Deliveries** for non-200s; fix the cause (URL §5 / secret §4 / deploy §7), then **Resend** the event.
- [ ] **Wrong (test) keys in prod:** real payments won't capture → swap to `rzp_live_` keys (§3), **redeploy**, retest (§8).

---

## Final Go / No-Go
- [ ] §2 all set (Live) · §3 confirmed `rzp_live_` · §4 secret matches & not placeholder · §5 URL = `https://kaunkarega.com/api/payments/webhook` · §6 events on · §7 redeployed.
- [ ] §8 test payment: captured → 200 → plan active → invoice generated → refunded.
- [ ] §9 all green; **no** mismatch / invoice-failure alerts.

**All boxes checked → leave `PAYMENT_ENABLED=true`. Any box fails → set it back to `false` and redeploy.**

---

## Notes (from the code audit)
- Money-crons (including invoice **backfill**) are **not** on an automatic Vercel schedule yet — if an invoice is ever missing, use **Admin → Invoices → Backfill**.
- The webhook safety alerts (`payment_amount_mismatch`, `invoice_issue_failed`) only **surface** problems; an admin still needs to watch the bell / Alerts after go-live.
- The webhook refuses activation when the captured amount is missing/non-numeric or mismatched, and acknowledges with HTTP 200 (the event is not transient), leaving the order in `created` for manual review.
