/**
 * Which chunks should the questions be based on?
 *   exam      -> the highest-importance chunks (definitions, formulas, key facts)
 *   knowledge -> spread across topics: round-robin over topics (largest first),
 *                taking the most important not-yet-used chunk of each
 * Without analysis (no topics / importance) we fall back to evenly spaced chunks.
 */
export const MAX_CONTEXT_CHUNKS = 8;
export const MAX_CHUNK_CHARS = 1400;

export const chunkLabel = (chunk) => chunk.position + 1; // same 1-based numbering as chat citations

export function poolSize(count, available) {
  const wanted = Math.min(MAX_CONTEXT_CHUNKS, Math.max(3, Math.ceil(count / 2) + 1));
  return Math.min(wanted, available);
}

export function chunkTopicMap(doc) {
  const map = new Map();
  for (const t of doc.topics || []) for (const id of t.chunkIds || []) if (!map.has(id)) map.set(id, { id: t.id, label: t.label });
  return map;
}

function importanceMap(doc) {
  return new Map((doc.importanceChunks || []).map((c) => [c.chunkId, c.score]));
}

function evenlySpaced(chunks, n) {
  if (n >= chunks.length) return [...chunks];
  const step = chunks.length / n;
  return Array.from({ length: n }, (_, i) => chunks[Math.floor(i * step)]);
}

export function selectChunks(doc, { mode = 'knowledge', count = 5 } = {}) {
  const chunks = [...(doc.chunks || [])].sort((a, b) => a.position - b.position);
  if (!chunks.length) return [];
  const n = poolSize(count, chunks.length);
  const imp = importanceMap(doc);
  const topicOf = chunkTopicMap(doc);
  const byImportance = (a, b) => (imp.get(b.id) ?? 0) - (imp.get(a.id) ?? 0) || a.position - b.position;

  let picked;
  if (mode === 'exam') {
    picked = imp.size ? [...chunks].sort(byImportance).slice(0, n) : evenlySpaced(chunks, n);
  } else {
    const topics = (doc.topics || []).filter((t) => (t.chunkIds || []).length).sort((a, b) => (b.size || 0) - (a.size || 0));
    if (!topics.length) {
      picked = evenlySpaced(chunks, n);
    } else {
      const byId = new Map(chunks.map((c) => [c.id, c]));
      const queues = topics.map((t) => t.chunkIds.map((id) => byId.get(id)).filter(Boolean).sort(byImportance));
      const used = new Set();
      picked = [];
      let progressed = true;
      while (picked.length < n && progressed) {
        progressed = false;
        for (const q of queues) {
          while (q.length && used.has(q[0].id)) q.shift();
          if (q.length && picked.length < n) {
            const c = q.shift();
            used.add(c.id);
            picked.push(c);
            progressed = true;
          }
        }
      }
      if (picked.length < n) {
        // topics didn't cover enough chunks: top up with the most important remaining ones
        const rest = chunks.filter((c) => !used.has(c.id)).sort(byImportance);
        picked.push(...rest.slice(0, n - picked.length));
      }
    }
  }

  return picked
    .sort((a, b) => a.position - b.position)
    .map((c) => ({
      ...c,
      label: chunkLabel(c),
      topicId: topicOf.get(c.id)?.id ?? null,
      topicLabel: topicOf.get(c.id)?.label ?? 'General',
    }));
}

export function formatQuestionContext(selected) {
  return selected
    .map((c) => `[${c.label}]${c.heading ? ` (Section: ${c.heading})` : ''}\n${c.text.trim().slice(0, MAX_CHUNK_CHARS)}`)
    .join('\n\n');
}
