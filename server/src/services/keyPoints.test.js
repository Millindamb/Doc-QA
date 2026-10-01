import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, isValidKeyPointsArray } from './keyPoints.js';

const sampleAnalysis = {
  topics: [
    { id: 't0', label: 'Photosynthesis', topTerms: ['photosynthesis', 'light'], chunkIds: ['c0', 'c1'] },
    { id: 't1', label: 'Respiration', topTerms: ['respiration', 'atp'], chunkIds: ['c2', 'c3'] },
  ],
  keywords: [
    { term: 'photosynthesis', score: 0.9, sources: ['tfidf'] },
    { term: 'respiration', score: 0.8, sources: ['tfidf'] },
  ],
  summarySentences: [
    { text: 'Photosynthesis converts light into energy.', score: 0.9, position: 0, chunkId: 'c0' },
    { text: 'Respiration releases energy from glucose.', score: 0.8, position: 5, chunkId: 'c2' },
  ],
};

test('buildPrompt includes every topic label and its representative sentences', () => {
  const prompt = buildPrompt(sampleAnalysis);
  assert.match(prompt, /Photosynthesis/);
  assert.match(prompt, /Respiration/);
  assert.match(prompt, /Photosynthesis converts light into energy\./);
  assert.match(prompt, /Respiration releases energy from glucose\./);
});

test('buildPrompt falls back to global top sentences when a topic has none of its own', () => {
  const analysis = {
    ...sampleAnalysis,
    topics: [{ id: 't0', label: 'Unrelated Topic', topTerms: [], chunkIds: ['does-not-exist'] }],
  };
  const prompt = buildPrompt(analysis);
  // falls back to the global summarySentences since no sentence matches chunkIds
  assert.match(prompt, /Photosynthesis converts light into energy\./);
});

test('isValidKeyPointsArray accepts a well-formed array matching topic count', () => {
  const value = [
    { topic: 'Photosynthesis', key_points: ['a', 'b'], important_terms: ['x'] },
    { topic: 'Respiration', key_points: ['c'], important_terms: ['y', 'z'] },
  ];
  assert.equal(isValidKeyPointsArray(value, 2), true);
});

test('isValidKeyPointsArray rejects wrong length', () => {
  const value = [{ topic: 'Photosynthesis', key_points: ['a'], important_terms: ['x'] }];
  assert.equal(isValidKeyPointsArray(value, 2), false);
});

test('isValidKeyPointsArray rejects missing fields', () => {
  const value = [
    { topic: 'Photosynthesis', key_points: ['a'] }, // missing important_terms
    { topic: 'Respiration', key_points: ['c'], important_terms: ['y'] },
  ];
  assert.equal(isValidKeyPointsArray(value, 2), false);
});

test('isValidKeyPointsArray rejects non-string items inside arrays', () => {
  const value = [
    { topic: 'Photosynthesis', key_points: [1, 2], important_terms: ['x'] },
    { topic: 'Respiration', key_points: ['c'], important_terms: ['y'] },
  ];
  assert.equal(isValidKeyPointsArray(value, 2), false);
});

test('isValidKeyPointsArray rejects a non-array value', () => {
  assert.equal(isValidKeyPointsArray({ not: 'an array' }, 1), false);
  assert.equal(isValidKeyPointsArray(null, 1), false);
  assert.equal(isValidKeyPointsArray('nope', 1), false);
});
