'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Onboarding from './Onboarding';
import { ACTIVITY, GOAL } from '@/lib/nutrition';

export interface ProfileLite {
  name: string;
  sex: string;
  age: number;
  height_cm: number;
  weight_kg: number;
  activity: string;
  goal: string;
  target_kcal: number;
  target_protein: number;
}

export default function ProfileEditor({ profile }: { profile: ProfileLite | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <section className="block profile-card">
        {profile ? (
          <>
            <div className="pc-head">
              <div>
                <h2>{profile.name || '我'}</h2>
                <p>
                  {profile.sex === 'female' ? '女' : '男'} · {profile.age} 岁 · {profile.height_cm} cm ·{' '}
                  {profile.weight_kg} kg
                </p>
              </div>
              <button className="chip-btn" onClick={() => setOpen(true)}>
                编辑
              </button>
            </div>
            <div className="pc-tags">
              <span>{GOAL[profile.goal as keyof typeof GOAL]?.label ?? profile.goal}</span>
              <span>{ACTIVITY[profile.activity as keyof typeof ACTIVITY]?.label ?? profile.activity}</span>
            </div>
          </>
        ) : (
          <>
            <div className="pc-head">
              <div>
                <h2>还没有个人资料</h2>
                <p>填一下身高体重，才能算热量目标和训练建议</p>
              </div>
            </div>
            <button className="btn primary" onClick={() => setOpen(true)}>
              填写资料
            </button>
          </>
        )}
      </section>

      {open && (
        <Onboarding
          initial={
            profile
              ? {
                  sex: profile.sex,
                  age: profile.age,
                  height_cm: profile.height_cm,
                  weight_kg: profile.weight_kg,
                  activity: profile.activity,
                  goal: profile.goal,
                }
              : undefined
          }
          onDone={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
