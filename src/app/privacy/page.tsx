import Link from "next/link";
import { LogoMark } from "../dashboard/logo-mark";

export const metadata = {
  title: "Privacy Policy — Falah Chat",
};

const LAST_UPDATED = "August 20, 2026";

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-4 py-12 sm:py-16">
      <Link href="/" className="flex w-fit items-center gap-2">
        <LogoMark />
        <span className="text-base font-semibold tracking-tight">Falah Chat</span>
      </Link>

      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Privacy Policy</h1>
        <p className="text-sm text-gray-500">Last updated: {LAST_UPDATED}</p>
      </div>

      <div className="flex flex-col gap-6 text-sm leading-relaxed text-gray-700 [&_h2]:mt-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-gray-900 [&_p]:text-gray-700 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
        <p>
          Falah Chat (&quot;Falah Chat,&quot; &quot;we,&quot; &quot;us&quot;) provides an AI chat assistant that businesses embed on their own
          websites, train on their own documents, and optionally connect to Google Calendar for scheduling. This policy explains what
          information we collect, why, and how it&apos;s used -- for both the businesses who sign up for Falah Chat (&quot;business
          customers&quot;) and the visitors who chat with a business customer&apos;s assistant (&quot;visitors&quot;).
        </p>

        <section>
          <h2>Information we collect</h2>
          <p>From a business customer who creates an account, we collect:</p>
          <ul>
            <li>Account details: email address and password (handled by our authentication provider), business name.</li>
            <li>Assistant configuration: the persona, instructions, and any documents or text uploaded to train the assistant.</li>
            <li>Billing details: plan selection and subscription status. Card numbers are never sent to or stored by us -- payment is handled entirely by Stripe.</li>
            <li>
              If a Google Calendar is connected: a security-encrypted access token that lets the assistant check availability and
              create, cancel, or reschedule calendar events on that business&apos;s behalf. We never see the Google account password
              itself.
            </li>
          </ul>
          <p>From a visitor chatting with a business&apos;s assistant, we collect:</p>
          <ul>
            <li>The messages sent in the conversation, and the assistant&apos;s replies, so the conversation can continue coherently and the business can review it later.</li>
            <li>If the business&apos;s chat asks for it before starting a conversation: the visitor&apos;s name and email address.</li>
            <li>If a booking is made through the chat: the name and contact information (email or phone) given for that booking.</li>
            <li>A randomly generated identifier stored in the visitor&apos;s browser (not a real-world identity) so a returning visitor&apos;s conversation history can be shown to them again.</li>
          </ul>
        </section>

        <section>
          <h2>How we use this information</h2>
          <ul>
            <li>To operate the chat assistant: generating replies, retrieving relevant information from a business&apos;s trained documents, and checking or managing calendar bookings.</li>
            <li>To let a business customer review conversations, leads, and bookings in their own dashboard.</li>
            <li>To send account, billing, and (if enabled) handoff notification emails.</li>
            <li>To enforce plan limits (such as monthly message quotas) and prevent abuse.</li>
            <li>To fix bugs and improve the product.</li>
          </ul>
          <p>We do not sell personal information, and we do not use visitor conversations to serve advertising.</p>
        </section>

        <section>
          <h2>Who we share information with</h2>
          <p>
            We use a small number of service providers to operate Falah Chat, each of which processes data only as needed to provide
            their service to us:
          </p>
          <ul>
            <li>
              <strong>Anthropic</strong> and <strong>Voyage AI</strong> -- process conversation content to generate the assistant&apos;s
              replies and to search a business&apos;s trained documents.
            </li>
            <li><strong>Google</strong> -- for businesses that connect a calendar, to check availability and manage calendar events.</li>
            <li><strong>Stripe</strong> -- processes subscription payments.</li>
            <li><strong>Resend</strong> -- delivers transactional emails (account, billing, handoff notifications).</li>
            <li><strong>Supabase</strong> and <strong>Vercel</strong> -- host our database and application infrastructure.</li>
          </ul>
          <p>We don&apos;t share data with anyone else, except where required by law.</p>
        </section>

        <section>
          <h2>Data isolation between businesses</h2>
          <p>
            Each business customer&apos;s data -- conversations, documents, leads, bookings -- is kept isolated from every other
            business customer&apos;s data at the database level. A business can only ever see its own.
          </p>
        </section>

        <section>
          <h2>How long we keep information</h2>
          <p>
            We retain account and conversation data for as long as a business customer&apos;s account is active, so their assistant and
            dashboard keep working correctly. If a business customer closes their account, or a visitor wants their information
            removed, contact us (below) and we&apos;ll delete it -- this is currently handled as a manual request rather than a
            self-service option in the product.
          </p>
        </section>

        <section>
          <h2>Security</h2>
          <p>
            Access tokens (such as a connected Google Calendar&apos;s refresh token) are encrypted before being stored. Every
            business&apos;s data is scoped so it&apos;s only reachable by that business&apos;s own account. Traffic to Falah Chat is
            encrypted in transit (HTTPS).
          </p>
        </section>

        <section>
          <h2>Your choices</h2>
          <ul>
            <li>Business customers can edit or delete their assistant&apos;s trained content, and disconnect a connected Google Calendar, at any time from their dashboard.</li>
            <li>Anyone -- a business customer or a visitor -- can contact us to request a copy of, or the deletion of, their information.</li>
          </ul>
        </section>

        <section>
          <h2>Changes to this policy</h2>
          <p>If this policy changes in a meaningful way, we&apos;ll update the date at the top of this page.</p>
        </section>

        <section>
          <h2>Contact us</h2>
          <p>
            Questions about this policy, or a request about your information, can be sent to{" "}
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
