/** Tiny lexical helpers shared by grading, query building and video ranking (own implementation). */
const STOP = new Set(
  `a an the and or but so if then of to in on at by for from with about into as is are was were be been am do does did
   not no it its this that these those they them their there here what which who how why when where can could would
   should will just also very more most some any than too i me my we you your he she his her our us`.split(/\s+/)
);

export function stem(word) {
  if (word.length <= 3 || /^\d+$/.test(word)) return word;
  if (word.endsWith('sses')) return word.slice(0, -2);
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  for (const suffix of ['ingly', 'edly', 'ing', 'ed', 'ly', 'es']) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) return word.slice(0, -suffix.length);
  }
  if (word.endsWith('s') && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

/** Lower-cased content stems (stopwords and 1-letter tokens removed). */
export function contentStems(text) {
  return (String(text).toLowerCase().match(/[a-z0-9]+/g) || [])
    .filter((w) => !STOP.has(w) && (w.length > 1 || /\d/.test(w)))
    .map(stem);
}

export const uniq = (arr) => [...new Set(arr)];
