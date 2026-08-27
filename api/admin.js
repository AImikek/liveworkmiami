// api/admin.js
// Password-protected admin endpoint for the dashboard (admin.html).
// Set ADMIN_PASSWORD in Vercel env. All requests are POST with { password, action }.
//
// actions:
//   'list'      -> all applications, with EVERY field the applicant entered
//                  (the dashboard decides what to show; nothing is filtered out here)
//   'getFile'   -> { fileId } reassembles a stored document (ID photo, screening
//                  report) from its Firestore chunks and returns it as a data URL
//   'setStatus' -> { id, status }  approve / decline / etc.
//   'charge'    -> { id, chargeType }  trigger move-in or monthly charge

import { db } from '../lib/firebase.js';
import { cors } from '../lib/util.js';

const tsToISO = (t) => (t && typeof t.toDate === 'function') ? t.toDate().toISOString()
  : (typeof t === 'string' ? t : null);

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { password, action, id, status, chargeType, fileId } = req.body || {};
  if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    if (action === 'list') {
      const snap = await db.collection('memberApplications').get();
      const apps = snap.docs.map((d) => {
        const a = d.data();
        // Send the whole record: every field the applicant typed reaches the
        // dashboard. Only the timestamps need converting for JSON.
        return { ...a, id: d.id, createdAt: tsToISO(a.createdAt), updatedAt: tsToISO(a.updatedAt) };
      });
      apps.sort((x, y) => (y.updatedAt || '').localeCompare(x.updatedAt || ''));
      return res.status(200).json({ apps });
    }

    if (action === 'getFile') {
      if (!fileId) return res.status(400).json({ error: 'fileId required' });
      const ref = db.collection('applicationFiles').doc(fileId);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'File not found' });
      const meta = snap.data();
      let b64 = '';
      for (let i = 0; i < (meta.chunkCount || 0); i++) {
        const c = await ref.collection('chunks').doc(String(i)).get();
        b64 += (c.exists && c.data().data) || '';
      }
      return res.status(200).json({
        name: meta.name || 'document',
        type: meta.type || 'application/octet-stream',
        size: meta.size || 0,
        dataUrl: `data:${meta.type || 'application/octet-stream'};base64,${b64}`,
      });
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
