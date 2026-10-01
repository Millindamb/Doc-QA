import { generate as defaultGenerate } from './llm.js';
import { renderPrompt } from './prompts.js';

/** "3 issues: a.b: msg; ..." from a zod error (kept short: it is fed back to the LLM). */
export function describeZodError(error) {
  return error.issues
    .slice(0, 6)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}

/**
 * Ask an LLM for JSON and validate it against a zod schema.
 *
 * Policy (per the project spec):
 *   1. call provider A -> validate. Invalid output? RETRY ONCE on the same provider, telling it what was wrong.
 *   2. still invalid (or the provider errored: 429/timeout/missing key) -> FALL BACK to the other provider,
 *      with the same one-retry rule.
 *   3. every provider exhausted -> throw an error with status 502.
 * A transport error moves straight to the next provider (retrying a dead provider is pointless).
 *
 * @returns {Promise<{data: any, provider: string, attempts: number, fellBack: boolean, log: string[]}>}
 */
export async function generateStructured(
  prompt,
  { schema, system, generate = defaultGenerate, providers = ['gemini', 'groq'], attemptsPerProvider = 2 } = {}
) {
  const log = [];
  let attempts = 0;

  for (const provider of providers) {
    let feedback = '';
    for (let attempt = 1; attempt <= attemptsPerProvider; attempt += 1) {
      const fullPrompt = feedback ? `${prompt}\n\n${feedback}` : prompt;
      attempts += 1;

      let result;
      try {
        result = await generate(fullPrompt, { json: true, system, provider });
      } catch (err) {
        if (err.rawText === undefined) {
          // transport / config error -> next provider
          log.push(`${provider}: ${err.message}`);
          break;
        }
        // reply arrived but was not parseable JSON -> counts as invalid output
        log.push(`${provider} attempt ${attempt}: ${err.message}`);
        feedback = renderPrompt('json_repair', { errors: err.message });
        continue;
      }

      const parsed = schema.safeParse(result.json);
      if (parsed.success) {
        return { data: parsed.data, provider: result.provider || provider, attempts, fellBack: provider !== providers[0], log };
      }
      const errors = describeZodError(parsed.error);
      log.push(`${provider} attempt ${attempt}: schema invalid (${errors})`);
      feedback = renderPrompt('json_repair', { errors });
    }
  }

  const err = new Error(`No provider returned valid structured output. ${log.join(' | ')}`);
  err.status = 502;
  err.log = log;
  throw err;
}
