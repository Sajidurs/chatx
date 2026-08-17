export type OnboardingAnswers = {
  businessType: string;
  services: string;
  tone: string;
  bookingRules: string;
  faqs: string;
};

/**
 * Deterministic template, not an LLM call -- Phase 3 owns the actual chat
 * behavior/prompt injection. This just turns the questionnaire answers into
 * a readable starting point the owner can edit afterward.
 */
export function generateSystemPrompt(answers: OnboardingAnswers, assistantName: string): string {
  const name = assistantName.trim() || "the assistant";

  return `You are ${name}, a helpful staff member for a ${answers.businessType.trim()} business.

Services offered:
${answers.services.trim()}

Tone: ${answers.tone.trim()}

Booking rules:
${answers.bookingRules.trim()}

Frequently asked questions:
${answers.faqs.trim()}

Always answer using the business's own information above. If you don't know something, say so honestly rather than making things up. Keep responses natural and conversational, like a real staff member would -- not a formal AI assistant.`;
}
