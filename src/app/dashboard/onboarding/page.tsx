import Image from "next/image";
import { getCurrentBusinessContext } from "@/lib/auth/current-business";
import { generateFromQuestionnaire, saveSystemPrompt, uploadAssistantPhoto } from "./actions";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { error, saved } = await searchParams;
  const context = await getCurrentBusinessContext();
  if (!context) return null;

  const { business } = context;
  const isOwner = context.role === "owner";

  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold">Assistant setup</h1>
        <p className="text-sm text-gray-600">
          Your assistant&apos;s name, photo, and personality, plus the questionnaire that
          generates its starting instructions.
        </p>
      </div>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {saved && (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">Saved.</p>
      )}
      {!isOwner && (
        <p className="rounded-md bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
          Only the business owner can edit assistant setup. You can view the current settings
          below.
        </p>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Photo</h2>
        <div className="flex items-center gap-4">
          {business.assistant_photo_url ? (
            <Image
              src={business.assistant_photo_url}
              alt="Assistant photo"
              width={64}
              height={64}
              className="rounded-full object-cover"
              unoptimized
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 text-xs text-gray-400">
              No photo
            </div>
          )}
          {isOwner && (
            <form action={uploadAssistantPhoto} className="flex items-center gap-2">
              <input type="file" name="photo" accept="image/png,image/jpeg,image/webp" required />
              <button type="submit" className="rounded-md border px-3 py-1.5 text-sm">
                Upload
              </button>
            </form>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Onboarding questionnaire</h2>
        <p className="text-sm text-gray-500">
          Generates a starting system prompt below, which you can then edit directly.
          Re-submitting this form replaces the current prompt.
        </p>
        <form action={generateFromQuestionnaire} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            Assistant name
            <input
              name="assistantName"
              defaultValue={business.assistant_name ?? ""}
              disabled={!isOwner}
              className="rounded-md border px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Short bio
            <input
              name="assistantBio"
              defaultValue={business.assistant_bio ?? ""}
              disabled={!isOwner}
              className="rounded-md border px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Business type (e.g. hair salon, dental clinic, restaurant)
            <input name="businessType" disabled={!isOwner} required className="rounded-md border px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Services offered
            <textarea name="services" disabled={!isOwner} required rows={3} className="rounded-md border px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Tone (e.g. friendly and casual, professional and concise)
            <input name="tone" disabled={!isOwner} className="rounded-md border px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Booking rules (hours, buffer times, what needs a deposit, etc.)
            <textarea name="bookingRules" disabled={!isOwner} rows={3} className="rounded-md border px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Frequently asked questions and answers
            <textarea name="faqs" disabled={!isOwner} rows={4} className="rounded-md border px-3 py-2" />
          </label>
          {isOwner && (
            <button
              type="submit"
              className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white"
            >
              Generate system prompt
            </button>
          )}
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">System prompt</h2>
        <p className="text-sm text-gray-500">
          What your assistant actually sees. Edit directly any time.
        </p>
        <form action={saveSystemPrompt} className="flex flex-col gap-3">
          <textarea
            name="systemPrompt"
            defaultValue={business.system_prompt ?? ""}
            disabled={!isOwner}
            rows={12}
            className="rounded-md border px-3 py-2 font-mono text-xs"
          />
          {isOwner && (
            <button
              type="submit"
              className="w-fit rounded-md bg-black px-4 py-2 text-sm font-medium text-white"
            >
              Save
            </button>
          )}
        </form>
      </section>
    </div>
  );
}
