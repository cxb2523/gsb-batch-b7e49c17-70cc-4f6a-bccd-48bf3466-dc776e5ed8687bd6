// Based on this project's JSON-only share parser. Preserve integer identifiers before JSON.parse,
// and never execute the script or reconstruct numbers that have already lost precision.
export function safeJson(source: string): any {
  let result = '', index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === '"') {
      const start = index++;
      while (index < source.length) {
        if (source[index] === '\\') index += 2;
        else if (source[index++] === '"') break;
      }
      result += source.slice(start, index);
    } else if (char === '-' || /\d/.test(char)) {
      const match = source.slice(index).match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
      if (!match) { result += char; index++; continue; }
      const token = match[0];
      result += /^-?\d+$/.test(token) && !Number.isSafeInteger(Number(token)) ? `"${token}"` : token;
      index += token.length;
    } else { result += char; index++; }
  }
  return JSON.parse(result);
}
