// lib/util.js
import crypto from 'crypto';

// Allow your own site to call these functions from the browser.
export function cors(req, res) {
  const allowed = process.env.SITE_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}

export const randomToken = () => crypto.randomBytes(24).toString('hex');

// Send an email via Resend (https://resend.com — free tier, one API key, no SDK needed).
// Set RESEND_API_KEY and NOTIFY_EMAIL (where you want approval requests to land).
// Swap this single function for SendGrid/Postmark/Twilio if you prefer.
export async function sendEmail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY) { console.warn('No RESEND_API_KEY set; skipping email'); return; }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.FROM_EMAIL || 'LiveWork Miami <onboarding@resend.dev>',
      to: [to], subject, html,
    }),
  });
  if (!r.ok) console.error('Email send failed', await r.text());
}

// Optional: text message via Twilio. Fill the three env vars to enable.
export async function sendSMS({ to, body }) {
  const { TWILIO_SID, TWILIO_AUTH, TWILIO_FROM } = process.env;
  if (!TWILIO_SID || !TWILIO_AUTH || !TWILIO_FROM) return;
  const creds = Buffer.from(`${TWILIO_SID}:${TWILIO_AUTH}`).toString('base64');
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: TWILIO_FROM, Body: body }),
  });
}
