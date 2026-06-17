// api/admin.js
// Password-protected admin endpoint for the dashboard (admin.html).
// Set ADMIN_PASSWORD in Vercel env. All requests are POST with { password, action }.
//
// actions:
//   'list'      -> all applications (with short-lived signed URLs for documents)
//   'setStatus' -> { id, status }  approve / decline / etc.
//   'charge'    -> { id, chargeType }  trigger move-in or monthly charge

import { db, bucket } from '../lib/firebase.js';
import { cors } from '../lib/util.js';

const tsToISO = (t) => (t && typeof t.toDate === 'function') ? t.toDate().toISOString() : null;

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { password, action, id, status, chargeType } = req.body || {};
  if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    if (action === 'list') {
      const snap = await db.collection('memberApplications').get();
      const apps = await Promise.all(snap.docs.map(async (d) => {
        const a = d.data();
        const documents = {};
        if (a.documents) {
          for (const [k, v] of Object.entries(a.documents)) {
            try {
              const [url] = await bucket.file(v.path).getSignedUrl({ action: 'read', expires: Date.now() + 3600 * 1000 });
              documents[k] = { name: v.name, url };
            } catch { documents[k] = { name: v.name }; }
          }
        }
        return {
          id: d.id,
          fullName: a.fullName || '', email: a.email || '', phone: a.phone || '',
          occupation: a.occupation || '', company: a.company || '', about: a.about || '',
          plan: a.plan || null, status: a.status || 'in_progress',
          bankConnected: !!a.bankConnected, bgAuthorize: !!a.bgAuthorize,
          signature: a.signature || '', signedAt: a.signedAt || '',
          ec1Name: a.ec1Name || '', ec1Phone: a.ec1Phone || '',
          moveInCharge: a.moveInCharge || null,
          documents,
          createdAt: tsToISO(a.createdAt), updatedAt: tsToISO(a.updatedAt),
        };
      }));
      apps.sort((x, y) => (y.updatedAt || '').localeCompare(x.updatedAt || ''));
      return res.status(200).json({ apps });
    }

    if (action === 'setStatus') {
      if (!id || !status) return res.status(400).json({ error: 'id and status required' });
      await db.collection('memberApplications').doc(id).set(
        { status, decidedAt: new Date().toISOString() }, { merge: true }
      );
      return res.status(200).json({ ok: true });
    }

    if (action === 'charge') {
      if (!id) return res.status(400).json({ error: 'id required' });
      const origin = `https://${req.headers.host}`;
      const r = await fetch(`${origin}/api/charge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SECRET || '' },
        body: JSON.stringify({ applicationId: id, type: chargeType || 'monthly' }),
      });
      const j = await r.json();
      return res.status(r.status).json(j);
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('admin error', err);
    return res.status(500).json({ error: err.message });
  }
}
