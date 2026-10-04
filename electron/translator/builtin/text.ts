/** Word-level similarity, shared by the parser (id reuse) and the renderer
 *  (deciding whether the author's own sentence still describes an element). */

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'the', 'to', 'of', 'for', 'in', 'on', 'at', 'it', 'is', 'be', 'by', 'with',
  'then', 'that', 'this', 'their', 'its', 'from', 'into',
]);

/**
 * Crude suffix stripping — enough that "pulls" matches "pull" and "shapes"
 * matches "shape". Without it, ordinary verb conjugation between a written step
 * ("@Workshop pulls the materials") and its box label ("Pull materials") looks
 * like two unrelated phrases, and the author's wording gets needlessly rewritten.
 */
export function stem(word: string): string {
  if (word.length <= 3) return word;
  return word
    .replace(/(?:ing|ed)$/, '')
    .replace(/s$/, '');
}

export function tokens(text: string): Set<string> {
  return new Set(
    (text ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 1 && !STOP_WORDS.has(word))
      .map(stem),
  );
}

/** Jaccard overlap, 0–1. */
export function similarity(a: string, b: string): number {
  const left = tokens(a);
  const right = tokens(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}
