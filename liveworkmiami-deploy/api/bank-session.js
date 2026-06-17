// api/bank-session.js
// Creates (or reuses) a Stripe Customer and returns a SetupIntent client secret
// configured for us_bank_account via Financial Connections. The browser uses this
// with stripe.collectBankAccountForSetup() to open the secure bank-link UI and
// capture the ACH authorization (mandate) so you can debit them on a schedule.
//
// POST body: { id, email, name }
// Returns:   { clientSecret, customerId }

import { stripe } from '../lib/stripe.js';
import { db, admin } from '../lib/firebase.js';
import { cors } from '../lib/util.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { id, email, name } = req.body || {};
    if (!email) return res.status(400).json({ error: 'email required' });

    const ref = id ? db.collection('memberApplications').doc(id) : null;

    // Reuse an existing Stripe customer if this application already has one.
    let customerId = null;
    if (ref) {
      const snap = await ref.get();
      customerId = snap.exists ? snap.data().stripeCustomerId : null;
    }
    if (!customerId) {
      const customer = await stripe.customers.create({ email, name, metadata: { applicationId: id || '' } });
      customerId = customer.id;
      if (ref) await ref.set({ stripeCustomerId: customerId }, { merge: true });
    }

    // SetupIntent: save the bank account for future off-session ACH debits.
    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['us_bank_account'],
      payment_method_options: {
        us_bank_account: {
          financial_connections: { permissions: ['payment_method', 'balances'] },
          verification_method: 'automatic',
        },
      },
      usage: 'off_session', // lets you charge later without the customer present
    });

    return res.status(200).json({ clientSecret: setupIntent.client_secret, customerId });
  } catch (err) {
    console.error('bank-session error', err);
    return res.status(500).json({ error: 'Could not start bank connection' });
  }
}
