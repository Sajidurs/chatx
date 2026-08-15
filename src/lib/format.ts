/** Formats a Stripe amount (integer cents) as a localized currency string. */
export function formatCurrency(amountCents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amountCents / 100);
}
