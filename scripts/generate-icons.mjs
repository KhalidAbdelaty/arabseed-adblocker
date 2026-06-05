/*
 * ArabSeed Shield - icon generator (dependency-free)
 *
 * Chromium does not render SVG for extension/toolbar icons, so we rasterize the
 * brand mark (dark rounded square + gradient shield + cream inner shield +
 * orange play triangle + accent dot) into PNGs at the manifest sizes.
 *
 * Pure Node: supersampled software rasterizer + manual PNG encoder via zlib.
 * Run with: node scripts/generate-icons.mjs
 */

import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "icons");
const SS = 4; // supersample factor for anti-aliasing
const SIZES = [16, 32, 48, 128];

const COLORS = {
  bg: [20, 20, 19],
  cream: [250, 249, 245],
  orange: [217, 119, 87],
  dotOuter: [232, 230, 220]
};

// Gradient for the outer shield (matches the SVG: cream -> orange -> brown).
const GRADIENT = [
  { t: 0.0, c: [250, 249, 245] },
  { t: 0.48, c: [217, 119, 87] },
  { t: 1.0, c: [140, 74, 53] }
];
const GRAD_A = [25, 15];
const GRAD_B = [108, 111];

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function gradientColor(t) {
  if (t <= GRADIENT[0].t) return GRADIENT[0].c;
  const last = GRADIENT[GRADIENT.length - 1];
  if (t >= last.t) return last.c;
  for (let i = 0; i < GRADIENT.length - 1; i++) {
    const s0 = GRADIENT[i];
    const s1 = GRADIENT[i + 1];
    if (t >= s0.t && t <= s1.t) {
      const k = (t - s0.t) / (s1.t - s0.t);
      return [lerp(s0.c[0], s1.c[0], k), lerp(s0.c[1], s1.c[1], k), lerp(s0.c[2], s1.c[2], k)];
    }
  }
  return last.c;
}

function cubicSamples(p0, p1, p2, p3, steps) {
  const pts = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const x = u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0];
    const y = u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1];
    pts.push([x, y]);
  }
  return pts;
}

// Build a closed shield polygon (128-space) from the SVG-derived control points.
function buildShield(o) {
  const pts = [];
  pts.push(o.peak);
  pts.push(o.topRight);
  pts.push([o.topRight[0], o.rightY]);
  for (const p of cubicSamples([o.topRight[0], o.rightY], o.c1, o.c2, o.bottom, 28)) pts.push(p);
  const lc1 = [128 - o.c2[0], o.c2[1]];
  const lc2 = [128 - o.c1[0], o.c1[1]];
  const leftShoulder = [o.topLeft[0], o.rightY];
  for (const p of cubicSamples(o.bottom, lc1, lc2, leftShoulder, 28)) pts.push(p);
  pts.push(o.topLeft);
  return pts;
}

const OUTER_SHIELD = buildShield({
  peak: [64, 15],
  topRight: [103, 29],
  rightY: 58,
  c1: [103, 83],
  c2: [87, 105],
  bottom: [64, 114],
  topLeft: [25, 29]
});
const INNER_SHIELD = buildShield({
  peak: [64, 29],
  topRight: [90, 38],
  rightY: 59,
  c1: [90, 77],
  c2: [80, 93],
  bottom: [64, 101],
  topLeft: [38, 38]
});
const PLAY_TRIANGLE = [
  [58, 48],
  [80, 64],
  [58, 80]
];

function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function roundRectContains(x, y, size, r) {
  if (x < 0 || y < 0 || x > size || y > size) return false;
  const rx = Math.min(r, size / 2);
  const inCornerX = x < rx || x > size - rx;
  const inCornerY = y < rx || y > size - rx;
  if (inCornerX && inCornerY) {
    const cx = x < rx ? rx : size - rx;
    const cy = y < rx ? rx : size - rx;
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= rx * rx;
  }
  return true;
}

function gradientT(x, y) {
  const vx = GRAD_B[0] - GRAD_A[0];
  const vy = GRAD_B[1] - GRAD_A[1];
  const len2 = vx * vx + vy * vy;
  const t = ((x - GRAD_A[0]) * vx + (y - GRAD_A[1]) * vy) / len2;
  return Math.max(0, Math.min(1, t));
}

function renderSize(N) {
  const M = N * SS;
  const s = M / 128;
  const out = Buffer.alloc(N * N * 4);
  for (let oy = 0; oy < N; oy++) {
    for (let ox = 0; ox < N; ox++) {
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let sumA = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = ox * SS + sx + 0.5;
          const py = oy * SS + sy + 0.5;
          const ux = px / s;
          const uy = py / s;
          let cr = 0;
          let cg = 0;
          let cb = 0;
          let ca = 0;
          if (roundRectContains(px, py, M, 0.22 * M)) {
            [cr, cg, cb] = COLORS.bg;
            ca = 1;
          }
          if (pointInPolygon(ux, uy, OUTER_SHIELD)) {
            [cr, cg, cb] = gradientColor(gradientT(ux, uy));
            ca = 1;
          }
          if (pointInPolygon(ux, uy, INNER_SHIELD)) {
            [cr, cg, cb] = COLORS.cream;
            ca = 1;
          }
          if (pointInPolygon(ux, uy, PLAY_TRIANGLE)) {
            [cr, cg, cb] = COLORS.orange;
            ca = 1;
          }
          const dotX = ux - 96;
          const dotY = uy - 31;
          if (dotX * dotX + dotY * dotY <= 100) {
            [cr, cg, cb] = COLORS.dotOuter;
            ca = 1;
          }
          if (dotX * dotX + dotY * dotY <= 25) {
            [cr, cg, cb] = COLORS.orange;
            ca = 1;
          }
          sumR += cr * ca;
          sumG += cg * ca;
          sumB += cb * ca;
          sumA += ca;
        }
      }
      const n = SS * SS;
      const idx = (oy * N + ox) * 4;
      if (sumA > 0) {
        out[idx] = Math.round(sumR / sumA);
        out[idx + 1] = Math.round(sumG / sumA);
        out[idx + 2] = Math.round(sumB / sumA);
      }
      out[idx + 3] = Math.round((sumA / n) * 255);
    }
  }
  return out;
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function encodePNG(N, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(N, 0);
  ihdr.writeUInt32BE(N, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = N * 4 + 1;
  const raw = Buffer.alloc(stride * N);
  for (let y = 0; y < N; y++) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * N * 4, y * N * 4 + N * 4);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

for (const N of SIZES) {
  const png = encodePNG(N, renderSize(N));
  writeFileSync(join(OUT_DIR, `icon${N}.png`), png);
  console.log(`wrote icons/icon${N}.png (${png.length} bytes)`);
}
