import fs from 'node:fs';
import path from 'node:path';

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

function loadPublicSet(): Set<string> {
  const indexPath = path.join(process.cwd(), 'data', 'sculpture-exercises.json');
  try {
    if (fs.existsSync(indexPath)) {
      const list = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      if (Array.isArray(list)) return new Set(list.map(String));
    }
  } catch {
    /* ignore broken index */
  }
  return new Set();
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
  return inPublicSculptureSet(id) || hasLocalDevSculptureAnim(id);
}

export function sculptureMediaUrls(id: string): {
  hasSculpture: boolean;
  mp4Url?: string;
  kfSheetUrl?: string;
} {
  if (inPublicSculptureSet(id)) {
    return {
      hasSculpture: true,
      mp4Url: `/sculpture-exercises/mp4/${id}.mp4`,
      kfSheetUrl: `/sculpture-exercises/kf/${id}.jpg`,
    };
  }
  if (hasLocalDevSculptureAnim(id)) {
    return {
      hasSculpture: true,
      mp4Url: `/api/exercise-anim/${id}?kind=mp4`,
      kfSheetUrl: `/api/exercise-anim/${id}?kind=kf`,
    };
  }
  return { hasSculpture: false };
}
