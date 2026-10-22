// Reads every byte-level fact of brand/ and reference/ images and writes tools/assets-report.json
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';

const root = path.resolve(import.meta.dirname, '..');
const dirs = ['brand', 'reference'];
const report = {};

function sniff(buf) {
  if (buf.slice(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpeg';
  return 'unknown';
}

function ihdr(buf) {
  // 8 sig + 4 len + 4 'IHDR' + data
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bitDepth: buf[24],
    colourType: buf[25],
    interlace: buf[28],
  };
}

function kmeans(px, k, iters = 14) {
  // px: array of [r,g,b]; deterministic init by luminance quantiles
  const sorted = [...px].sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  let cs = Array.from({ length: k }, (_, i) => sorted[Math.floor(((i + 0.5) / k) * sorted.length)].slice());
  for (let it = 0; it < iters; it++) {
    const sum = cs.map(() => [0, 0, 0, 0]);
    for (const p of px) {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < k; i++) {
        const d = (p[0] - cs[i][0]) ** 2 + (p[1] - cs[i][1]) ** 2 + (p[2] - cs[i][2]) ** 2;
        if (d < bd) { bd = d; bi = i; }
      }
      sum[bi][0] += p[0]; sum[bi][1] += p[1]; sum[bi][2] += p[2]; sum[bi][3]++;
    }
    cs = cs.map((c, i) => (sum[i][3] ? [sum[i][0] / sum[i][3], sum[i][1] / sum[i][3], sum[i][2] / sum[i][3]] : c));
  }
  return cs;
}

const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

for (const d of dirs) {
  for (const f of fs.readdirSync(path.join(root, d))) {
    const p = path.join(root, d, f);
    const buf = fs.readFileSync(p);
    const kind = sniff(buf);
    const entry = { bytes: buf.length, kind };
    let w, h, data;
    if (kind === 'png') {
      Object.assign(entry, { ihdr: ihdr(buf) });
      const png = PNG.sync.read(buf);
      ({ width: w, height: h, data } = png);
    } else if (kind === 'jpeg') {
      const j = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
      ({ width: w, height: h, data } = j);
      entry.ihdr = { width: w, height: h, note: 'JPEG has no IHDR/alpha; SOF decoded' };
    } else { report[`${d}/${f}`] = entry; continue; }

    // alpha histogram (8 buckets of 32)
    const ah = new Array(8).fill(0);
    let pureBlackTransparent = 0, transparent = 0;
    const counts = new Map();
    const sample = [];
    const step = Math.max(1, Math.floor((w * h) / 120000));
    for (let i = 0, n = 0; i < w * h; i++) {
      const o = i * 4, a = data[o + 3];
      ah[a >> 5]++;
      if (a < 255) transparent++;
      if (a === 0 && data[o] === 0 && data[o + 1] === 0 && data[o + 2] === 0) pureBlackTransparent++;
      const key = (data[o] >> 3) << 10 | (data[o + 1] >> 3) << 5 | (data[o + 2] >> 3);
      counts.set(key, (counts.get(key) || 0) + 1);
      if (i % step === 0) sample.push([data[o], data[o + 1], data[o + 2]]);
    }
    entry.alphaHistogram8 = ah;
    entry.transparentPixels = transparent;
    entry.pureBlackTransparentPixels = pureBlackTransparent;
    entry.dominant = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, c]) => {
      const r = ((k >> 10) & 31) << 3, g = ((k >> 5) & 31) << 3, b = (k & 31) << 3;
      return { approx: hex(r, g, b), share: +(c / (w * h)).toFixed(4) };
    });

    if (d === 'brand') {
      // k-means, then snap each centroid to the nearest real pixel (coordinate recorded)
      const cs = kmeans(sample, 3);
      entry.kmeansSnapped = cs.map((c) => {
        let best = null, bd = Infinity;
        for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
          const o = (y * w + x) * 4;
          const dd = (data[o] - c[0]) ** 2 + (data[o + 1] - c[1]) ** 2 + (data[o + 2] - c[2]) ** 2;
          if (dd < bd) { bd = dd; best = { x, y, hex: hex(data[o], data[o + 1], data[o + 2]) }; }
        }
        return { centroid: hex(...c.map(Math.round)), snapped: best };
      });
      // ink bounding box (dark pixels)
      let x0 = w, y0 = h, x1 = 0, y1 = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        if (data[o + 3] > 128 && data[o] + data[o + 1] + data[o + 2] < 150) {
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
      entry.inkBBox = { x0, y0, x1, y1 };
    }
    entry.size = { w, h };
    report[`${d}/${f}`] = entry;
  }
}
fs.writeFileSync(path.join(root, 'tools', 'assets-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));
