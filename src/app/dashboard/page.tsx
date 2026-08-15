import Link from "next/link";
import { getCurrentBusinessContext } from "@/lib/auth/current-business";
import { isBusinessRestricted } from "@/lib/billing/access";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ planUpdated?: string }>;
}) {
  const context = await getCurrentBusinessContext();
  if (!context) return null; // layout already redirects; satisfies TypeScript
  const { planUpdated } = await searchParams;

  const { business } = context;
  const restricted = isBusinessRestricted(business);

  return (
    <div className="flex flex-col gap-4">
      {planUpdated && (
        <div className="rounded-md border border-green-300 bg-green-50 px-4 py-3 text-green-800">
          Your plan change is being processed. It may take a few seconds to reflect below.
        </div>
      )}

      {restricted && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-red-800">
          Your access is currently restricted due to a payment issue. Please{" "}
          <Link href="/plans" className="underline">
            update your billing
          </Link>{" "}
          to restore access.
        </div>
      )}

      {business.status === "past_due" && !restricted && (
        <div className="rounded-md border border-yellow-300 bg-yellow-50 px-4 py-3 text-yellow-800">
          There was a problem with your last payment. Please update your billing details soon to
          avoid losing access.
        </div>
      )}

      {business.plan === "free" && business.status === "active" && !business.stripe_subscription_id && (
        <div className="rounded-md border border-blue-300 bg-blue-50 px-4 py-3 text-blue-800">
          You&apos;re on the Free plan.{" "}
          <Link href="/plans" className="underline">
            Upgrade
          </Link>{" "}
          for more messages and booking.
        </div>
      )}

      <h1 className="text-xl font-semibold">Welcome, {business.name}</h1>
      <dl className="grid max-w-sm grid-cols-2 gap-y-2 text-sm">
        <dt className="text-gray-500">Plan</dt>
        <dd className="capitalize">{business.plan}</dd>
        <dt className="text-gray-500">Status</dt>
        <dd className="capitalize">{business.status.replace("_", " ")}</dd>
        <dt className="text-gray-500">Your role</dt>
        <dd className="capitalize">{context.role}</dd>
      </dl>
    </div>
  );
}
