// lib/pricing.js
// Server-side source of truth. The browser computes prices for display, but the
// charge is always recomputed here from the plan's inputs (term, addons, code),
// so a tampered client cannot change what gets charged.
//
// Keep these in sync with the CONFIG block in index.html.

export const BASE_BY_TERM = { '12': 2500, '6': 2750, 'mtm': 3000 };
export const ALL_THREE_FLAT = 4000;

// Discount codes: CODE -> percent off. Add or remove codes here.
export const DISCOUNT_CODES = { 'JAMES16': 16 };

export function baseMonthly(plan = {}) {
  const addons = plan.addons || [];
  if (addons.length === 3) return ALL_THREE_FLAT;
  return (BASE_BY_TERM[plan.term] ?? BASE_BY_TERM['mtm']) + addons.length * 500;
}
export function discountPct(plan = {}) {
  const code = String(plan.discountCode || '').trim().toUpperCase();
  return DISCOUNT_CODES[code] || 0;
}
export function monthly(plan = {}) {
  return Math.round(baseMonthly(plan) * (1 - discountPct(plan) / 100));
}
export const deposit = (plan = {}) => monthly(plan);          // deposit = one month
export const hasLastMonth = (plan = {}) => plan.term !== 'mtm'; // 6 & 12 mo only
export function dueAtMoveIn(plan = {}) {
  const m = monthly(plan);
  return m /*first*/ + deposit(plan) + (hasLastMonth(plan) ? m : 0);
}
