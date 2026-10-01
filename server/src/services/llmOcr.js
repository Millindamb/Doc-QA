import { generate } from './llm.js';

const SYSTEM_PROMPT = `You extract text from documents. Transcribe ALL text content from the
attached file, verbatim, preserving reading order, paragraph breaks, and headings.
Do not summarize, translate, or add commentary. Output only the extracted text.`;

/**
 * Extract text from a pdf/image using Gemini's file input, for documents
 * where local OCR confidence was too low (needs_llm_ocr === true).
 *
 * @param {string} filePath - path to the file on disk (still present on disk)
 * @param {string} mimeType
 * @returns {Promise<{ text: string, provider: string }>}
 * @throws if Gemini fails (Groq has no vision/file support, so there is no fallback here)
 */
export async function extractTextWithLlm(filePath, mimeType) {
  const result = await generate('Extract all text from this file.', {
    system: SYSTEM_PROMPT,
    files: [{ path: filePath, mimeType }],
  });
  return { text: result.text, provider: result.provider };
}
