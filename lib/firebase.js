// lib/firebase.js
// Initializes Firebase Admin once per serverless instance.
//
// EASIEST SETUP (recommended):
//   1. Firebase Console → Project settings → Service accounts → Generate new private key
//   2. Open the downloaded .json file, Select All (Cmd+A), Copy.
//   3. In Vercel → Environment Variables, create ONE variable:
//        FIREBASE_SERVICE_ACCOUNT  =  (paste the entire JSON here)
//   4. Redeploy. Done — no other Firebase variables needed.
//
// (Legacy fallback: the three separate vars FIREBASE_PROJECT_ID,
//  FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY still work if set correctly.)

import admin from 'firebase-admin';

function credentials() {
  const blob = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (blob) {
    // Whole service-account JSON pasted as one value. Most reliable.
    const sa = JSON.parse(blob);
    return {
      credential: admin.credential.cert(sa),
      projectId: sa.project_id,
    };
  }
  // Fallback: three separate variables.
  return {
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // The private key in env vars keeps literal "\n"; turn them back into newlines.
      privateKey:  (process.env.FIREBASE_PRIVATE_KEY || '')
                     .replace(/^["']|["']$/g, '')   // strip accidental wrapping quotes
                     .replace(/\\n/g, '\n'),
    }),
    projectId: process.env.FIREBASE_PROJECT_ID,
  };
}

if (!admin.apps.length) {
  const c = credentials();
  admin.initializeApp({
    credential: c.credential,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET
      || (c.projectId ? `${c.projectId}.firebasestorage.app` : undefined),
  });
}

export const db = admin.firestore();
export const bucket = admin.storage().bucket();
export { admin };
