// A small reader for Mapbox Vector Tiles: the protobuf container, layer by
// layer, with features decoded only when asked for. Scanning a tile costs
// almost nothing (it only notes where each feature starts), so the caller can
// spread the real work, geometry and attributes, over as many frames as it likes.
//
//   const tile = readTile(arrayBuffer);
//   const layer = tile.layers.get('building');
//   for (let i = 0; i < layer.count; i++) {
//     const f = layer.feature(i);            // { id, type, props }
//     const rings = layer.geometry(f);       // [[x0, y0, x1, y1, ...], ...] in 0..layer.extent
//   }

const utf8 = new TextDecoder();

class Reader {
  constructor(buf, pos = 0, end = buf.length) { this.buf = buf; this.pos = pos; this.end = end; }
  // unsigned varint; exact up to 2^53, which covers OpenStreetMap ids
  varint() {
    const b = this.buf;
    let x = 0, mul = 1, byte;
    do {
      byte = b[this.pos++];
      x += (byte & 0x7f) * mul;
      mul *= 128;
    } while (byte >= 0x80 && this.pos < this.end);
    return x;
  }
  skip(wire) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) { const n = this.varint(); this.pos += n; }
    else if (wire === 5) this.pos += 4;
    else throw new Error('mvt: wire type ' + wire);
  }
  string() { const n = this.varint(); const s = utf8.decode(this.buf.subarray(this.pos, this.pos + n)); this.pos += n; return s; }
}

function readValue(r) {
  const end = r.varint() + r.pos;
  let v = null;
  const view = new DataView(r.buf.buffer, r.buf.byteOffset);
  while (r.pos < end) {
    const tag = r.varint(), field = tag >> 3;
    if (field === 1) v = r.string();
    else if (field === 2) { v = view.getFloat32(r.pos, true); r.pos += 4; }
    else if (field === 3) { v = view.getFloat64(r.pos, true); r.pos += 8; }
    else if (field === 4 || field === 5) v = r.varint();
    else if (field === 6) { const z = r.varint(); v = z % 2 ? -(z + 1) / 2 : z / 2; }
    else if (field === 7) v = r.varint() !== 0;
    else r.skip(tag & 7);
  }
  r.pos = end;
  return v;
}

export const POINT = 1, LINE = 2, POLYGON = 3;

class Layer {
  constructor(buf, pos, end) {
    this.buf = buf;
    this.name = ''; this.extent = 4096;
    this.keys = []; this.values = [];
    const starts = [];
    const r = new Reader(buf, pos, end);
    while (r.pos < end) {
      const tag = r.varint(), field = tag >> 3;
      if (field === 1) this.name = r.string();
      else if (field === 2) { const n = r.varint(); starts.push(r.pos, r.pos + n); r.pos += n; }
      else if (field === 3) this.keys.push(r.string());
      else if (field === 4) this.values.push(readValue(r));
      else if (field === 5) this.extent = r.varint();
      else r.skip(tag & 7);
    }
    this.spans = starts;
    this.count = starts.length / 2;
  }
  // attributes and the whereabouts of the geometry; the geometry itself waits for geometry()
  feature(i) {
    const r = new Reader(this.buf, this.spans[i * 2], this.spans[i * 2 + 1]);
    const f = { id: 0, type: 0, props: {}, g0: 0, g1: 0 };
    while (r.pos < r.end) {
      const tag = r.varint(), field = tag >> 3;
      if (field === 1) f.id = r.varint();
      else if (field === 2) {
        const end = r.varint() + r.pos;
        while (r.pos < end) { const k = r.varint(), v = r.varint(); f.props[this.keys[k]] = this.values[v]; }
      } else if (field === 3) f.type = r.varint();
      else if (field === 4) { const n = r.varint(); f.g0 = r.pos; f.g1 = r.pos + n; r.pos += n; }
      else r.skip(tag & 7);
    }
    return f;
  }
  // Rings (polygons) or paths (lines) as flat [x, y, x, y, ...] arrays in tile
  // units. Polygon rings are not closed: the last point joins the first.
  geometry(f) {
    const r = new Reader(this.buf, f.g0, f.g1);
    const out = [];
    let cur = null, x = 0, y = 0;
    while (r.pos < r.end) {
      const cmd = r.varint(), id = cmd & 7;
      let n = cmd >> 3;
      if (id === 1 || id === 2) {
        while (n-- > 0 && r.pos < r.end) {
          const dx = r.varint(), dy = r.varint();
          x += (dx >>> 1) ^ -(dx & 1); y += (dy >>> 1) ^ -(dy & 1);
          if (id === 1) { cur = []; out.push(cur); }
          cur.push(x, y);
        }
      } else if (id !== 7) break;
    }
    return out;
  }
}

// The name of the layer starting at pos, without reading the rest of it.
function layerName(buf, pos, end) {
  const r = new Reader(buf, pos, end);
  while (r.pos < end) {
    const tag = r.varint();
    if (tag >> 3 === 1) return r.string();
    r.skip(tag & 7);
  }
  return '';
}

// keep: the layer names wanted. With a list, each wanted layer is copied out
// of the download so the rest of it (labels, points of interest) can be freed.
export function readTile(buffer, keep = null) {
  const buf = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const layers = new Map();
  const r = new Reader(buf);
  let bytes = 0;
  while (r.pos < r.end) {
    const tag = r.varint();
    if (tag >> 3 === 3 && (tag & 7) === 2) {
      const n = r.varint(), end = r.pos + n;
      if (!keep) { const layer = new Layer(buf, r.pos, end); layers.set(layer.name, layer); bytes += n; }
      else if (keep.includes(layerName(buf, r.pos, end))) {
        const layer = new Layer(buf.slice(r.pos, end), 0, n);
        layers.set(layer.name, layer);
        bytes += n;
      }
      r.pos = end;
    } else r.skip(tag & 7);
  }
  return { layers, bytes };
}

// Twice the signed area of a ring. In tile coordinates (y down) the spec makes
// outer rings positive and holes negative.
export function ringArea(ring) {
  let a = 0;
  for (let i = 0, n = ring.length, j = n - 2; i < n; j = i, i += 2) a += (ring[j] - ring[i]) * (ring[i + 1] + ring[j + 1]);
  return a;
}

// Group a polygon feature's rings into [{ outer, holes }].
export function polygons(rings) {
  const out = [];
  let cur = null;
  for (const ring of rings) {
    if (ring.length < 6) continue;
    const a = ringArea(ring);
    if (a === 0) continue;
    if (a > 0 || !cur) { cur = { outer: ring, holes: [], area: Math.abs(a) * 0.5 }; out.push(cur); }
    else cur.holes.push(ring);
  }
  return out;
}
