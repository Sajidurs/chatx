import "server-only";
import { extractText as extractPdfText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";

export type KnowledgeSourceType = "pdf" | "doc" | "text";

/**
 * Extracts plain text from an uploaded file. "doc" covers modern .docx
 * (OOXML) via mammoth -- legacy binary .doc is not supported; in practice
 * almost all business documents today are .docx, PDF, or plain text.
 */
export async function extractText(buffer: Buffer, type: KnowledgeSourceType): Promise<string> {
  if (type === "text") {
    return buffer.toString("utf-8");
  }

  if (type === "pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractPdfText(pdf, { mergePages: true });
    return text;
  }

  if (type === "doc") {
    const { value } = await mammoth.extractRawText({ buffer });
    return value;
  }

  throw new Error(`Unsupported knowledge source type: ${type}`);
}
