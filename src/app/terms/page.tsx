import Link from "next/link";
import { LogoMark } from "../dashboard/logo-mark";

export const metadata = {
  title: "Terms of Service — Falah Chat",
};

const LAST_UPDATED = "August 20, 2026";

export default function TermsPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-4 py-12 sm:py-16">
      <Link href="/" className="flex w-fit items-center gap-2">
        <LogoMark />
        <span className="text-base font-semibold tracking-tight">Falah Chat</span>
      </Link>

      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Terms of Service</h1>
        <p className="text-sm text-gray-500">Last updated: {LAST_UPDATED}</p>
      </div>

      <div className="flex flex-col gap-6 text-sm leading-relaxed text-gray-700 [&_h2]:mt-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-gray-900 [&_p]:text-gray-700 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
        <p>
          These terms govern your use of Falah Chat, an AI chat assistant that businesses embed on their own websites. By creating an
          account or using Falah Chat, you agree to these terms.
        </p>

        <section>
          <h2>The service</h2>
          <p>
            Falah Chat lets a business train an AI assistant on its own documents, embed it as a chat widget on its website, and
            optionally connect a Google Calendar so the assistant can check availability and book, cancel, or reschedule meetings.
            Plans, features, and message limits vary by the subscription tier chosen at sign-up.
          </p>
        </section>

        <section>
          <h2>Your account</h2>
          <ul>
            <li>You&apos;re responsible for the accuracy of the information you provide, and for keeping your account credentials secure.</li>
            <li>You&apos;re responsible for the content you train your assistant on, and for how your assistant is configured to represent your business.</li>
            <li>You must have the right to use any documents or content you upload for training.</li>
          </ul>
        </section>

        <section>
          <h2>Acceptable use</h2>
          <p>You agree not to use Falah Chat to:</p>
          <ul>
            <li>Train an assistant to impersonate a real person, deceive visitors about who or what they&apos;re talking to in a harmful way, or collect information unlawfully.</li>
            <li>Send spam, or use the chat widget to harass or defraud visitors.</li>
            <li>Attempt to access another business&apos;s account, data, or conversations.</li>
            <li>Disrupt or overload the service, or reverse-engineer it beyond what&apos;s permitted by applicable law.</li>
          </ul>
        </section>

        <section>
          <h2>Google Calendar integration</h2>
          <p>
            If you connect a Google Calendar, you&apos;re authorizing Falah Chat&apos;s assistant to check availability and create,
            modify, or cancel events on that calendar as part of the chat conversation flow. You can disconnect the calendar from your
            dashboard at any time, which revokes that access.
          </p>
        </section>

        <section>
          <h2>Billing</h2>
          <ul>
            <li>Paid plans are billed on a recurring basis through Stripe. Prices are shown at checkout before you subscribe.</li>
            <li>If a payment fails, your account may be restricted after a grace period until the issue is resolved.</li>
            <li>You can change or cancel your plan at any time from your dashboard.</li>
          </ul>
        </section>

        <section>
          <h2>AI-generated content</h2>
          <p>
            Falah Chat&apos;s assistant generates replies using AI based on the content you train it on and the conversation itself.
            While we work to make replies accurate and helpful, AI-generated responses can occasionally be incorrect or
            incomplete. You&apos;re responsible for reviewing your assistant&apos;s configuration and for how your business relies on
            its replies with real customers.
          </p>
        </section>

        <section>
          <h2>Availability</h2>
          <p>
            We aim to keep Falah Chat available and reliable, but we don&apos;t guarantee uninterrupted service, and we&apos;re not
            liable for losses arising from downtime, third-party service outages (such as our AI or calendar providers), or issues
            outside our reasonable control.
          </p>
        </section>

        <section>
          <h2>Termination</h2>
          <p>
            You can close your account at any time. We may suspend or terminate an account that violates these terms, including the
            acceptable use section above.
          </p>
        </section>

        <section>
          <h2>Changes to these terms</h2>
          <p>If these terms change in a meaningful way, we&apos;ll update the date at the top of this page.</p>
        </section>

        <section>
          <h2>Contact us</h2>
          <p>
            Questions about these terms can be sent to{" "}
            <a href="mailto:SRahman@my-boost.ca" className="text-brand-700 underline">
              SRahman@my-boost.ca
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
