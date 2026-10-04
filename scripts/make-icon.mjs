import { deflateSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { root } from './esbuild.config.mjs';

/**
 * Generates build/icon.png (and icon.icns on macOS) with no image dependencies —
 * the app gets its own icon in the dock and the window without pulling in a
 * toolchain. Two overlapping rounded squares: a text block and a process box.
 */

const SIZE = 512;

function canvas(size) {
  const pixels = new Uint8Array(size * size * 4);
  return {
    size,
    pixels,
    set(x, y, [r, g, b, a]) {
      if (x < 0 || y < 0 || x >= size || y >= size) return;
      const i = (y * size + x) * 4;
      const alpha = a / 255;
      const inv = 1 - alpha;
      pixels[i] = Math.round(r * alpha + pixels[i] * inv);
      pixels[i + 1] = Math.round(g * alpha + pixels[i + 1] * inv);
      pixels[i + 2] = Math.round(b * alpha + pixels[i + 2] * inv);
      pixels[i + 3] = Math.round(a + pixels[i + 3] * inv);
    },
  };
}

function roundedRect(c, x, y, w, h, radius, color) {
  for (let py = Math.floor(y); py < y + h; py += 1) {
    for (let px = Math.floor(x); px < x + w; px += 1) {
      const dx = Math.max(x + radius - px, px - (x + w - radius - 1), 0);
      const dy = Math.max(y + radius - py, py - (y + h - radius - 1), 0);
      if (dx * dx + dy * dy <= radius * radius) c.set(px, py, color);
    }
  }
}

function line(c, x1, y1, x2, y2, thickness, color) {
  const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1));
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const cx = x1 + (x2 - x1) * t;
    const cy = y1 + (y2 - y1) * t;
    for (let oy = -thickness / 2; oy <= thickness / 2; oy += 1) {
      for (let ox = -thickness / 2; ox <= thickness / 2; ox += 1) {
        c.set(Math.round(cx + ox), Math.round(cy + oy), color);
      }
    }
  }
}

function toPng(c) {
  const raw = Buffer.alloc(c.size * (c.size * 4 + 1));
  for (let y = 0; y < c.size; y += 1) {
    raw[y * (c.size * 4 + 1)] = 0; // filter: none
    Buffer.from(c.pixels.buffer, y * c.size * 4, c.size * 4).copy(
      raw,
      y * (c.size * 4 + 1) + 1,
    );
  }

  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(c.size, 0);
  ihdr.writeUInt32BE(c.size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return crc ^ -1;
}

const INK = [27, 34, 48, 255];
const PAPER = [255, 255, 255, 255];
const ACCENT = [51, 88, 212, 255];
const GREEN = [29, 122, 90, 255];

const c = canvas(SIZE);
roundedRect(c, 0, 0, SIZE, SIZE, 112, INK);

// Left: lines of text.
for (let i = 0; i < 4; i += 1) {
  const y = 150 + i * 54;
  roundedRect(c, 84, y, i === 3 ? 96 : 150, 22, 11, i === 1 ? GREEN : PAPER);
}

// Right: a little process — box, diamond, box.
roundedRect(c, 268, 138, 92, 62, 14, PAPER);
roundedRect(c, 300, 236, 62, 62, 10, ACCENT);
roundedRect(c, 268, 330, 92, 62, 14, PAPER);
line(c, 314, 200, 331, 236, 8, PAPER);
line(c, 331, 298, 314, 330, 8, PAPER);

fs.mkdirSync(path.join(root, 'build'), { recursive: true });
const pngPath = path.join(root, 'build', 'icon.png');
fs.writeFileSync(pngPath, toPng(c));
console.log(`Wrote ${pngPath}`);

if (process.platform === 'darwin') {
  try {
    execFileSync('sips', ['-s', 'format', 'icns', pngPath, '--out', path.join(root, 'build', 'icon.icns')], {
      stdio: 'ignore',
    });
    console.log('Wrote build/icon.icns');
  } catch {
    console.log('Skipped icon.icns (sips unavailable) — packaging will fall back to the PNG.');
  }
}
