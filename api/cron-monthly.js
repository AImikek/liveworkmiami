// api/cron-monthly.js
// Runs on a schedule (see vercel.json). For every active member it creates a
// 'pendingCharges' record with a one-time token and emails YOU an Approve / Decline
// link. Nothing is pulled until you click Approve (which hits /api/charge).
//
// Vercel triggers this via GET. It is protected by Vercel's cron secret header.

import { db } from '../lib/firebase.js';
import { randomToken, sendEmail, sendSMS } from '../lib/util.js';
import { PRICING } from '../lib/stripe.js';

export default async function handler(req, res) {
  // Vercel cron requests include this; reject anything else.
  if (process.env.CRON_SECRET && req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const origin = process.env.SITE_ORIGIN || `https://${req.headers.host}`;
  const notify = process.env.NOTIFY_EMAIL;
  const amount = PRICING.MEMBERSHIP_FEE;

  // "Active" = submitted + has a connected bank.
  const snap = await db.collection('memberApplications')
    .where('status', '==', 'submitted').get();

  let created = 0;
  for (const doc of snap.docs) {
    const app = doc.data();
    if (!app.stripeCustomerId || !app.paymentMethodId || app.membershipActive === false) continue;

    const token = randomToken();
    await db.collection('pendingCharges').add({
      token, status: 'pending', amount,
      applicationId: doc.id, memberName: app.fullName || app.email,
      customerId: app.stripeCustomerId, paymentMethodId: app.paymentMethodId,
      description: 'LiveWork Miami monthly membership',
      createdAt: new Date().toISOString(),
    });

    const approve = `${origin}/api/charge?token=${token}&action=approve`;
    const decline = `${origin}/api/charge?token=${token}&action=decline`;
    const html = `
      <div style="font-family:system-ui;max-width:520px;color:#17191E">
        <h2 style="font-weight:600">Approve this month's membership charge</h2>
        <p style="color:#5A5C63">Member: <b>${app.fullName || app.email}</b><br>Amount: <b>$${amount.toLocaleString()}</b> via ACH</p>
        <p style="margin:24px 0">
          <a href="${approve}" style="background:#0D7368;color:#fff;text-decoration:none;padding:13px 26px;border-radius:3px;font-weight:600">Approve charge</a>
          &nbsp;&nbsp;
          <a href="${decline}" style="color:#5A5C63">Skip this month</a>
        </p>
        <p style="color:#9aa;font-size:.85rem">Nothing is charged until you click Approve.</p>
      </div>`;
    if (notify) await sendEmail({ to: notify, subject: `Approve ${app.fullName || app.email} - $${amount.toLocaleString()}`, html });
    if (process.env.NOTIFY_PHONE) await sendSMS({ to: process.env.NOTIFY_PHONE, body: `LiveWork Miami: approve ${app.fullName}'s $${amount} charge: ${approve}` });
    created++;
  }

  return res.status(200).json({ ok: true, requested: created });
}
