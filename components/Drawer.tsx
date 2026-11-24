'use client';

import { useState } from 'react';
import { MEAL_LABEL } from '@/lib/date';
import { MEMORY_KIND_LABEL, type TodayPayload } from '@/lib/types';

export default function Drawer({
  today,
  onClose,
  onDeleteMeal,
  onDeleteMemory,
}: {
  today: TodayPayload | null;
  onClose: () => void;
  onDeleteMeal: (id: number) => Promise<void>;
  onDeleteMemory: (id: number) => Promise<void>;
}) {
  const [tab, setTab] = useState<'meals' | 'memory'>('meals');

  return (
    <div className="drawer" onClick={onClose}>
      <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="tabs">
          <button className={tab === 'meals' ? 'on' : ''} onClick={() => setTab('meals')}>
            今日记录
          </button>
          <button className={tab === 'memory' ? 'on' : ''} onClick={() => setTab('memory')}>
            记忆
          </button>
          <div style={{ flex: 1 }} />
          <button onClick={onClose}>关闭</button>
        </div>

        {tab === 'meals' && (
          <div>
            {!today || today.meals.length === 0 ? (
              <p className="empty">今天还没有记录，拍张照就开始了。</p>
            ) : (
              today.meals.map((m) => (
                <div className="meal-item" key={m.id}>
                  <div>
                    <div>
                      {MEAL_LABEL[m.meal_type]} · <b>{m.kcal} kcal</b> · 蛋白 {m.protein}g
                    </div>
                    <div className="sub">{m.items.map((i) => `${i.name} ${i.grams}g`).join('、')}</div>
                  </div>
                  <button className="del" onClick={() => onDeleteMeal(m.id)}>
                    删除
                  </button>
                </div>
              ))
            )}
            {today && today.meals.length > 0 && (
              <p className="sub" style={{ color: 'var(--muted)', fontSize: 12, marginTop: 14 }}>
                合计 {today.consumed.kcal} kcal ｜ 蛋白 {Math.round(today.consumed.protein)}g ｜ 碳水{' '}
                {Math.round(today.consumed.carb)}g ｜ 脂肪 {Math.round(today.consumed.fat)}g
              </p>
            )}
          </div>
        )}

        {tab === 'memory' && (
          <div>
            {!today || today.memories.length === 0 ? (
              <p className="empty">
                还没有保存过偏好。提到伤病限制、忌口或者可用器械时，可以一键记下来。
              </p>
            ) : (
              today.memories.map((m) => (
                <div className="meal-item" key={m.id}>
                  <div>
                    <div>
                      <span className={`mem-kind ${m.kind}`}>{MEMORY_KIND_LABEL[m.kind]}</span>{' '}
                      <span style={{ fontSize: 13 }}>{m.content}</span>
                    </div>
                  </div>
                  <button className="del" onClick={() => onDeleteMemory(m.id)}>
                    删除
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
