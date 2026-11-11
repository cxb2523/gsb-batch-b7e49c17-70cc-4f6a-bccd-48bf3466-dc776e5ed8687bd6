import { afterEach, describe, expect, it, vi } from 'vitest';
import { closestGeneric, embedFonts, fontFamilies, fontSources, withGeneric } from '../src/chart/export-fonts';

/** A stand-in for a CSSFontFaceRule: jsdom drops `src` and `unicode-range` from real ones. */
function faceRule(props: Record<string, string>) {
  return {
    cssText: '@font-face { }',
    style: { getPropertyValue: (p: string) => props[p] ?? '' } as unknown as CSSStyleDeclaration,
  };
}
const loaded = (family: string, weight = '400', style = 'normal', unicodeRange = 'U+0-10FFFF', status = 'loaded') =>
  ({ family, weight, style, unicodeRange, status }) as FontFace;

const ORIGIN = 'http://ha.local:8123';
const BASE = `${ORIGIN}/lovelace/0`;

describe('font lists', () => {
  it('splits a font-family list, quoted or not', () => {
    expect(fontFamilies(`"Roboto", 'Noto Sans', Helvetica Neue ,sans-serif`)).toEqual([
      'Roboto',
      'Noto Sans',
      'Helvetica Neue',
      'sans-serif',
    ]);
    expect(fontFamilies('')).toEqual([]);
  });

  it('finds the closest generic family, and adds it only when the list has none', () => {
    expect(closestGeneric('Roboto, Noto')).toBe('sans-serif');
    expect(closestGeneric('"Roboto Slab", Georgia')).toBe('serif');
    expect(closestGeneric('"PT Sans", Georgia')).toBe('sans-serif');
    expect(closestGeneric('"Fira Code", Consolas')).toBe('monospace');
    expect(closestGeneric('Inter, System-UI')).toBe('system-ui');
    expect(withGeneric('Roboto, Noto')).toBe('Roboto, Noto, sans-serif');
    expect(withGeneric('Roboto, serif')).toBe('Roboto, serif');
    expect(withGeneric('')).toBe('sans-serif');
  });
});

describe('fontSources', () => {
  const sheets = [
    {
      href: `${ORIGIN}/static/fonts/roboto.css`,
      cssRules: [
        faceRule({
          'font-family': '"Roboto"',
          'font-weight': '400',
          src: 'url("Roboto-Regular.woff2") format("woff2"), url(Roboto-Regular.woff) format("woff")',
        }),
        faceRule({ 'font-family': 'Roboto', 'font-weight': '500', src: "url('/static/fonts/Roboto-Medium.woff2')" }),
        // Not loaded by the page: left out.
        faceRule({ 'font-family': 'Roboto', 'font-weight': '700', src: 'url(Roboto-Bold.woff2)' }),
        // A grouping rule holding a face.
        {
          cssRules: [
            faceRule({ 'font-family': 'Roboto', 'font-style': 'italic', src: 'url(data:font/woff2;base64,AAAA)' }),
          ],
        },
      ],
    },
    // Another host's sheet: its rules can't be read.
    {
      href: 'https://fonts.example.com/css',
      get cssRules(): never {
        throw new Error('SecurityError');
      },
    },
    // A readable sheet pointing at another host: never fetched.
    {
      href: null,
      cssRules: [
        faceRule({ 'font-family': 'Roboto', 'font-weight': '300', src: 'url(https://cdn.example.com/r.woff2)' }),
      ],
    },
  ];
  const faces = [
    loaded('Roboto'),
    loaded('"Roboto"', '500'),
    loaded('Roboto', '400', 'italic'),
    loaded('Roboto', '300'),
    loaded('Roboto', '700', 'normal', 'U+0-10FFFF', 'unloaded'),
    loaded('Other'),
  ];

  it('takes the loaded faces of the list’s families, from the same origin or data: URLs', () => {
    const out = fontSources('Roboto, sans-serif', faces, sheets, ORIGIN, BASE);
    expect(out.map((f) => [f.weight, f.style, f.url, f.format])).toEqual([
      ['400', 'normal', `${ORIGIN}/static/fonts/Roboto-Regular.woff2`, 'woff2'],
      ['500', 'normal', `${ORIGIN}/static/fonts/Roboto-Medium.woff2`, undefined],
      ['normal', 'italic', 'data:font/woff2;base64,AAAA', undefined],
    ]);
  });

  it('has nothing for a family the page has not loaded, or a generic one', () => {
    expect(fontSources('Lato, sans-serif', faces, sheets, ORIGIN, BASE)).toEqual([]);
    expect(fontSources('sans-serif', faces, sheets, ORIGIN, BASE)).toEqual([]);
  });

  it('matches faces by unicode range, and skips rules without a usable src', () => {
    const ranged = [
      {
        href: `${ORIGIN}/f.css`,
        cssRules: [
          faceRule({ 'font-family': 'Roboto', 'unicode-range': 'U+0400-045F', src: 'url(cyr.woff2)' }),
          faceRule({ 'font-family': 'Roboto', 'unicode-range': 'U+0000-00FF', src: 'url(latin.woff2)' }),
          faceRule({ 'font-family': 'Roboto', 'unicode-range': 'U+0000-00FF', src: 'local(Roboto)' }),
        ],
      },
    ];
    const out = fontSources('Roboto', [loaded('Roboto', 'normal', 'normal', 'U+0000-00FF')], ranged, ORIGIN, BASE);
    expect(out.map((f) => f.url)).toEqual([`${ORIGIN}/latin.woff2`]);
  });
});

