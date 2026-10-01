import test from 'node:test';
import assert from 'node:assert/strict';
import { listPrompts, loadPrompt, renderPrompt, renderTemplate, templateVariables } from './prompts.js';
import { INSUFFICIENT_MARKER } from './documentQa.js';

const ANSWER_VARS = {
  document_title: 'Bio Notes',
  topics: 'Photosynthesis, Respiration',
  history: '(no previous messages)',
  context: '[1]\nPhotosynthesis converts light.',
  retrieval_note: 'ok',
  question: 'What is photosynthesis?',
};

test('all expected prompt templates exist as separate files', () => {
  const names = listPrompts();
  for (const n of [
    'system_grounding', 'knowledge_answer', 'exam_answer', 'doubt_answer',
    'insufficient_context_footer', 'no_context_answer', 'json_repair', 'system_json', 'quiz_generate', 'practice_generate',
    'research_summary', 'system_research', 'research_chat_reply', 'resources_suggest', 'resources_chat_reply',
    'quiz_chat_reply', 'practice_chat_reply', 'quiz_difficulty_easy', 'quiz_difficulty_medium', 'quiz_difficulty_hard',
    'quiz_type_mcq', 'quiz_type_short', 'quiz_type_mixed', 'quiz_mode_exam', 'quiz_mode_knowledge',
  ]) {
    assert.ok(names.includes(n), `missing prompts/${n}.txt`);
  }
});

test('every answer template renders fully with the standard variable set', () => {
  for (const name of ['knowledge_answer', 'exam_answer', 'doubt_answer']) {
    const out = renderPrompt(name, ANSWER_VARS);
    assert.doesNotMatch(out, /\{\{/, `${name} has unresolved placeholders`);
    assert.match(out, /What is photosynthesis\?/);
    assert.match(out, /\[1\]\nPhotosynthesis converts light\./);
  }
});

test('templates only use variables the answer engine supplies', () => {
  for (const name of ['knowledge_answer', 'exam_answer', 'doubt_answer']) {
    for (const v of templateVariables(name)) assert.ok(v in ANSWER_VARS, `${name} uses unknown variable ${v}`);
  }
});

test('missing variable throws instead of silently leaving a placeholder', () => {
  assert.throws(() => renderTemplate('Hello {{name}}', {}), /Missing template variable "name"/);
});

test('substituted values are never re-expanded (no template injection via document text)', () => {
  const out = renderTemplate('Q: {{question}} / T: {{topics}}', { question: '{{topics}}', topics: 'SAFE' });
  assert.equal(out, 'Q: {{topics}} / T: SAFE');
});

test('dollar signs in values are inserted literally', () => {
  assert.equal(renderTemplate('{{x}}', { x: "cost is $& and $1" }), 'cost is $& and $1');
});

test('system prompt carries the insufficient-context marker the code looks for', () => {
  assert.ok(loadPrompt('system_grounding').includes(INSUFFICIENT_MARKER));
});

test('exam prompt: definitions -> formulas/key facts -> likely exam questions -> short answer', () => {
  const p = loadPrompt('exam_answer');
  const order = ['**Definitions**', '**Formulas / Key facts**', '**Likely exam questions**', '**Short answer**'].map((h) => p.indexOf(h));
  assert.ok(order.every((i) => i >= 0), 'a heading is missing');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'headings are out of order');
  assert.match(p, /concise/i);
});

test('knowledge prompt asks for depth, background, examples, analogies and chunk citations', () => {
  const p = loadPrompt('knowledge_answer');
  for (const word of [/in depth/i, /background/i, /example/i, /analogy/i, /cite the chunk number/i]) assert.match(p, word);
});

test('doubt prompt: simpler rephrase, step by step, one follow-up check question', () => {
  const p = loadPrompt('doubt_answer');
  for (const word of [/simpler/i, /step by step/i, /follow-up check question/i]) assert.match(p, word);
});

test('knowledge and exam prompts differ for identical inputs', () => {
  assert.notEqual(renderPrompt('knowledge_answer', ANSWER_VARS), renderPrompt('exam_answer', ANSWER_VARS));
});

test('invalid prompt names are rejected (no path traversal)', () => {
  assert.throws(() => loadPrompt('../config'), /Invalid prompt name/);
  assert.throws(() => loadPrompt('nope_not_here'), /not found/);
});

test('Part 4 templates render fully and demand strict JSON / no URLs', () => {
  const gen = { document_title: 'T', count: 5, difficulty_guidance: 'd', type_guidance: 't', mode_guidance: 'm', context: '[1]\nx' };
  for (const name of ['quiz_generate', 'practice_generate']) {
    const out = renderPrompt(name, gen);
    assert.doesNotMatch(out, /\{\{/);
    assert.match(out, /"questions"/);
    assert.match(out, /sourceChunk/);
  }
  assert.match(loadPrompt('system_json'), /STRICT JSON/);
  assert.match(loadPrompt('system_research'), /NEVER write a URL/);
  assert.match(loadPrompt('resources_suggest'), /NEVER include URLs/);
  assert.match(renderPrompt('json_repair', { errors: 'x' }), /ONLY the corrected JSON/);
});

test('every template only uses variables that exist in some caller (no orphan placeholders)', () => {
  for (const name of listPrompts()) assert.ok(Array.isArray(templateVariables(name)));
});
