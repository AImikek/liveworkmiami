// api/application.js
// Saves application data progressively, stores uploaded files (ID, background
// check) in Firebase Storage, and on final submit can trigger the move-in charge.
//
// POST body:
//   { id?, step, data, files?, chargeMoveIn? }
//     id           - application id (omit on first call; one is created and returned)
//     step         - step number, or 'submit' on final submission
//     data         - the serializable application object from the front-end
//     files        - { backgroundCheck:{name,type,base64}, id:{name,type,base64} }
//     chargeMoveIn - if true on submit, charge deposit + first month now
//
// Returns: { id }

import { db, bucket, admin } from '../lib/firebase.js';
import { cors } from '../lib/util.js';

export const config = { api: { bodyParser: { sizeLimit: '8mb' } } }; // allow base64 files

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { id, step, data = {}, files, chargeMoveIn } = req.body || {};
    const ref = id ? db.collection('memberApplications').doc(id)
                   : db.collection('memberApplications').doc();

    // Upload any files first, collecting their storage paths.
    const fileMeta = {};
    if (files) {
      for (const [kind, f] of Object.entries(files)) {
        if (!f || !f.base64) continue;
        const safe = (f.name || kind).replace(/[^\w.\-]/g, '_');
        const path = `applications/${ref.id}/${kind}-${Date.now()}-${safe}`;
        const file = bucket.file(path);
        await file.save(Buffer.from(f.base64, 'base64'), {
          contentType: f.type || 'application/octet-stream',
          // Private by default. These are sensitive documents — do NOT make public.
          resumable: false,
        });
        fileMeta[kind] = { path, name: f.name, uploadedAt: new Date().toISOString() };
      }
    }

    // Build the record. Never trust the client for status fields.
    const payload = {
      ...data,
      ...(Object.keys(fileMeta).length ? { documents: fileMeta } : {}),
      status: step === 'submit' ? 'submitted' : 'in_progress',
      lastStep: step,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (!id) payload.createdAt = admin.firestore.FieldValue.serverTimestamp();

    await ref.set(payload, { merge: true });

    // On final submit, optionally run the move-in charge (deposit + first month).
    if (step === 'submit' && chargeMoveIn) {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/charge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SECRET || '' },
          body: JSON.stringify({ applicationId: ref.id, type: 'movein' }),
        });
      } catch (e) { console.error('move-in charge trigger failed', e); }
    }

    return res.status(200).json({ id: ref.id });
  } catch (err) {
    console.error('application error', err);
    return res.status(500).json({ error: 'Could not save application' });
  }
}
