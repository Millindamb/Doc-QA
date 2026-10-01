import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { generateStructured } from './structured.js';

const schema = z.object({ n: z.number() });
/** scripted generate(): each entry is {json}|{error}|{parseError}, consumed in call order */
function scripted(steps) {
  const calls = [];
  const fn = async (prompt, opts) => {
    calls.push({ prompt, provider: opts.provider });
    const step = steps.shift();
    if (!step) throw new Error('script exhausted');
    if (step.error) throw new Error(step.error);
    if (step.parseError) { const e = new Error('LLM did not return valid JSON'); e.rawText = 'nope'; throw e; }
    return { json: step.json, text: '', provider: opts.provider };
  };
  return { fn, calls };
}

test('valid on first try: one call, primary provider', async () => {
  const s = scripted([{ json: { n: 1 } }]);
  const r = await generateStructured('P', { schema, generate: s.fn });
  assert.deepEqual([r.data, r.provider, r.attempts, r.fellBack], [{ n: 1 }, 'gemini', 1, false]);
});

test('invalid output -> retries ONCE on the same provider, with the schema errors fed back', async () => {
  const s = scripted([{ json: { n: 'x' } }, { json: { n: 2 } }]);
  const r = await generateStructured('P', { schema, generate: s.fn });
  assert.equal(r.provider, 'gemini');
  assert.equal(r.attempts, 2);
  assert.deepEqual(s.calls.map((c) => c.provider), ['gemini', 'gemini']);
  assert.match(s.calls[1].prompt, /YOUR PREVIOUS REPLY COULD NOT BE USED: n: Expected number/);
});

test('invalid twice on Gemini -> falls back to Groq', async () => {
  const s = scripted([{ json: {} }, { json: {} }, { json: { n: 3 } }]);
  const r = await generateStructured('P', { schema, generate: s.fn });
  assert.deepEqual([r.provider, r.fellBack, r.attempts], ['groq', true, 3]);
  assert.deepEqual(s.calls.map((c) => c.provider), ['gemini', 'gemini', 'groq']);
});

test('unparseable JSON counts as invalid output (retry, then fallback)', async () => {
  const s = scripted([{ parseError: true }, { parseError: true }, { json: { n: 4 } }]);
  const r = await generateStructured('P', { schema, generate: s.fn });
  assert.equal(r.provider, 'groq');
});

test('transport error (429/timeout/missing key) skips straight to the other provider without retrying', async () => {
  const s = scripted([{ error: 'Gemini responded 429' }, { json: { n: 5 } }]);
  const r = await generateStructured('P', { schema, generate: s.fn });
  assert.deepEqual(s.calls.map((c) => c.provider), ['gemini', 'groq']);
  assert.equal(r.data.n, 5);
});

test('every provider exhausted -> 502 with a log of what happened', async () => {
  const s = scripted([{ json: {} }, { json: {} }, { error: 'Groq down' }]);
  await assert.rejects(generateStructured('P', { schema, generate: s.fn }), (e) => e.status === 502 && e.log.length === 3 && /Groq down/.test(e.message));
});
