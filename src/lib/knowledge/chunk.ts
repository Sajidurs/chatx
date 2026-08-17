// Paragraph-aware sliding-window chunker: keeps related sentences together
// where possible, only hard-splitting a paragraph that alone exceeds the
// target size. Overlap carries a tail of the previous chunk into the next so
// a fact split across a chunk boundary is still findable from either side.
const MAX_CHUNK_CHARS = 1000;
const OVERLAP_CHARS = 150;

function splitLong(text: string): string[] {
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += MAX_CHUNK_CHARS - OVERLAP_CHARS) {
    parts.push(text.slice(i, i + MAX_CHUNK_CHARS));
  }
  return parts;
}

export function chunkText(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const paragraphs = normalized
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > MAX_CHUNK_CHARS) {
      flush();
      chunks.push(...splitLong(paragraph));
      current = "";
      continue;
    }

    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > MAX_CHUNK_CHARS) {
      flush();
      current = `${current.slice(-OVERLAP_CHARS)}\n\n${paragraph}`.trim();
    } else {
      current = candidate;
    }
  }
  flush();

  return chunks;
}
