import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// system_design.md: "Sonnet for quality, Haiku as a cost option on high-volume
// plans" -- Haiku tiering isn't wired up yet (no phase calls for it), so every
// plan uses Sonnet for now. Revisit if Pro-plan volume makes cost a concern.
const MODEL = "claude-sonnet-5";
const MAX_TOOL_ITERATIONS = 5;

function client() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
}

export type ChatTurn = { role: "user" | "assistant"; content: string };

/**
 * One RAG chat turn: system prompt (persona + retrieved knowledge) plus the
 * conversation so far, returns the assistant's reply text. Thinking is off
 * and effort is low -- this is short conversational Q&A, not a reasoning
 * task, and latency matters for a live chat widget.
 *
 * When `tools` + `executeTool` are provided (Phase 4 booking tools), this
 * runs a manual agentic loop: call Claude, execute any tool_use blocks,
 * feed the results back, repeat until Claude stops calling tools or the
 * iteration cap is hit. A manual loop (not the SDK's beta Tool Runner) is
 * enough for four well-defined tools and keeps this dependency-light.
 */
export async function generateReply(params: {
  systemPrompt: string;
  history: ChatTurn[];
  tools?: Anthropic.Tool[];
  executeTool?: (name: string, input: Record<string, unknown>) => Promise<string>;
}): Promise<string> {
  const anthropic = client();
  const messages: Anthropic.MessageParam[] = params.history.map((turn) => ({
    role: turn.role,
    content: turn.content,
  }));

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: params.systemPrompt,
      thinking: { type: "disabled" },
      output_config: { effort: "low" },
      tools: params.tools,
      messages,
    });

    if (response.stop_reason === "refusal") {
      return "I'm not able to help with that. Let me have someone from our team follow up with you.";
    }

    if (response.stop_reason !== "tool_use" || !params.tools || !params.executeTool) {
      const textBlock = response.content.find((block) => block.type === "text");
      return textBlock && textBlock.type === "text" ? textBlock.text : "";
    }

    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type === "tool_use") {
        const result = await params.executeTool(block.name, block.input as Record<string, unknown>);
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
      }
    }
    messages.push({ role: "user", content: toolResults });
  }

  return "Sorry, I'm having trouble completing that right now. Let me have someone from our team follow up with you.";
}
