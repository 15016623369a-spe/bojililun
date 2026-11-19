// 把 public/models/review-front.png / review-back.png 描成 lib/body-map.json
// 依赖：npm i -D potrace pngjs（只在生成时用，运行时不需要）
import fs from 'node:fs';
import { PNG } from 'pngjs';
import potrace from 'potrace';
import { promisify } from 'node:util';

const trace = promisify(potrace.trace);
const IDS = [
  'chest_upper', 'chest_mid', 'chest_lower', 'serratus', 'delt_front', 'delt_side', 'delt_rear',
  'traps', 'lats', 'upperback', 'lowerback', 'biceps', 'triceps', 'forearms', 'abs', 'obliques',
  'glutes', 'quads', 'hamstrings', 'calves', 'adductors', 'neck',
];
const OPTS = { threshold: 128, turdSize: 30, optTolerance: 0.6, alphaMax: 1, color: '#000', background: 'transparent' };

const maskPng = (mask, width, height) => {
  const p = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    const v = mask[i] ? 0 : 255;
    p.data[i * 4] = v; p.data[i * 4 + 1] = v; p.data[i * 4 + 2] = v; p.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(p);
};
const paths = (svg) => [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);

async function build(src) {
  const { width, height, data } = PNG.sync.read(fs.readFileSync(src));
  const body = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) body[i] = data[i * 4 + 3] > 8 ? 1 : 0;
  const outline = paths(await trace(maskPng(body, width, height), { ...OPTS, turdSize: 60 }));

  const muscles = [];
  for (let id = 1; id <= IDS.length; id++) {
    const mask = new Uint8Array(width * height);
    let px = 0;
    for (let i = 0; i < width * height; i++) {
      if (data[i * 4 + 3] > 8 && data[i * 4] === id) { mask[i] = 1; px++; }
    }
    if (px < 40) continue;
    const d = paths(await trace(maskPng(mask, width, height), OPTS));
    if (d.length) muscles.push({ id: IDS[id - 1], d: d.join(' '), px });
  }
  return { width, height, outline: outline.join(' '), muscles };
}

const front = await build('public/models/review-front.png');
const back = await build('public/models/review-back.png');
fs.writeFileSync('lib/body-map.json', JSON.stringify({ width: front.width, height: front.height, front, back }));
console.log('front muscles:', front.muscles.length, 'back muscles:', back.muscles.length);
