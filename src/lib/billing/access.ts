// How long a business keeps access after a failed payment before we cut it
// off. This is our own risk tolerance, independent of Stripe's own retry
// schedule (which can take much longer to give up and cancel the subscription
// outright via customer.subscription.deleted).
export const GRACE_PERIOD_DAYS = 3;

export type BusinessAccessFields = {
  status: "active" | "past_due" | "cancelled";
  past_due_at: string | null;
};

/**
 * Whether a business's access should currently be restricted. "Restricted" is
 * computed at read time rather than stored as its own status: 'cancelled' is
 * always restricted, 'past_due' is restricted only once the grace period has
 * elapsed, 'active' never is.
 */
export function isBusinessRestricted(business: BusinessAccessFields): boolean {
  if (business.status === "cancelled") return true;
  if (business.status === "active") return false;

  if (!business.past_due_at) return false;
  const elapsedMs = Date.now() - new Date(business.past_due_at).getTime();
  const graceMs = GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;
  return elapsedMs > graceMs;
}
