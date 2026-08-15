import "server-only";
import { Resend } from "resend";

// Must be a domain verified in the Resend dashboard before this will send in
// production; Resend's shared sandbox sender works for local/test sends.
const FROM_ADDRESS = process.env.RESEND_FROM_ADDRESS || "chatx <onboarding@resend.dev>";

export async function sendInvoiceUpcomingReminder(params: {
  to: string;
  businessName: string;
  amountDue: string;
  dueDate: string;
}) {
  // Constructed lazily (not at module load) so importing this file doesn't
  // throw in environments where RESEND_API_KEY isn't set yet (e.g. builds
  // before the key has been provisioned).
  const resend = new Resend(process.env.RESEND_API_KEY);
  return resend.emails.send({
    from: FROM_ADDRESS,
    to: params.to,
    subject: `Upcoming renewal for ${params.businessName}`,
    text: `Your ${params.businessName} subscription will renew soon.\n\nAmount due: ${params.amountDue}\nRenewal date: ${params.dueDate}\n\nNo action is needed if your payment method is up to date.`,
  });
}
