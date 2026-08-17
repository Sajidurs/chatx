import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// system_design.md: "Sonnet for quality, Haiku as a cost option on high-volume
// plans" -- Haiku tiering isn't wired up yet (no phase calls for it), so every
// plan uses Sonnet for now. Revisit if Pro-plan volume makes cost a concern.
const MODEL = "claude-sonnet-5";

function client() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
}

export type ChatTurn = { role: "user" | "assistant"; content: string };

/**
 * One RAG chat turn: system prompt (persona + retrieved knowledge) plus the
 * conversation so far, returns the assistant's reply text. Thinking is off
 * and effort is low -- this is short conversational Q&A, not a reasoning
 * task, and latency matters for a live chat widget.
 */
export async function generateReply(params: {
  systemPrompt: string;
  history: ChatTurn[];
}): Promise<string> {
  const anthropic = client();

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: params.systemPrompt,
    thinking: { type: "disabled" },
    output_config: { effort: "low" },
    messages: params.history.map((turn) => ({ role: turn.role, content: turn.content })),
  });

  if (response.stop_reason === "refusal") {
    return "I'm not able to help with that. Let me have someone from our team follow up with you.";
  }

  const textBlock = response.content.find((block) => block.type === "text");
  return textBlock && textBlock.type === "text" ? textBlock.text : "";
}
