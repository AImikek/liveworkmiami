// api/application.js
// Saves application data progressively and stores uploaded files (ID photo,
// background check report) directly in Firestore, so they appear in the admin
// dashboard without needing Firebase Storage or the Blaze plan.
//
// POST body:
//   { id?, step, data, files?, chargeMoveIn? }
//     id           - application id (omit on first call; one is created and returned)
//     step         - step number, or 'submit' on final submission
//     data         - the serializable application object from the front-end
//     files        - { backgroundCheck:{name,type,base64,thumb}, id:{name,type,base64,thumb} }
//                    Images are compressed in the browser before upload; thumb is a
//                    small preview data URL shown on the admin card.
//     chargeMoveIn - if true on submit, charge deposit + first month now
//
// File storage model (Firestore only, works on the free Spark plan):
//   applicationFiles/{fileId}                -> { appId, kind, name, type, size, chunkCount, uploadedAt }
//   applicationFiles/{fileId}/chunks/{0..n}  -> { i, data }   (base64 split under the 1 MB doc limit)
//   The application record gets documents.{kind} = { fileId, name, type, size, thumb, uploadedAt }
//   api/admin.js action 'getFile' reassembles the chunks for viewing.
//
// Returns: { id }

import { db, admin } from '../lib/firebase.js';
import { cors, sendEmail } from '../lib/util.js';

export const config = { api: { bodyParser: { sizeLimit: '8mb' } } }; // allow base64 files

const CHUNK = 700000;      // base64 chars per chunk doc (~525 KB binary, safely under Firestore's 1 MB)
const MAX_B64 = 5600000;   // hard cap per file; the browser compresses images far below this

async function deleteStoredFile(fileId) {
  const ref = db.collection('applicationFiles').doc(fileId);
  const snap = await ref.get();
  const n = (snap.exists && snap.data().chunkCount) || 0;
  for (let i = 0; i < n; i++) await ref.collection('chunks').doc(String(i)).delete();
  await ref.delete();
}

async function storeFile(appId, kind, f, oldFileId) {
  const b64 = f.base64 || '';
  if (!b64) return null;
  if (b64.length > MAX_B64) throw new Error(`file too large (${b64.length} base64 chars)`);
  // Replace any previous upload of the same document (cleanup is non-fatal).
  if (oldFileId) {
    try { await deleteStoredFile(oldFileId); } catch (e) { console.warn('old file cleanup failed:', e.message); }
  }
  const fileRef = db.collection('applicationFiles').doc();
  const chunkCount = Math.ceil(b64.length / CHUNK);
  for (let i = 0; i < chunkCount; i++) {
    await fileRef.collection('chunks').doc(String(i)).set({ i, data: b64.slice(i * CHUNK, (i + 1) * CHUNK) });
  }
  const meta = {
    appId, kind,
    name: f.name || kind,
    type: f.type || 'application/octet-stream',
    size: Math.round(b64.length * 3 / 4),
    chunkCount,
    uploadedAt: new Date().toISOString(),
  };
  await fileRef.set(meta);
  // What the admin list renders directly from the application record.
  return {
    fileId: fileRef.id, name: meta.name, type: meta.type, size: meta.size, uploadedAt: meta.uploadedAt,
    ...(typeof f.thumb === 'string' && f.thumb.startsWith('data:') && f.thumb.length <= 120000 ? { thumb: f.thumb } : {}),
  };
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { id, step, data = {}, files, chargeMoveIn } = req.body || {};
    const ref = id ? db.collection('memberApplications').doc(id)
                   : db.collection('memberApplications').doc();

    // Store any uploaded files in Firestore, collecting their metadata.
    // Non-fatal: if a file fails, the application still saves and the
    // notification still fires; we just skip that document.
    const fileMeta = {};
    if (files && Object.values(files).some(f => f && f.base64)) {
      let existingDocs = {};
      try {
        const cur = await ref.get();
        existingDocs = (cur.exists && cur.data().documents) || {};
      } catch (_) {}
      for (const [kind, f] of Object.entries(files)) {
        if (!f || !f.base64) continue;
        try {
          const meta = await storeFile(ref.id, kind, f, existingDocs[kind] && existingDocs[kind].fileId);
          if (meta) fileMeta[kind] = meta;
        } catch (e) {
          console.error(`file store failed for ${kind}:`, e.message);
        }
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
    // Signature evidence: record the signer's IP server-side whenever a save
    // carries a completed signature (part of the e-sign audit trail).
    if (data && data.signature && data.signedAtISO) {
      payload.signatureIP = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
        || (req.socket && req.socket.remoteAddress) || '';
    }

    await ref.set(payload, { merge: true });

    // On final submit, notify Mike so he can create the Mercury invoice.
    if (step === 'submit') {
      try {
        const p = data.plan || {};
        const addons = (p.addons || []).join(', ') || 'none';
        const notify = process.env.NOTIFY_EMAIL;
        if (notify) {
          await sendEmail({
            to: notify,
            subject: `New LiveWork member ready to invoice — ${data.fullName || 'Applicant'}`,
            html: `
              <h2>New application submitted — ready for Mercury invoice</h2>
              <p><b>${data.fullName || ''}</b> &lt;${data.email || ''}&gt; · ${data.phone || ''}</p>
              <p><b>Occupation:</b> ${data.occupation || ''} ${data.company ? '· ' + data.company : ''}</p>
              <hr>
              <p><b>Plan:</b> ${p.termLabel || ''} · $${p.monthlyTotal || ''}/mo${p.discountPct ? ' (' + p.discountPct + '% off)' : ''}</p>
              <p><b>Add-ons:</b> ${addons}</p>
              <p><b>Deposit:</b> $${p.deposit || ''} · <b>Last month:</b> ${p.hasLastMonth ? '$' + p.monthlyTotal : 'none'}</p>
              <p><b>Due prior to move-in:</b> $${p.dueAtMoveIn || ''}</p>
              <p><b>Pay preference:</b> ${data.paymentMethod === 'wire' ? 'Wire' : 'ACH'}</p>
              <p><b>Mailing address:</b> ${data.mailingAddress || ''}</p>
              <hr>
              <p>Create and send the Mercury invoice to ${data.email || ''} for $${p.dueAtMoveIn || ''}. Review the full application in your admin dashboard.</p>`
          });
        }
      } catch (e) { console.error('notify email failed', e); }
    }

    // (Stripe automation path — only if a charge was requested.)
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
