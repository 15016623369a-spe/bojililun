import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import zlib from 'node:zlib';

const execFileAsync = promisify(execFile);

const ROOT = process.cwd();
const SRC_DIR = path.resolve(process.env.SCULPTURE_SRC_DIR || path.join(ROOT, '..', 'output', 'exercise-anims'));
const OUT_MP4_DIR = path.join(ROOT, 'public', 'sculpture-exercises', 'mp4');
const OUT_KF_DIR = path.join(ROOT, 'public', 'sculpture-exercises', 'kf');
const OUT_THUMBS_DIR = path.join(ROOT, 'public', 'exercises');
const INDEX_FILE = path.join(ROOT, 'data', 'sculpture-exercises.json');
const EXERCISES_JSON = path.join(ROOT, 'data', 'exercises.json');

const BG = [236, 238, 233];
const force = process.argv.includes('--force');

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const out = Buffer.allocUnsafe(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function writeRgb24Png(rgbBuf, width, height, outPath) {
  const rowBytes = width * 3;
  const stride = 1 + rowBytes;
  const raw = Buffer.allocUnsafe(height * stride);
  for (let y = 0; y < height; y++) {
    const dst = y * stride;
    raw[dst] = 0;
    rgbBuf.copy(raw, dst + 1, y * rowBytes, (y + 1) * rowBytes);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const idat = zlib.deflateSync(raw, { level: 4 });
  fs.writeFileSync(outPath, Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]));
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function decodePngRgb24(filePath) {
  const file = fs.readFileSync(filePath);
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = 2;
  const idats = [];

  while (pos < file.length) {
    const len = file.readUInt32BE(pos);
    const type = file.toString('ascii', pos + 4, pos + 8);
    const data = file.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      colorType = data[9];
      if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
        throw new Error(`Unsupported PNG format (${bitDepth}bit type ${colorType}) in ${filePath}`);
      }
    } else if (type === 'IDAT') {
      idats.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  const inflated = zlib.inflateSync(Buffer.concat(idats));
  const bpp = colorType === 6 ? 4 : 3;
  const rowBytes = width * bpp;
  const scanStride = 1 + rowBytes;
  const recon = Buffer.alloc(height * rowBytes);

  for (let y = 0; y < height; y++) {
    const filter = inflated[y * scanStride];
    const srcOff = y * scanStride + 1;
    const dstOff = y * rowBytes;
    const prevOff = (y - 1) * rowBytes;

    for (let x = 0; x < rowBytes; x++) {
      const val = inflated[srcOff + x];
      const a = x >= bpp ? recon[dstOff + x - bpp] : 0;
      const b = y > 0 ? recon[prevOff + x] : 0;
      const c = y > 0 && x >= bpp ? recon[prevOff + x - bpp] : 0;
      let rec;
      if (filter === 0) rec = val;
      else if (filter === 1) rec = (val + a) & 0xff;
      else if (filter === 2) rec = (val + b) & 0xff;
      else if (filter === 3) rec = (val + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) rec = (val + paethPredictor(a, b, c)) & 0xff;
      else throw new Error(`Unknown PNG filter ${filter}`);
      recon[dstOff + x] = rec;
    }
  }

  if (bpp === 3) return { width, height, rgb: recon };

  const rgb = Buffer.allocUnsafe(width * height * 3);
  for (let p = 0, q = 0; p < recon.length; p += 4, q += 3) {
    const a = recon[p + 3] / 255;
    const inv = 1 - a;
    rgb[q] = Math.round(recon[p] * a + BG[0] * inv);
    rgb[q + 1] = Math.round(recon[p + 1] * a + BG[1] * inv);
    rgb[q + 2] = Math.round(recon[p + 2] * a + BG[2] * inv);
  }
  return { width, height, rgb };
}

function downsampleTile(srcRgb, sw, sh, dstBuf, dstFullW, ox, oy, tileSize) {
  for (let dy = 0; dy < tileSize; dy++) {
    const syRaw = ((dy + 0.5) / tileSize) * sh - 0.5;
    const sy = Math.max(0, Math.min(sh - 1, syRaw));
    const y0 = Math.floor(sy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const wy = sy - y0;
    const wy0 = 1 - wy;

    const dstRow = ((oy + dy) * dstFullW + ox) * 3;
    const srcRow0 = y0 * sw * 3;
    const srcRow1 = y1 * sw * 3;

    for (let dx = 0; dx < tileSize; dx++) {
      const sxRaw = ((dx + 0.5) / tileSize) * sw - 0.5;
      const sx = Math.max(0, Math.min(sw - 1, sxRaw));
      const x0 = Math.floor(sx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const wx = sx - x0;
      const wx0 = 1 - wx;

      const w00 = wx0 * wy0;
      const w10 = wx * wy0;
      const w01 = wx0 * wy;
      const w11 = wx * wy;

      const p00 = srcRow0 + x0 * 3;
      const p10 = srcRow0 + x1 * 3;
      const p01 = srcRow1 + x0 * 3;
      const p11 = srcRow1 + x1 * 3;

      const di = dstRow + dx * 3;
      dstBuf[di] = Math.round(srcRgb[p00] * w00 + srcRgb[p10] * w10 + srcRgb[p01] * w01 + srcRgb[p11] * w11);
      dstBuf[di + 1] = Math.round(srcRgb[p00 + 1] * w00 + srcRgb[p10 + 1] * w10 + srcRgb[p01 + 1] * w01 + srcRgb[p11 + 1] * w11);
      dstBuf[di + 2] = Math.round(srcRgb[p00 + 2] * w00 + srcRgb[p10 + 2] * w10 + srcRgb[p01 + 2] * w01 + srcRgb[p11 + 2] * w11);
    }
  }
}

async function main() {
  if (!fs.existsSync(SRC_DIR)) {
    throw new Error(`SCULPTURE_SRC_DIR does not exist: ${SRC_DIR}`);
  }

  fs.mkdirSync(OUT_MP4_DIR, { recursive: true });
  fs.mkdirSync(OUT_KF_DIR, { recursive: true });
  fs.mkdirSync(OUT_THUMBS_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(INDEX_FILE), { recursive: true });

  const exercises = JSON.parse(fs.readFileSync(EXERCISES_JSON, 'utf8'));
  const thumbNameById = new Map();
  for (const ex of exercises) {
    if (ex.id && ex.image) {
      thumbNameById.set(String(ex.id), path.basename(String(ex.image)));
    }
  }

  const mp4SrcDir = path.join(SRC_DIR, 'mp4');
  const framesSrcDir = path.join(SRC_DIR, 'frames');
  if (!fs.existsSync(mp4SrcDir) || !fs.existsSync(framesSrcDir)) {
    throw new Error(`Expected mp4/ and frames/ inside ${SRC_DIR}`);
  }

  const candidateIds = fs
    .readdirSync(mp4SrcDir)
    .filter((f) => f.endsWith('.mp4'))
    .map((f) => f.slice(0, -4))
    .sort((a, b) => a.localeCompare(b));

  const readyIds = [];
  for (const id of candidateIds) {
    const mp4Src = path.join(mp4SrcDir, `${id}.mp4`);
    const framePaths = [0, 1, 2, 3].map((i) => path.join(framesSrcDir, `${id}-f${i}.png`));
    const okMp4 = fs.existsSync(mp4Src) && fs.statSync(mp4Src).size > 1024;
    const okFrames = framePaths.every((p) => fs.existsSync(p) && fs.statSync(p).size > 1024);
    if (okMp4 && okFrames) readyIds.push(id);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fitcheck-kf-'));
  let updatedCount = 0;
  let skippedCount = 0;
  let cursor = 0;
  const WORKERS = Math.min(12, Math.max(1, readyIds.length));

  async function processOne(id) {
    const mp4Src = path.join(mp4SrcDir, `${id}.mp4`);
    const mp4Dst = path.join(OUT_MP4_DIR, `${id}.mp4`);
    const kfDst = path.join(OUT_KF_DIR, `${id}.jpg`);
    const f0Src = path.join(framesSrcDir, `${id}-f0.png`);
    const f3Src = path.join(framesSrcDir, `${id}-f3.png`);
    const thumbFile = thumbNameById.get(id);
    const thumbDst = thumbFile ? path.join(OUT_THUMBS_DIR, thumbFile) : null;

    const mp4Mtime = fs.statSync(mp4Src).mtimeMs;
    const f3Mtime = fs.statSync(f3Src).mtimeMs;
    const f0Mtime = fs.statSync(f0Src).mtimeMs;
    const latestSrcMtime = Math.max(mp4Mtime, f0Mtime, f3Mtime);

    const mp4Fresh = !force && fs.existsSync(mp4Dst) && fs.statSync(mp4Dst).mtimeMs >= mp4Mtime;
    const kfFresh = !force && fs.existsSync(kfDst) && fs.statSync(kfDst).mtimeMs >= latestSrcMtime;
    const thumbFresh = !thumbDst || (!force && fs.existsSync(thumbDst) && fs.statSync(thumbDst).mtimeMs >= f3Mtime);

    if (mp4Fresh && kfFresh && thumbFresh) {
      skippedCount++;
      return;
    }

    if (!mp4Fresh) {
      fs.copyFileSync(mp4Src, mp4Dst);
    }

    if (!kfFresh) {
      const TILE = 400;
      const FULL = TILE * 2;
      const sheetRgb = Buffer.allocUnsafe(FULL * FULL * 3);
      const offsets = [
        [0, 0],
        [TILE, 0],
        [0, TILE],
        [TILE, TILE],
      ];
      for (let i = 0; i < 4; i++) {
        const fp = path.join(framesSrcDir, `${id}-f${i}.png`);
        const dec = decodePngRgb24(fp);
        downsampleTile(dec.rgb, dec.width, dec.height, sheetRgb, FULL, offsets[i][0], offsets[i][1], TILE);
      }
      const tmpPng = path.join(tmpDir, `${id}-kf.png`);
      writeRgb24Png(sheetRgb, FULL, FULL, tmpPng);
      await execFileAsync('/usr/bin/sips', [
        '-s', 'format', 'jpeg',
        '-s', 'formatOptions', '86',
        tmpPng, '--out', kfDst,
      ]);
      fs.rmSync(tmpPng, { force: true });
    }

    if (thumbDst && !thumbFresh) {
      const tmpThumb = path.join(tmpDir, `${id}-thumb.jpg`);
      await execFileAsync('/usr/bin/sips', [
        '-s', 'format', 'jpeg',
        '-s', 'formatOptions', '88',
        '-z', '400', '400',
        f3Src, '--out', tmpThumb,
      ]);
      fs.copyFileSync(tmpThumb, thumbDst);
      fs.rmSync(tmpThumb, { force: true });
    }

    updatedCount++;
  }

  try {
    await Promise.all(
      Array.from({ length: WORKERS }, async () => {
        while (true) {
          const i = cursor++;
          if (i >= readyIds.length) break;
          await processOne(readyIds[i]);
        }
      }),
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  fs.writeFileSync(INDEX_FILE, `${JSON.stringify(readyIds, null, 2)}\n`);
  console.log(`Synced sculpture animations: total=${readyIds.length}, updated=${updatedCount}, unchanged=${skippedCount}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
