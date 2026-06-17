// lib/stripe.js
import Stripe from 'stripe';

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

// Dollars -> cents (Stripe works in the smallest currency unit).
export const toCents = (dollars) => Math.round(Number(dollars) * 100);

// Used only as a fallback if a member record has no saved plan.
// Real amounts come from the member's selected plan (plan.monthlyTotal).
export const PRICING = {
  MEMBERSHIP_FEE:   Number(process.env.MEMBERSHIP_FEE   || 2750),
  SECURITY_DEPOSIT: Number(process.env.SECURITY_DEPOSIT || 2000),
};
