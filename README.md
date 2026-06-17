# LiveWork Miami

Members site + onboarding (details, background check, ID, agreement, bank connect)
with Stripe ACH and Firebase on the backend.

```
index.html              the site + onboarding flow (front-end)
admin.html              admin dashboard — review applicants, approve, charge
photos/                 the site photos
api/
  application.js        save application + upload files to Firestore/Storage
  bank-session.js       create Stripe bank-connect session (ACH mandate)
  charge.js             move-in charge + approve-then-charge monthly flow
  cron-monthly.js       emails you Approve/Decline links each month
  admin.js              powers admin.html (password-protected)
lib/                    shared Firebase, Stripe, pricing, and util helpers
vercel.json             schedules the monthly cron
.env.example            the environment variables you need to set
```

## Admin dashboard

Visit `your-domain.com/admin.html`, enter your `ADMIN_PASSWORD`, and you get every
applicant: their plan, signature, background/bank status, document links (secure,
expire in 1 hour), and buttons to **approve**, **decline**, **charge move-in**, or
**charge one month**. This is the easiest way to review and act on applications without
opening Firebase.

## How the money works

- **Pricing** is built on the page (term + add-ons + optional discount code). Base by
  term: 12mo $2,500, 6mo $2,750, month-to-month $3,000. Each add-on +$500; all three
  flat $4,000. Deposit equals one month. Last month is collected in advance on 6- and
  12-month terms only.
- **Discount codes** live in `lib/pricing.js` (`DISCOUNT_CODES`, e.g. `JAMES16: 16`) and
  in the `CONFIG.DISCOUNT_CODES` block in `index.html`. Keep the two in sync. The browser
  shows the discounted price, but every charge is **recomputed server-side** from the
  plan inputs, so a tampered client cannot change the amount.
- **Bank connect** (`bank-session.js`): the member links their bank through Stripe's
  secure UI. A SetupIntent saves the account with an **ACH mandate** = your written
  authorization to debit them later.
- **Move-in** (`charge.js` type `movein`): right after they connect, it pulls
  deposit + first month in one ACH charge.
- **Monthly, with your approval** (`cron-monthly.js` → `charge.js`): on the 1st, the
  cron emails you one **Approve / Decline** link per member. Nothing is pulled until
  you click Approve. (Prefer full auto? Call `charge.js` with type `monthly` and skip
  the cron.)
- ACH settles in **1-4 business days**. To know an ACH payment finally succeeded or
  bounced, add a Stripe webhook later (listen for `payment_intent.succeeded` /
  `payment_intent.payment_failed`).

## Deploy (one time)

1. **Put the publishable key in the site.** In `index.html`, set
   `CONFIG.STRIPE_PUBLISHABLE_KEY` to your `pk_live_…` (or `pk_test_…`) key.
2. **Push to GitHub**, then in Vercel: **Add New → Project → import the repo.**
   (Or run `vercel` from this folder with the CLI.)
3. **Add environment variables** in Vercel → Settings → Environment Variables,
   using `.env.example` as the checklist. Redeploy after adding them.
4. **Custom domain**: Settings → Domains → add `liveworkmiami.com`, then at your
   registrar set an A record `@ → 76.76.21.21` and CNAME `www → cname.vercel-dns.com`.

## Firebase setup

1. Use your existing project `house-manager-3506`.
2. Enable **Firestore** and **Storage** if not already on.
3. Service account key: Project settings → Service accounts → Generate new private
   key → copy the three values into the Firebase env vars.
4. Keep Storage **private** — ID and background-check files must not be public.
   Access them from the Firebase console or generate short-lived signed URLs server-side.

## Accounts you'll need

- **Stripe** (stripe.com) — turn on ACH Direct Debit + Financial Connections in the
  dashboard. Apply for live mode when ready.
- **Resend** (resend.com) — free email API for the approval links. One key.
- **Twilio** (optional) — only if you also want a text.

## Local notes

- The front-end already calls these endpoints and falls back to a harmless demo if the
  backend is unreachable, so the page previews fine before the API is live.
- Money amounts live in two places that must agree: `index.html` CONFIG and the
  `MEMBERSHIP_FEE` / `SECURITY_DEPOSIT` env vars.

## Legal

The agreement text and deposit handling are a starting template. Florida has specific
rules for holding security deposits, and ACH debits require the signed authorization
the agreement captures. Have an attorney review before you go live.
