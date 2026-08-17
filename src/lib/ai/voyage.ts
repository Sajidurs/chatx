import "server-only";
import { VoyageAIClient } from "voyageai";

// Claude has no native embeddings endpoint, so RAG uses Voyage AI. voyage-4-lite
// is the cost-appropriate choice for the short, straightforward business
// documents this embeds (FAQs, policies, service descriptions) -- see
// CHANGELOG.md. Dimension must match knowledge_chunks.embedding (vector(1024)).
const MODEL = "voyage-4-lite";
const DIMENSION = 1024;

// Voyage caps batch size and total tokens per request; keep batches modest so
// a large document doesn't blow either limit in one call.
const BATCH_SIZE = 32;

function client() {
  return new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY! });
}

async function embed(texts: string[], inputType: "document" | "query"): Promise<number[][]> {
  if (texts.length === 0) return [];

  const voyage = client();
  const batches: number[][][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const response = await voyage.embed({
      input: batch,
      model: MODEL,
      inputType,
      outputDimension: DIMENSION,
    });
    const embeddings = (response.data ?? [])
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((item) => item.embedding!);
    batches.push(embeddings);
  }
  return batches.flat();
}

/** Embed chunks being stored for later retrieval. */
export function embedDocuments(texts: string[]): Promise<number[][]> {
  return embed(texts, "document");
}

/** Embed a search query about to be matched against stored chunks. */
export async function embedQuery(text: string): Promise<number[]> {
  const [embedding] = await embed([text], "query");
  return embedding;
}
