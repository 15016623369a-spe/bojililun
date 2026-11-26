import fs from 'node:fs';
import path from 'node:path';

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

type SculptureMedia = { hasSculpture: boolean; mp4Url?: string; kfSheetUrl?: string };

let cachedPublicSet: { mtimeMs: number; set: Set<string> } | null = null;
const mediaCache = new Map<string, SculptureMedia>();

function loadPublicSet(): Set<string> {
  const indexPath = path.join(process.cwd(), 'data', 'sculpture-exercises.json');
  try {
    const stat = fs.statSync(indexPath);
    if (cachedPublicSet && cachedPublicSet.mtimeMs === stat.mtimeMs) return cachedPublicSet.set;
    const list = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    if (Array.isArray(list)) {
      const set = new Set(list.map(String));
      cachedPublicSet = { mtimeMs: stat.mtimeMs, set };
      mediaCache.clear();
      return set;
    }
  } catch {
    /* ignore broken index */
  }
  return cachedPublicSet?.set ?? new Set();
}

function localAnimRoot(): string {
  return path.resolve(process.env.SCULPTURE_SRC_DIR || path.join(process.cwd(), '..', 'output', 'exercise-anims'));
}

export function isValidExerciseId(id: string): boolean {
  return SAFE_ID.test(id);
}

export function inPublicSculptureSet(id: string): boolean {
  if (!isValidExerciseId(id)) return false;
  if (loadPublicSet().has(id)) return true;
  return (
    fs.existsSync(path.join(process.cwd(), 'public', 'sculpture-exercises', 'mp4', `${id}.mp4`)) &&
    fs.existsSync(path.join(process.cwd(), 'public', 'sculpture-exercises', 'kf', `${id}.jpg`))
  );
}

export function hasLocalDevSculptureAnim(id: string): boolean {
  if (!isValidExerciseId(id)) return false;
  const root = localAnimRoot();
  return (
    fs.existsSync(path.join(root, 'mp4', `${id}.mp4`)) &&
    fs.existsSync(path.join(root, 'sheets', `${id}.png`))
  );
}

export function hasSculptureAnim(id: string): boolean {
  return sculptureMediaUrls(id).hasSculpture;
}

export function sculptureMediaUrls(id: string): SculptureMedia {
  if (!isValidExerciseId(id)) return { hasSculpture: false };
  loadPublicSet(); // 若索引文件更新则自动失效缓存
  const hit = mediaCache.get(id);
  if (hit) return hit;
  let result: SculptureMedia;
  if (inPublicSculptureSet(id)) {
    result = {
      hasSculpture: true,
      mp4Url: `/sculpture-exercises/mp4/${id}.mp4`,
      kfSheetUrl: `/sculpture-exercises/kf/${id}.jpg`,
    };
  } else if (hasLocalDevSculptureAnim(id)) {
    result = {
      hasSculpture: true,
      mp4Url: `/api/exercise-anim/${id}?kind=mp4`,
      kfSheetUrl: `/api/exercise-anim/${id}?kind=kf`,
    };
  } else {
    result = { hasSculpture: false };
  }
  mediaCache.set(id, result);
  return result;
}
