// lib/pricing.js
// Server-side source of truth. The browser computes prices for display, but the
// charge is always recomputed here from the plan's term, so a tampered client
// cannot change what gets charged.
//
// All-inclusive pricing: every membership includes cleaning, laundry,
// receiving orders, and meal prep. Keep in sync with CONFIG in index.html.

export const BASE_BY_TERM = { '12': 4000, '6': 4500, 'mtm': 5500 };

export function monthly(plan = {}) {
  return BASE_BY_TERM[plan.term] ?? BASE_BY_TERM['mtm'];
}
export const deposit = (plan = {}) => monthly(plan);            // deposit = one month
export const hasLastMonth = (plan = {}) => plan.term !== 'mtm'; // 6 & 12 mo only
export function dueAtMoveIn(plan = {}) {
  const m = monthly(plan);
  return m /*first*/ + deposit(plan) + (hasLastMonth(plan) ? m : 0);
}
