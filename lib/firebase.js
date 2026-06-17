// lib/firebase.js
// Initializes Firebase Admin once per serverless instance.
// Credentials come from environment variables (set in Vercel → Settings → Environment Variables).
// You need a service-account key from:
//   Firebase Console → Project settings → Service accounts → Generate new private key
// Then paste these three values into Vercel env vars.

import admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // The private key in env vars keeps literal "\n"; turn them back into newlines.
      privateKey:  (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET, // e.g. house-manager-3506.appspot.com
  });
}

export const db = admin.firestore();
export const bucket = admin.storage().bucket();
export { admin };
