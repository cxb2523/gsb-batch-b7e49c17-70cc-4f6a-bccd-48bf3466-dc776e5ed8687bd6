// The one thing a host may want to change: where the satellite picture comes from.
//
// The default is EOX Sentinel-2 cloudless 2016: open (CC BY 4.0), no key, the
// whole planet at 10 m a pixel. Sharp from cruise height, soft near the ground.
//
// Any web-mercator tile service you hold a licence for can replace it. Either
// edit IMAGERY below, or leave the file alone and set it for your own browser:
//
//   localStorage.setItem('cayley.imagery', JSON.stringify({
//     url: 'https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=YOUR_KEY',
//     maxZoom: 17, emptyBelow: 2600,
//     credit: 'Powered by Esri · Imagery © Esri, Maxar, Earthstar Geographics',
//   }));
//
//   url         {z} {x} {y} template; the service must send CORS headers
//   maxZoom     finest level the service really has; closer in, tiles are enlarged
//   emptyBelow  a tile at zoom 14 or finer smaller than this many bytes is a
//               "no data" placeholder (Esri does that); 0 when the service has none
//   credit      attribution line, shown on the page; may contain links
export const IMAGERY = {
  url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg',
  maxZoom: 14,
  emptyBelow: 0,
  credit: 'Imagery: <a href="https://cloudless.eox.at">EOxCloudless</a> by <a href="https://eox.at">EOX IT Services GmbH</a> (contains modified Copernicus Sentinel data 2016 &amp; 2017)',
};

export function imagery() {
  try {
    const own = JSON.parse(localStorage.getItem('cayley.imagery') || 'null');
    if (own && typeof own.url === 'string' && /^https:\/\//.test(own.url)) {
      // a line typed into one's own browser is shown as text, never as markup
      const credit = String(own.credit || 'Imagery: custom source').replace(/[<>&]/g, '');
      return { url: own.url, maxZoom: Math.min(19, Math.max(8, own.maxZoom | 0 || 14)), emptyBelow: own.emptyBelow | 0, credit };
    }
  } catch (err) { /* storage blocked or not JSON: use the default */ }
  return IMAGERY;
}

// What the terrain is drawing from right now. A source of one's own that stops
// answering (a bad key, a spent quota) hands over to the open default, so the
// ground never goes blank.
export const live = { source: imagery(), fails: 0 };
export function imageryResult(ok) {
  if (live.source === IMAGERY) return;
  live.fails = ok ? 0 : live.fails + 1;
  if (live.fails >= 10) {
    live.source = IMAGERY; live.fails = 0;
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('cayley-imagery'));
  }
}
