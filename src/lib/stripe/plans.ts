import "server-only";

export type Plan = "free" | "starter" | "pro";

export const PLAN_PRICE_IDS: Record<Plan, string> = {
  free: process.env.STRIPE_PRICE_FREE!,
  starter: process.env.STRIPE_PRICE_STARTER!,
  pro: process.env.STRIPE_PRICE_PRO!,
};

const PRICE_ID_TO_PLAN: Record<string, Plan> = Object.fromEntries(
  Object.entries(PLAN_PRICE_IDS).map(([plan, priceId]) => [priceId, plan as Plan])
);

export function planForPriceId(priceId: string): Plan | undefined {
  return PRICE_ID_TO_PLAN[priceId];
}

export function isPlan(value: string): value is Plan {
  return value === "free" || value === "starter" || value === "pro";
}

// Cheapest to priciest -- used to tell an upgrade (bill immediately) apart
// from a downgrade (never bill, only credit) when changing an existing
// subscription's price in place.
const PLAN_RANK: Record<Plan, number> = { free: 0, starter: 1, pro: 2 };

export function isPlanUpgrade(from: Plan, to: Plan): boolean {
  return PLAN_RANK[to] > PLAN_RANK[from];
}
