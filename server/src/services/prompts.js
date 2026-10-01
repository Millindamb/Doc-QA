import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** All prompt templates live as separate .txt files in server/prompts/ (never inline strings). */
export const PROMPT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../prompts');

const cache = new Map();

export function loadPrompt(name) {
  if (!/^[a-z0-9_]+$/i.test(name)) throw new Error(`Invalid prompt name: ${name}`);
  if (!cache.has(name)) {
    const file = path.join(PROMPT_DIR, `${name}.txt`);
    if (!fs.existsSync(file)) throw new Error(`Prompt template not found: ${file}`);
    cache.set(name, fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'));
  }
  return cache.get(name);
}

export function listPrompts() {
  return fs
    .readdirSync(PROMPT_DIR)
    .filter((f) => f.endsWith('.txt'))
    .map((f) => f.replace(/\.txt$/, ''))
    .sort();
}

/**
 * Replace {{var}} placeholders in one pass over the TEMPLATE only, so text inside
 * substituted values (e.g. a document that contains "{{question}}") is never re-expanded.
 * Throws if the template references a variable that was not supplied.
 */
export function renderTemplate(template, vars) {
  return template.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_match, key) => {
    if (!Object.prototype.hasOwnProperty.call(vars, key)) {
      throw new Error(`Missing template variable "${key}"`);
    }
    return String(vars[key] ?? '');
  });
}

export function renderPrompt(name, vars = {}) {
  return renderTemplate(loadPrompt(name), vars);
}

export function templateVariables(name) {
  return [...new Set([...loadPrompt(name).matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)].map((m) => m[1]))];
}
