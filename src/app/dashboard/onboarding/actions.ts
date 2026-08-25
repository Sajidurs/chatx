"use server";

import { redirect } from "next/navigation";
import { getCurrentBusinessContext } from "@/lib/auth/current-business";
import { createClient } from "@/lib/supabase/server";
import { generateSystemPrompt } from "@/lib/onboarding/generate-system-prompt";
import { TIMEZONES } from "@/lib/timezones";

function fail(message: string): never {
  redirect(`/dashboard/onboarding?error=${encodeURIComponent(message)}`);
}

// Each action redirects with its own `saved` value (not a shared generic
// flag) so the page can say specifically what was saved -- independent forms
// sharing one vague "Saved." banner is exactly what caused confusion about
// whether a given section had actually been saved when it hadn't. (The photo
// section has its own inline "Uploaded" state now -- see
// FileUploadDropzone -- so "photo" is no longer one of these.)
function saved(what: "persona" | "prompt" | "timezone"): never {
  redirect(`/dashboard/onboarding?saved=${what}`);
}

function field(formData: FormData, name: string): string {
  return String(formData.get(name) || "").trim();
}

// Generates a fresh system prompt from the questionnaire and saves it along
// with the persona fields. This overwrites the current system_prompt -- use
// saveSystemPrompt below to tweak wording afterward without redoing the
// whole questionnaire.
export async function generateFromQuestionnaire(formData: FormData) {
  const context = await getCurrentBusinessContext();
  if (!context) redirect("/login");
  if (context.role !== "owner") fail("Only the business owner can edit assistant setup.");

  const assistantName = field(formData, "assistantName");
  const assistantBio = field(formData, "assistantBio");
  const answers = {
    businessType: field(formData, "businessType"),
    services: field(formData, "services"),
    tone: field(formData, "tone"),
    // The page already disables this field outside Pro (booking rules are
    // meaningless when the assistant has no ability to book at all) --
    // this is the server-side backstop so a direct POST can't sneak
    // booking-specific instructions into the prompt on a plan that can't
    // act on them.
    bookingRules: context.business.plan === "pro" ? field(formData, "bookingRules") : "",
    faqs: field(formData, "faqs"),
  };

  if (!answers.businessType || !answers.services) {
    fail("Business type and services are required.");
  }

  const systemPrompt = generateSystemPrompt(answers, assistantName);

  const supabase = await createClient();
  const { error } = await supabase
    .from("businesses")
    .update({
      assistant_name: assistantName || null,
      assistant_bio: assistantBio || null,
      system_prompt: systemPrompt,
    })
    .eq("id", context.business.id);

  if (error) fail("Could not save. Please try again.");
  saved("persona");
}

// Direct edit of the generated prompt -- the "editable afterward" path.
export async function saveSystemPrompt(formData: FormData) {
  const context = await getCurrentBusinessContext();
  if (!context) redirect("/login");
  if (context.role !== "owner") fail("Only the business owner can edit assistant setup.");

  const systemPrompt = field(formData, "systemPrompt");

  const supabase = await createClient();
  const { error } = await supabase
    .from("businesses")
    .update({ system_prompt: systemPrompt })
    .eq("id", context.business.id);

  if (error) fail("Could not save. Please try again.");
  saved("prompt");
}

export async function saveTimezone(formData: FormData) {
  const context = await getCurrentBusinessContext();
  if (!context) redirect("/login");
  if (context.role !== "owner") fail("Only the business owner can edit assistant setup.");

  const timezone = field(formData, "timezone");
  if (!TIMEZONES.includes(timezone)) fail("Please choose a valid timezone from the list.");

  const supabase = await createClient();
  const { error } = await supabase.from("businesses").update({ timezone }).eq("id", context.business.id);

  if (error) fail("Could not save. Please try again.");
  saved("timezone");
}
