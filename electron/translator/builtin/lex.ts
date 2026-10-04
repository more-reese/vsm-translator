/**
 * Lexer for the lightly-structured step notation.
 *
 * Nothing here is required of the author — plain numbered lines parse fine. These
 * are the conventions that are *recognised* when they happen to appear, which is
 * the same contract the LLM adapters are given in their prompt.
 */

export type LineKind = 'blank' | 'if' | 'else' | 'endif' | 'parallel' | 'step';

export interface Line {
  /** 1-indexed line number in the original text. */
  no: number;
  /** Leading whitespace width, used to nest. */
  indent: number;
  kind: LineKind;
  /** The line with its list marker, keyword and @Actor removed. */
  text: string;
  /** Raw line, trimmed — kept verbatim for hover provenance. */
  raw: string;
  actor?: string;
  /** For `if` lines: the condition. */
  condition?: string;
  /** The author explicitly marked this a sub-process. */
  explicitSubProcess?: boolean;
}

/** `1.` `2)` `3a.` `- ` `* ` `• ` — all optional. */
const MARKER = /^\s*(?:\(?\d+[a-z]?[.)]|[-*•‣▪]|\d+\s*[-–])\s+/i;
const ACTOR = /(^|\s)@([A-Za-z][\w-]*(?:\s+[A-Z][\w-]*)?)/;
const IF = /^\s*(?:if|when)\b\s*(.*?)\s*(?:\bthen\b\s*:?|:)?\s*$/i;
const ELSE = /^\s*(?:else|otherwise|if not)\b\s*:?\s*(.*)$/i;
const ENDIF = /^\s*end\s*if\b\s*\.?\s*$/i;
const PARALLEL =
  /^\s*(?:(?:at the same time|in parallel|simultaneously|concurrently|meanwhile|both of these happen|these happen together)\b.*?)\s*:?\s*$/i;
const SUBPROCESS = /\((?:sub[-\s]?process|subprocess)\)\s*\.?\s*$/i;

function indentOf(raw: string): number {
  const match = raw.match(/^[\t ]*/);
  if (!match) return 0;
  // A tab counts as four columns so mixed indentation still nests sensibly.
  return match[0].replace(/\t/g, '    ').length;
}

export function lex(text: string): Line[] {
  const lines: Line[] = [];

  text.split('\n').forEach((raw, index) => {
    const no = index + 1;
    const trimmed = raw.trim();
    if (!trimmed) {
      lines.push({ no, indent: 0, kind: 'blank', text: '', raw: '' });
      return;
    }

    const indent = indentOf(raw);
    // The marker itself signals nesting too: "3a." sits under "3.".
    const markerMatch = raw.match(MARKER);
    const marker = markerMatch ? markerMatch[0].trim() : '';
    const body = raw.replace(MARKER, '').trim();

    if (ENDIF.test(body)) {
      lines.push({ no, indent, kind: 'endif', text: '', raw: trimmed });
      return;
    }

    const elseMatch = body.match(ELSE);
    if (elseMatch) {
      // "ELSE do the other thing" carries a step on the same line.
      const trailing = elseMatch[1]?.trim() ?? '';
      lines.push({ no, indent, kind: 'else', text: trailing, raw: trimmed });
      return;
    }

    if (PARALLEL.test(body)) {
      lines.push({ no, indent, kind: 'parallel', text: '', raw: trimmed });
      return;
    }

    const ifMatch = body.match(IF);
    if (ifMatch && /\b(?:if|when)\b/i.test(body)) {
      const rest = ifMatch[1] ?? '';
      // "IF x THEN do y" keeps "do y" as the first step of the then-branch.
      const thenSplit = rest.split(/\bthen\b/i);
      const condition = (thenSplit[0] ?? rest).trim().replace(/[,:]$/, '');
      const trailing = thenSplit.slice(1).join('then').trim();
      lines.push({
        no,
        indent,
        kind: 'if',
        condition,
        text: trailing,
        raw: trimmed,
      });
      return;
    }

    let stepText = body;
    let actor: string | undefined;
    const actorMatch = stepText.match(ACTOR);
    if (actorMatch) {
      actor = actorMatch[2].trim();
      stepText = stepText
        .replace(ACTOR, '$1')
        // "@Sales: check the order" — drop the separator the renderer writes.
        .replace(/^\s*[:\-–—]\s*/, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
    }

    const explicitSubProcess = SUBPROCESS.test(stepText);
    if (explicitSubProcess) stepText = stepText.replace(SUBPROCESS, '').trim();

    lines.push({
      no,
      // A lettered sub-marker under a plain number nests even without whitespace.
      indent: indent + (/^\(?\d+[a-z]/i.test(marker) ? 1 : 0),
      kind: 'step',
      text: stepText,
      raw: trimmed,
      actor,
      explicitSubProcess,
    });
  });

  return lines;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const boundary = cut.lastIndexOf(' ');
  return `${(boundary > max * 0.6 ? cut.slice(0, boundary) : cut).trim()}…`;
}

/** Shorten a sentence into something that fits in a BPMN box. */
export function toLabel(text: string, max = 46): string {
  const label = text
    .replace(/^(?:the|then|next|after that|first|finally|and)\b[\s,]*/i, '')
    .replace(/\s+/g, ' ')
    .replace(/[.;:,]+$/, '')
    .trim();
  if (!label) return '';
  const shortened = truncate(label, max);
  return shortened.charAt(0).toUpperCase() + shortened.slice(1);
}

/** Turn a condition into a question for the gateway label. */
export function toQuestion(condition: string, max = 40): string {
  // "the" is kept: "IF the order needs sizing" is how people write it, and
  // dropping it makes a re-commit differ from the author's own line for no gain.
  const cleaned = condition
    .replace(/^(?:it|there)\s+/i, '')
    .replace(/\s+/g, ' ')
    .replace(/[?.]+$/, '')
    .trim();
  if (!cleaned) return 'Which way?';
  // Deliberately not toLabel(): that strips a leading "the", and "IF the order
  // needs sizing" is exactly how the author wrote it.
  const shortened = truncate(cleaned, max).replace(/…$/, '');
  return `${shortened.charAt(0).toUpperCase()}${shortened.slice(1)}?`;
}
