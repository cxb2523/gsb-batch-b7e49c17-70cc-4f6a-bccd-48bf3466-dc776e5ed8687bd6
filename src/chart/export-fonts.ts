/*
 * Fonts for an exported picture. An SVG drawn into a canvas (the PNG) is an image, and an image
 * can't load fonts from the page: its text would fall back to whatever the system has. So before
 * drawing, the card's own font is written into the SVG as base64 `@font-face` rules, when that is
 * possible without asking anyone else for anything:
 *
 * - the font family is the card's computed one (Home Assistant's theme font, Roboto by default);
 * - only faces the page has already loaded (`document.fonts`, status "loaded") are taken, so a
 *   picture carries the one or two weights the card shows, not every subset a sheet lists;
 * - their files come from the page's own `@font-face` rules, and only from the same origin as the
 *   page (or a `data:` URL already in the rule). Sheets from other hosts can't be read and are
 *   skipped; a third-party URL is never fetched.
 *
 * When a face can't be found that way (a font added only through the FontFace API, a sheet from a
 * CDN, a browser without `document.fonts`), the picture keeps the card's font list ending in its
 * closest generic family (`sans-serif`, `serif` or `monospace`), so it falls back to a font of the
 * same kind.
 */

const GENERIC = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'math',
  'emoji',
  'fangsong',
]);

/** At most this much font data (bytes, before base64) goes into one picture. */
const MAX_FONT_BYTES = 2_000_000;

/** The families in a CSS font-family list, unquoted: `"Roboto", Noto, sans-serif` → three. */
export function fontFamilies(stack: string): string[] {
  const out: string[] = [];
  for (const m of stack.matchAll(/\s*(?:"([^"]*)"|'([^']*)'|([^,]+))\s*(?:,|$)/g)) {
    const name = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (name) out.push(name);
  }
  return out;
}

/** The generic family closest to a font list's own: monospace, serif or sans-serif. */
export function closestGeneric(stack: string): string {
  const families = fontFamilies(stack);
  const own = families.find((f) => GENERIC.has(f.toLowerCase()));
  if (own) return own.toLowerCase();
  const names = families.join(' ').toLowerCase();
  if (/mono|code|courier|consol/.test(names)) return 'monospace';
  if (/serif|times|georgia|garamond|slab/.test(names) && !/sans/.test(names)) return 'serif';
  return 'sans-serif';
}

/** A font list that ends in a generic family, adding the closest one if it has none. */
export function withGeneric(stack: string): string {
  const families = fontFamilies(stack);
  if (families.some((f) => GENERIC.has(f.toLowerCase()))) return stack;
  const generic = closestGeneric(stack);
  return families.length ? `${stack}, ${generic}` : generic;
}

/** One @font-face to embed: which face it is and where its file is. */
export interface FaceSource {
  family: string;
  weight: string;
  style: string;
  unicodeRange: string;
  url: string;
  format?: string;
}

