// Splits a reply into short, consecutive chat-style messages (instead of one
// long paragraph) and computes a typing delay per chunk that's visibly
// proportional to its length, not fixed -- both are Phase 3 requirements.

const MAX_CHUNK_CHARS = 160;
const MIN_DELAY_MS = 500;
const MAX_DELAY_MS = 3500;
const MS_PER_CHAR = 30;
const BASE_DELAY_MS = 300;

/** Splits reply text into sentence-grouped chunks, each a short chat bubble. */
export function splitIntoMessages(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // Paragraph breaks are always separate bubbles.
  const paragraphs = trimmed.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  const chunks: string[] = [];
  for (const paragraph of paragraphs) {
    // A terminator (.!?) only ends a sentence when followed by whitespace or
    // the end of the string -- found via a real reply that silently dropped
    // "$45" entirely: the previous regex (`[^.!?]+[.!?]*(\s+|$)`) excluded
    // periods from its "content" character class outright, so a decimal
    // like "$45.00" (a period immediately followed by a digit, not
    // whitespace) could never be consumed as ordinary text. The regex engine
    // just kept advancing its start position looking for a split that
    // worked, silently skipping everything it couldn't match through.
    const sentences = paragraph.match(/[\s\S]+?[.!?](?=\s|$)|[\s\S]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [
      paragraph,
    ];

    let current = "";
    for (const sentence of sentences) {
      const candidate = current ? `${current} ${sentence}` : sentence;
      if (candidate.length > MAX_CHUNK_CHARS && current) {
        chunks.push(current);
        current = sentence;
      } else {
        current = candidate;
      }
    }
    if (current) chunks.push(current);
  }

  return chunks;
}

/** Typing delay in ms for a chunk, scaled to its length -- not fixed. */
export function computeTypingDelayMs(text: string): number {
  const raw = BASE_DELAY_MS + text.length * MS_PER_CHAR;
  return Math.max(MIN_DELAY_MS, Math.min(MAX_DELAY_MS, raw));
}
