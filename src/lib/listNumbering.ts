/**
 * Ordered-list housekeeping for the text pane.
 *
 * The author writes numbered steps, so the numbers have to behave like a list and
 * not like typing: pressing Return mid-list inserts the next item, and inserting,
 * deleting or reordering renumbers everything after it. All of it is caret-aware,
 * because renumbering that moves the cursor is worse than no renumbering at all.
 */

/** indent, number, optional letter, separator, spacing, content. */
const ITEM = /^([ \t]*)(\d+)([a-z]?)([.)])([ \t]+)(.*)$/;

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

interface Item {
  indent: string;
  separator: string;
  spacing: string;
  content: string;
  /** Characters before the content starts. */
  markerLength: number;
}

function parseItem(line: string): Item | null {
  const match = ITEM.exec(line);
  if (!match) return null;
  const [, indent, digits, letter, separator, spacing, content] = match;
  return {
    indent,
    separator,
    spacing,
    content,
    markerLength: indent.length + digits.length + letter.length + separator.length + spacing.length,
  };
}

/** A line is a sub-step if it is indented, or already carries a letter. */
function isSubItem(line: string): boolean {
  const match = ITEM.exec(line);
  if (!match) return false;
  return match[1].length > 0 || Boolean(match[3]);
}

function relabel(lines: string[]): string[] {
  let top = 0;
  let sub = 0;

  return lines.map((line) => {
    const item = parseItem(line);
    if (!item) return line; // ELSE, blank lines and prose keep their place.

    let label: string;
    if (isSubItem(line)) {
      sub += 1;
      label = `${Math.max(top, 1)}${LETTERS[(sub - 1) % LETTERS.length]}`;
    } else {
      top += 1;
      sub = 0;
      label = `${top}`;
    }
    return `${item.indent}${label}${item.separator}${item.spacing}${item.content}`;
  });
}

function countItems(lines: string[]): number {
  return lines.filter((line) => ITEM.test(line)).length;
}

export interface Edit {
  text: string;
  caret: number;
}

/** Which line a caret sits on, and where within it. */
function locate(lines: string[], caret: number): { line: number; column: number } {
  let offset = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const end = offset + lines[index].length;
    if (caret <= end) return { line: index, column: caret - offset };
    offset = end + 1;
  }
  const last = lines.length - 1;
  return { line: last, column: lines[last]?.length ?? 0 };
}

function offsetOf(lines: string[], line: number, column: number): number {
  let offset = 0;
  for (let index = 0; index < line; index += 1) offset += lines[index].length + 1;
  return offset + column;
}

/**
 * Renumber the whole document, keeping the caret on the same character.
 * A no-op unless the text actually reads as a list, so prose containing a year
 * or a price is left alone.
 */
export function renumber(text: string, caret: number): Edit {
  const lines = text.split('\n');
  if (countItems(lines) < 2) return { text, caret };

  const next = relabel(lines);
  if (next.every((line, index) => line === lines[index])) return { text, caret };

  const { line, column } = locate(lines, caret);
  const before = parseItem(lines[line]);
  const after = parseItem(next[line]);

  let newColumn = column;
  if (before && after) {
    const shift = after.markerLength - before.markerLength;
    // Inside the marker itself, pin to the start of the content rather than
    // letting the caret drift into the middle of a number.
    newColumn = column >= before.markerLength ? column + shift : Math.min(column, after.markerLength);
  }

  return { text: next.join('\n'), caret: offsetOf(next, line, newColumn) };
}

/**
 * Return pressed inside a numbered list: split the line and give the new line its
 * own marker at the same level, then renumber so the rest of the list follows.
 * Returns null when the caret is not in a list and Return should do its usual job.
 */
export function insertListItem(text: string, caret: number, selectionEnd: number): Edit | null {
  const lines = text.split('\n');
  const { line, column } = locate(lines, caret);
  const current = lines[line];
  const item = parseItem(current);
  if (!item) return null;

  // Return on an item with no content means "I'm done with this list".
  if (!item.content.trim() && caret === selectionEnd) {
    const emptied = [...lines];
    emptied[line] = '';
    const renumbered = renumber(emptied.join('\n'), offsetOf(emptied, line, 0));
    return renumbered;
  }

  if (column < item.markerLength) return null; // Caret is inside the marker.

  const head = current.slice(0, column);
  const tail = current.slice(Math.max(column, locate(lines, selectionEnd).column));

  // The placeholder number is irrelevant — relabel() immediately corrects it —
  // but it has to look like a marker so the renumber pass can see it.
  const marker = `${item.indent}1${item.separator}${item.spacing}`;
  const next = [...lines.slice(0, line), head, `${marker}${tail}`, ...lines.slice(line + 1)];

  const caretAfterMarker = offsetOf(next, line + 1, marker.length);
  return renumber(next.join('\n'), caretAfterMarker);
}