/** The face's identity as `document.fonts` and a CSS rule both spell it. */
const faceKey = (family: string, weight: string, style: string, range: string) =>
  [
    family.replace(/^["']|["']$/g, '').toLowerCase(),
    ({ normal: '400', bold: '700' } as Record<string, string>)[weight || 'normal'] ?? weight,
    style || 'normal',
    (range || 'U+0-10FFFF').toUpperCase().replace(/\s+/g, ''),
  ].join('|');

/** The first `url(...)` in an @font-face src, with its format if given. */
function firstUrl(src: string): { url: string; format?: string } | undefined {
  const m = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)(?:\s*format\(\s*["']?([^"')]*)["']?\s*\))?/.exec(src);
  const url = m && (m[1] ?? m[2] ?? m[3]);
  return url ? { url, format: m[4] || undefined } : undefined;
}

interface RuleLike {
  cssRules?: ArrayLike<RuleLike>;
  styleSheet?: SheetLike | null;
  style?: CSSStyleDeclaration;
  cssText?: string;
}
interface SheetLike {
  href?: string | null;
  cssRules: ArrayLike<RuleLike>;
}

/** Every @font-face rule in the sheets, inside @import, @media and @supports too, with the URL its src is relative to. */
function fontFaceRules(sheets: ArrayLike<SheetLike>, base: string): { rule: RuleLike; base: string }[] {
  const out: { rule: RuleLike; base: string }[] = [];
  const visit = (rules: ArrayLike<RuleLike> | undefined, href: string, depth: number) => {
    if (!rules || depth > 4) return;
    for (const rule of Array.from(rules)) {
      if (rule.styleSheet) visit(readable(rule.styleSheet), rule.styleSheet.href ?? href, depth + 1);
      else if (rule.cssRules) visit(rule.cssRules, href, depth + 1);
      else if (rule.style && rule.cssText?.trimStart().toLowerCase().startsWith('@font-face'))
        out.push({ rule, base: href });
    }
  };
  for (const sheet of Array.from(sheets)) visit(readable(sheet), sheet.href ?? base, 0);
  return out;
}

/** A sheet's rules, or nothing for one from another origin (reading those throws). */
function readable(sheet: SheetLike): ArrayLike<RuleLike> | undefined {
  try {
    return sheet.cssRules;
  } catch {
    return undefined;
  }
}

/**
 * The faces to embed for a font list: loaded faces (`loaded`, from `document.fonts`) of its
 * families, matched to @font-face rules whose file is on `origin` or already a data: URL.
 */
export function fontSources(
  stack: string,
  loaded: Iterable<Pick<FontFace, 'family' | 'weight' | 'style' | 'unicodeRange' | 'status'>>,
  sheets: ArrayLike<SheetLike>,
  origin: string,
  base: string,
): FaceSource[] {
  const families = new Set(
    fontFamilies(stack)
      .filter((f) => !GENERIC.has(f.toLowerCase()))
      .map((f) => f.toLowerCase()),
  );
  const wanted = new Set<string>();
  for (const face of loaded) {
    const family = face.family.replace(/^["']|["']$/g, '').toLowerCase();
    if (face.status === 'loaded' && families.has(family)) {
      wanted.add(faceKey(face.family, face.weight, face.style, face.unicodeRange));
    }
  }
  if (!wanted.size) return [];
  const out: FaceSource[] = [];
  const seen = new Set<string>();
  for (const { rule, base: href } of fontFaceRules(sheets, base)) {
    const s = rule.style!;
    const family = s
      .getPropertyValue('font-family')
      .trim()
      .replace(/^["']|["']$/g, '');
    const weight = s.getPropertyValue('font-weight').trim();
    const style = s.getPropertyValue('font-style').trim();
    const range = s.getPropertyValue('unicode-range').trim();
    const key = faceKey(family, weight, style, range);
    if (!wanted.has(key) || seen.has(key)) continue;
    const src = firstUrl(s.getPropertyValue('src'));
    if (!src) continue;
    let url: URL;
    try {
      url = new URL(src.url, href);
    } catch {
      continue;
    }
    if (url.protocol !== 'data:' && url.origin !== origin) continue;
    seen.add(key);
    out.push({
      family,
      weight: weight || 'normal',
      style: style || 'normal',
      unicodeRange: range,
      url: url.href,
      format: src.format,
    });
  }
  return out;
}

const MIME: Record<string, string> = {
  woff2: 'font/woff2',
  woff: 'font/woff',
  truetype: 'font/ttf',
  ttf: 'font/ttf',
  opentype: 'font/otf',
  otf: 'font/otf',
};

function base64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

/** One face as a self-contained @font-face rule, or '' if its file can't be had. */
async function faceRule(face: FaceSource, budget: { left: number }): Promise<string> {
  let data = face.url;
  if (!data.startsWith('data:')) {
    const response = await fetch(face.url, { credentials: 'same-origin' });
    if (!response.ok) return '';
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > budget.left) return '';
    budget.left -= bytes.length;
    const ext = /\.(\w+)(?:[?#]|$)/.exec(new URL(face.url).pathname)?.[1]?.toLowerCase() ?? '';
    const mime = MIME[face.format?.toLowerCase() ?? ''] ?? MIME[ext] ?? 'font/woff2';
    data = `data:${mime};base64,${base64(bytes)}`;
  }
  const format = face.format ? ` format("${face.format}")` : '';
  const range = face.unicodeRange ? `;unicode-range:${face.unicodeRange}` : '';
  return `@font-face{font-family:"${face.family.replace(/["<>&]/g, '')}";font-weight:${face.weight};font-style:${face.style}${range};src:url("${data}")${format}}`;
}

/**
 * The SVG with the card's loaded same-origin font faces written in as data URLs, so a canvas
 * draws its text in the card's font. Unchanged when there is nothing to embed or anything fails.
 */
export async function embedFonts(svg: string, stack: string, doc: Document = document): Promise<string> {
  try {
    const fonts = (doc as Document & { fonts?: FontFaceSet }).fonts;
    if (!fonts || typeof fetch !== 'function' || typeof btoa !== 'function') return svg;
    const origin = doc.location?.origin ?? '';
    const faces = fontSources(stack, fonts as unknown as Iterable<FontFace>, doc.styleSheets, origin, doc.baseURI);
    if (!faces.length) return svg;
    const budget = { left: MAX_FONT_BYTES };
    const rules = (await Promise.all(faces.map((f) => faceRule(f, budget).catch(() => '')))).filter(Boolean);
    if (!rules.length) return svg;
    const at = svg.indexOf('>') + 1;
    return `${svg.slice(0, at)}<defs><style>${rules.join('')}</style></defs>${svg.slice(at)}`;
  } catch {
    return svg;
  }
}
