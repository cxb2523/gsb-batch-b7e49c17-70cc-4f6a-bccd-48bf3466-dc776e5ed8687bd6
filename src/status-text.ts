/** Rough advance of one character, in em, for the card's sans-serif text. */
const CHAR_EM = 0.58;

/** Width of `text` in units of an average character; wide (CJK) characters count as a full em. */
function units(text: string): number {
  let n = 0;
  for (const ch of text) n += ch.codePointAt(0)! >= 0x2e80 ? 1 / CHAR_EM : 1;
  return n;
}

/**
 * Fit a status line (Unavailable, Entity not found, or a translated state) into `width` units:
 * longer than `splitAbove` characters, it splits on the space that best balances two lines;
 * then the font shrinks from `max` towards `min` until the longest line fits.
 */
export function fitStatusText(
  raw: string,
  width = 76,
  max = 12,
  min = 8,
  splitAbove = 11,
): { lines: string[]; size: number } {
  const text = raw.trim();
  let lines = [text];
  if (units(text) > splitAbove) {
    let best = units(text);
    for (let i = text.indexOf(' '); i > 0; i = text.indexOf(' ', i + 1)) {
      const longest = Math.max(units(text.slice(0, i)), units(text.slice(i + 1)));
      if (longest < best) {
        best = longest;
        lines = [text.slice(0, i), text.slice(i + 1)];
      }
    }
  }
  const longest = Math.max(...lines.map(units));
  const size = Math.max(min, Math.min(max, Math.floor(width / (CHAR_EM * Math.max(1, longest)))));
  return { lines, size };
}
