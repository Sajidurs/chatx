import Image from "next/image";
import { getCurrentBusinessContext } from "@/lib/auth/current-business";
import { generateFromQuestionnaire, saveSystemPrompt, saveTimezone, uploadAssistantPhoto } from "./actions";
import { PageHeader, Card } from "../ui";
import { SavedBanner, ErrorBanner } from "../confirm-banners";
import { TIMEZONES } from "@/lib/timezones";

const inputClass =
  "rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm outline-none focus:border-brand-300 focus:ring-2 focus:ring-brand-100";

export default async function OnboardingPage() {
  const context = await getCurrentBusinessContext();
  if (!context) return null;

  const { business } = context;
  const isOwner = context.role === "owner";
  const isPro = business.plan === "pro";

  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <PageHeader
        title="Assistant setup"
        description="Your assistant's name, photo, and personality, plus the questionnaire that generates its starting instructions."
      />

      <ErrorBanner />
      {!isOwner && (
        <div className="rounded-2xl border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          Only the business owner can edit assistant setup. You can view the current settings below.
        </div>
      )}

      <Card className="flex flex-col gap-3">
        <h2 className="font-semibold">Photo</h2>
        <SavedBanner value="photo">Photo saved.</SavedBanner>
        <div className="flex items-center gap-4">
          {business.assistant_photo_url ? (
            <Image src={business.assistant_photo_url} alt="Assistant photo" width={64} height={64} className="rounded-full object-cover" unoptimized />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 text-xs text-gray-400">No photo</div>
          )}
          {isOwner && (
            <form action={uploadAssistantPhoto} className="flex items-center gap-2">
              <input type="file" name="photo" accept="image/png,image/jpeg,image/webp" required className="text-sm" />
              <button type="submit" className="rounded-xl border border-gray-200 px-3.5 py-2 text-sm hover:bg-gray-50">
                Upload photo
              </button>
            </form>
          )}
        </div>
        <p className="text-xs text-gray-500">PNG, JPEG, or WebP, up to 8MB. This section saves independently of the other two below.</p>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="font-semibold">Timezone</h2>
        <SavedBanner value="timezone">Timezone saved.</SavedBanner>
        <p className="text-sm text-gray-500">
          Your assistant uses this to understand times the way your customers mean them -- e.g. a customer saying &quot;10am&quot; with no timezone
          means 10am here, not UTC -- and to make sure calendar bookings land at the right time on your Google Calendar.
        </p>
        <form action={saveTimezone} className="flex flex-wrap items-center gap-2">
          <select name="timezone" defaultValue={business.timezone} disabled={!isOwner} className={inputClass}>
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
          {isOwner && (
            <button type="submit" className="rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600">
              Save timezone
            </button>
          )}
        </form>
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="font-semibold">Name, bio &amp; onboarding questionnaire</h2>
        <SavedBanner value="persona">Name, bio, and system prompt saved.</SavedBanner>
        <p className="text-sm text-gray-500">
          Generates a starting system prompt below, which you can then edit directly. Re-submitting this form replaces the current prompt (but not
          the photo above, which has its own save button).
        </p>
        <form action={generateFromQuestionnaire} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
            Assistant name
            <input name="assistantName" defaultValue={business.assistant_name ?? ""} disabled={!isOwner} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
            Short bio
            <input name="assistantBio" defaultValue={business.assistant_bio ?? ""} disabled={!isOwner} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
            Business type (e.g. hair salon, dental clinic, restaurant)
            <input name="businessType" disabled={!isOwner} required className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
            Services offered
            <textarea name="services" disabled={!isOwner} required rows={3} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
            Tone (e.g. friendly and casual, professional and concise)
            <input name="tone" disabled={!isOwner} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
            Booking rules (hours, buffer times, what needs a deposit, etc.)
            <textarea name="bookingRules" disabled={!isOwner || !isPro} rows={3} className={inputClass} />
            {!isPro && (
              <span className="text-xs font-normal text-gray-500">
                Booking rules are a Pro plan feature -- your assistant can&apos;t book appointments on this plan, so there&apos;s nothing for these
                rules to apply to yet.{" "}
                <a href="/plans" className="font-medium text-brand-700 hover:underline">
                  View plans
                </a>
              </span>
            )}
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
            Frequently asked questions and answers
            <textarea name="faqs" disabled={!isOwner} rows={4} className={inputClass} />
          </label>
          {isOwner && (
            <button type="submit" className="w-fit rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600">
              Save name, bio &amp; generate prompt
            </button>
          )}
        </form>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="font-semibold">System prompt (direct edit)</h2>
        <SavedBanner value="prompt">System prompt saved.</SavedBanner>
        <p className="text-sm text-gray-500">
          What your assistant actually sees. Edit the wording directly any time -- this section only saves the text below, not the name/bio/questionnaire
          above.
        </p>
        <form action={saveSystemPrompt} className="flex flex-col gap-3">
          <textarea
            name="systemPrompt"
            defaultValue={business.system_prompt ?? ""}
            disabled={!isOwner}
            rows={12}
            className={`${inputClass} font-mono text-xs`}
          />
          {isOwner && (
            <button type="submit" className="w-fit rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600">
              Save prompt text
            </button>
          )}
        </form>
      </Card>
    </div>
  );
}
