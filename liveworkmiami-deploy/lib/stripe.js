// lib/stripe.js
import Stripe from 'stripe';

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

// Dollars -> cents (Stripe works in the smallest currency unit).
export const toCents = (dollars) => Math.round(Number(dollars) * 100);

// These mirror the numbers in your front-end CONFIG. Keep them in sync,
// or better, store per-member amounts on the Firestore application doc.
export const PRICING = {
  MEMBERSHIP_FEE:   Number(process.env.MEMBERSHIP_FEE   || 3500),
  SECURITY_DEPOSIT: Number(process.env.SECURITY_DEPOSIT || 3500),
  COLLECT_LAST_MONTH: process.env.COLLECT_LAST_MONTH === 'true',
};
