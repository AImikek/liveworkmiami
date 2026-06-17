// api/charge.js
// One endpoint, three jobs:
//
//  1) POST { applicationId, type:'movein' }            (internal)
//       Charges deposit + first month right after bank connect. Called by
//       api/application.js on submit.
//
//  2) GET  ?token=...&action=approve|decline           (the email link you click)
//       Your monthly "confirm before withdrawal" step. Approving creates the ACH
//       PaymentIntent; declining marks it skipped. Nothing pulls until you approve.
//
//  3) POST { applicationId, type:'monthly' }           (internal, optional)
//       Charge the monthly membership directly (e.g. if you prefer auto-charge).
//
// ACH pulls take 1-4 business days to settle; the PaymentIntent starts as
// 'processing' and a webhook (not included here) would confirm final success.

import { stripe, toCents, PRICING } from '../lib/stripe.js';
import { db, admin } from '../lib/firebase.js';
import { cors } from '../lib/util.js';

async function chargeBank({ customerId, paymentMethodId, amountDollars, description, metadata }) {
  return stripe.paymentIntents.create({
    amount: toCents(amountDollars),
    currency: 'usd',
    customer: customerId,
    payment_method: paymentMethodId,
    payment_method_types: ['us_bank_account'],
    confirm: true,
    off_session: true,         // customer not present; relies on the saved mandate
    description,
    metadata,
  });
}

export default async function handler(req, res) {
  if (cors(req, res)) return;

  // ---- 2) APPROVAL LINK (GET) ----
  if (req.method === 'GET') {
    const { token, action } = req.query;
    if (!token) return res.status(400).send('Missing token');

    const q = await db.collection('pendingCharges').where('token', '==', token).limit(1).get();
    if (q.empty) return res.status(404).send('This approval link is no longer valid.');
    const docRef = q.docs[0].ref;
    const pc = q.docs[0].data();
    if (pc.status !== 'pending') return res.status(200).send(`Already ${pc.status}.`);

    if (action === 'decline') {
      await docRef.set({ status: 'declined', decidedAt: new Date().toISOString() }, { merge: true });
      return res.status(200).send(page('Charge declined', `The ${money(pc.amount)} charge for ${esc(pc.memberName)} was skipped.`));
    }

    try {
      const pi = await chargeBank({
        customerId: pc.customerId, paymentMethodId: pc.paymentMethodId,
        amountDollars: pc.amount, description: pc.description || 'LiveWork Miami membership',
        metadata: { applicationId: pc.applicationId, kind: 'monthly' },
      });
      await docRef.set({ status: 'charged', paymentIntentId: pi.id, decidedAt: new Date().toISOString() }, { merge: true });
      return res.status(200).send(page('Charge approved',
        `${money(pc.amount)} is now being collected from ${esc(pc.memberName)} by ACH. It settles in 1-4 business days.`));
    } catch (err) {
      console.error('approve charge failed', err);
      await docRef.set({ status: 'failed', error: err.message, decidedAt: new Date().toISOString() }, { merge: true });
      return res.status(200).send(page('Charge failed', esc(err.message)));
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Internal POSTs must carry the shared secret.
  if ((req.headers['x-internal-secret'] || '') !== (process.env.INTERNAL_SECRET || '')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { applicationId, type } = req.body || {};
    const snap = await db.collection('memberApplications').doc(applicationId).get();
    if (!snap.exists) return res.status(404).json({ error: 'Application not found' });
    const app = snap.data();
    const { stripeCustomerId: customerId, paymentMethodId, fullName } = app;
    if (!customerId || !paymentMethodId) return res.status(400).json({ error: 'No connected bank on file' });

    // ---- 1) MOVE-IN: deposit + first month (+ optional last month) ----
    if (type === 'movein') {
      let amount = PRICING.MEMBERSHIP_FEE + PRICING.SECURITY_DEPOSIT;
      if (PRICING.COLLECT_LAST_MONTH) amount += PRICING.MEMBERSHIP_FEE;
      const pi = await chargeBank({
        customerId, paymentMethodId, amountDollars: amount,
        description: 'LiveWork Miami move-in (deposit + first month)',
        metadata: { applicationId, kind: 'movein' },
      });
      await snap.ref.set({ moveInCharge: { paymentIntentId: pi.id, amount, at: new Date().toISOString() } }, { merge: true });
      return res.status(200).json({ ok: true, paymentIntentId: pi.id, amount });
    }

    // ---- 3) MONTHLY direct charge (optional auto path) ----
    if (type === 'monthly') {
      const pi = await chargeBank({
        customerId, paymentMethodId, amountDollars: PRICING.MEMBERSHIP_FEE,
        description: 'LiveWork Miami monthly membership',
        metadata: { applicationId, kind: 'monthly' },
      });
      return res.status(200).json({ ok: true, paymentIntentId: pi.id });
    }

    return res.status(400).json({ error: 'Unknown charge type' });
  } catch (err) {
    console.error('charge error', err);
    return res.status(500).json({ error: err.message });
  }
}

/* tiny helpers for the approval-link confirmation pages */
const money = (n) => '$' + Number(n).toLocaleString('en-US');
const esc = (s) => String(s || '').replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
const page = (title, body) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<div style="font-family:system-ui;max-width:520px;margin:18vh auto;padding:0 24px;text-align:center;color:#17191E">
<h1 style="font-weight:600;font-size:1.6rem">${esc(title)}</h1><p style="color:#5A5C63;font-size:1.05rem">${body}</p>
<p style="color:#0D7368;font-weight:600;margin-top:24px">LiveWork Miami</p></div>`;