describe('embedFonts', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text>Hi</text></svg>';
  function fakeDoc(sheets: unknown[], fonts: unknown = [loaded('Roboto')]) {
    return { fonts, styleSheets: sheets, location: { origin: ORIGIN }, baseURI: BASE } as unknown as Document;
  }
  const sheet = (src: string) => [
    {
      href: `${ORIGIN}/static/roboto.css`,
      cssRules: [faceRule({ 'font-family': 'Roboto', 'font-weight': '400', src })],
    },
  ];

  it('writes same-origin faces into the SVG as data URLs', async () => {
    const fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal('fetch', fetch);
    const out = await embedFonts(svg, 'Roboto, sans-serif', fakeDoc(sheet('url(Roboto.woff2) format("woff2")')));
    expect(fetch).toHaveBeenCalledWith(`${ORIGIN}/static/Roboto.woff2`, { credentials: 'same-origin' });
    expect(out).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><defs><style>' +
        '@font-face{font-family:"Roboto";font-weight:400;font-style:normal;src:url("data:font/woff2;base64,AQID") format("woff2")}' +
        '</style></defs><text>Hi</text></svg>',
    );
  });

  it('guesses the type from the file name, and keeps a unicode range', async () => {
    vi.stubGlobal('fetch', async () => new Response(new Uint8Array([0])));
    const ranged = [
      {
        href: `${ORIGIN}/a.css`,
        cssRules: [faceRule({ 'font-family': 'Roboto', 'unicode-range': 'U+0-FF', src: 'url(r.ttf?v=2)' })],
      },
    ];
    const out = await embedFonts(svg, 'Roboto', fakeDoc(ranged, [loaded('Roboto', 'normal', 'normal', 'U+0-FF')]));
    expect(out).toContain(';unicode-range:U+0-FF;src:url("data:font/ttf;base64,AA==")}');
  });

  it('never fetches from another host', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const out = await embedFonts(svg, 'Roboto', fakeDoc(sheet('url(https://fonts.example.com/r.woff2)')));
    expect(fetch).not.toHaveBeenCalled();
    expect(out).toBe(svg);
  });

  it('leaves the SVG alone when a fetch fails, a face is too big, or the browser has no font list', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    expect(await embedFonts(svg, 'Roboto', fakeDoc(sheet('url(r.woff2)')))).toBe(svg);
    vi.stubGlobal('fetch', async () => {
      throw new Error('offline');
    });
    expect(await embedFonts(svg, 'Roboto', fakeDoc(sheet('url(r.woff2)')))).toBe(svg);
    vi.stubGlobal('fetch', async () => new Response(new Uint8Array(2_000_001)));
    expect(await embedFonts(svg, 'Roboto', fakeDoc(sheet('url(r.woff2)')))).toBe(svg);
    expect(await embedFonts(svg, 'Roboto', fakeDoc(sheet('url(r.woff2)'), undefined))).toBe(svg);
    // The real jsdom document: no document.fonts.
    expect(await embedFonts(svg, 'Roboto')).toBe(svg);
    // A font list that throws while being read.
    const broken = {
      [Symbol.iterator]() {
        throw new Error('broken');
      },
    };
    expect(await embedFonts(svg, 'Roboto', fakeDoc(sheet('url(r.woff2)'), broken))).toBe(svg);
  });

  it('embeds a data: face without fetching it', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const out = await embedFonts(svg, 'Roboto', fakeDoc(sheet('url(data:font/woff2;base64,QQ==)')));
    expect(fetch).not.toHaveBeenCalled();
    expect(out).toContain('src:url("data:font/woff2;base64,QQ==")}');
  });
});
