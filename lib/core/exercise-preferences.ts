import { getDb } from '../db';

export type ExercisePreference = 'liked' | 'disliked';

export function getExercisePreferences(): Map<string, ExercisePreference> {
  const rows = getDb().prepare('SELECT exercise_id, preference FROM exercise_preference').all() as {
    exercise_id: string;
    preference: ExercisePreference;
  }[];
  return new Map(rows.map(({ exercise_id, preference }) => [exercise_id, preference]));
}

export function setExercisePreference(exerciseId: string, preference: ExercisePreference | null): boolean {
  const db = getDb();
  if (!db.prepare('SELECT 1 FROM exercise WHERE id = ?').get(exerciseId)) return false;

  if (preference === null) {
    db.prepare('DELETE FROM exercise_preference WHERE exercise_id = ?').run(exerciseId);
  } else {
    db.prepare(`
      INSERT INTO exercise_preference (exercise_id, preference) VALUES (?, ?)
      ON CONFLICT (exercise_id) DO UPDATE SET preference = excluded.preference
    `).run(exerciseId, preference);
  }

  return true;
}
