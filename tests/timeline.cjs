const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

require.extensions['.ts'] = (mod, name) =>
  mod._compile(
    ts.transpileModule(fs.readFileSync(name, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    name,
  );

const { buildWorkoutTimeline, formatClock } = require('../lib/timeline.ts');

const makePlan = (id, exerciseId, name, position, opts = {}) => ({
  id,
  date: '2026-11-25',
  exercise_id: exerciseId,
  name,
  body_part: 'chest',
  target: 'pectorals',
  equipment: 'barbell',
  sets: opts.sets ?? 3,
  reps: opts.reps ?? 10,
  weight: opts.weight ?? 60,
  rest_sec: opts.rest_sec ?? 90,
  position,
  done: opts.done ?? 0,
  supplemental: 0,
  created_at: '2026-11-25T10:00:00.000Z',
});

const makeSet = (id, planItemId, exerciseId, name, setIndex, weight, reps, durationSec, actualRestSec, createdAt) => ({
  id,
  session_id: 1,
  plan_item_id: planItemId,
  exercise_id: exerciseId,
  exercise_name: name,
  body_part: 'chest',
  target: 'pectorals',
  set_index: setIndex,
  weight,
  reps,
  duration_sec: durationSec,
  rest_sec: 90,
  actual_rest_sec: actualRestSec,
  created_at: createdAt,
});

test('时间轴算法：完整拆分力训段、组间休息段、换项段并推算后续大项时间窗', () => {
  const plan = [
    makePlan(1, '0025', '杠铃卧推', 1, { sets: 2, rest_sec: 90 }),
    makePlan(2, '0043', '杠铃深蹲', 2, { sets: 3, rest_sec: 120 }),
    makePlan(3, '0289', '哑铃侧平举', 3, { sets: 3, rest_sec: 60 }),
  ];
  const base = Date.parse('2026-11-25T11:00:00.000Z');
  const sets = [
    // 第1组：11:00:00 开始，力训 30s，11:00:30 结束，随后休 90s
    makeSet(1, 1, '0025', '杠铃卧推', 1, 60, 10, 30, 90, new Date(base + 30_000).toISOString()),
    // 第2组：11:02:00 开始，力训 40s，11:02:40 结束，随后换项 150s
    makeSet(2, 1, '0025', '杠铃卧推', 2, 70, 8, 40, 150, new Date(base + 160_000).toISOString()),
    // 换项到深蹲第1组：11:05:10 开始，力训 35s，11:05:45 结束
    makeSet(3, 2, '0043', '杠铃深蹲', 1, 100, 5, 35, null, new Date(base + 345_000).toISOString()),
  ];

  const nowMs = base + 390_000; // 45s after set 3
  const tl = buildWorkoutTimeline({ plan, sets, activePlanItemId: 2, liftingState: null, nowMs });

  assert.equal(tl.blocks.length, 3);
  assert.equal(tl.blocks[0].name, '杠铃卧推');
  assert.equal(tl.blocks[0].setCount, 2);
  assert.equal(tl.blocks[0].liftTotalSec, 70);
  assert.equal(tl.blocks[0].restTotalSec, 90);
  assert.equal(tl.blocks[0].segments.map((s) => s.kind).join(','), 'lift,rest,lift');
  // 第2组 70x8 > 第1组 60x10，仅第2组标最佳
  assert.equal(tl.blocks[0].segments[0].isBest, false);
  assert.equal(tl.blocks[0].segments[2].isBest, true);

  // 第二个大项为深蹲，带精确换项时长 150s
  assert.equal(tl.blocks[1].name, '杠铃深蹲');
  assert.equal(tl.blocks[1].status, 'active');
  assert.equal(tl.blocks[1].transitionBeforeSec, 150);

  // 第三个大项尚未开练，自动推算出未来时间窗
  assert.equal(tl.blocks[2].name, '哑铃侧平举');
  assert.equal(tl.blocks[2].status, 'upcoming');
  assert.equal(tl.blocks[2].isProjected, true);
  assert.ok(tl.blocks[2].startMs >= nowMs);
  assert.ok(tl.blocks[2].endMs > tl.blocks[2].startMs);

  // 总时长守恒汇总
  assert.equal(tl.totalLiftSec, 105);
  assert.equal(tl.totalRestSec, 90);
  assert.equal(tl.totalTransitionSec, 150);
  assert.equal(tl.liveRestSec, 45);
  assert.equal(formatClock(150), '02:30');
});

test('时间轴算法：调整待练大项顺序后时间窗实时重算，力训中锁定前段休息时长', () => {
  const plan = [
    makePlan(2, '0043', '杠铃深蹲', 1, { sets: 2, rest_sec: 60 }),
    makePlan(3, '0289', '哑铃侧平举', 2, { sets: 4, rest_sec: 90 }),
  ];
  const base = Date.parse('2026-11-25T11:00:00.000Z');
  const tl = buildWorkoutTimeline({
    plan,
    sets: [],
    activePlanItemId: 2,
    liftingState: { planItemId: 2, startedAtMs: base + 10_000 },
    nowMs: base + 28_000,
  });
  assert.equal(tl.blocks[0].status, 'active');
  assert.equal(tl.blocks[0].isProjected, false);
  assert.equal(tl.liveLiftSec, 18);
  assert.equal(tl.blocks[1].status, 'upcoming');
  assert.ok(tl.blocks[1].startMs > tl.blocks[0].endMs);
});

const { applyCardDrop, buildHorizontalSlots } = require('../lib/timeline.ts');

test('横向时间轴算法：支持卡片左右调序、同列叠放与拆开，并动态重算横轴时间窗', () => {
  // 初始三列：[1], [2], [3]
  const stacked = applyCardDrop([[1], [2], [3]], 3, 1, 'stack');
  assert.deepEqual(stacked, [[1], [2, 3]]);

  // 把叠放中的 3 拖到第 0 列之前，自动拆成独立一列
  const unstacked = applyCardDrop(stacked, 3, 0, 'before');
  assert.deepEqual(unstacked, [[3], [1], [2]]);

  // 叠放同一时段后，横向槽位合并为一列且推算时长等于叠放卡片之和
  const plan = [
    makePlan(1, '0025', '杠铃卧推', 1, { sets: 2, rest_sec: 60 }),
    makePlan(2, '0043', '杠铃深蹲', 2, { sets: 2, rest_sec: 60 }),
    makePlan(3, '0289', '哑铃侧平举', 3, { sets: 2, rest_sec: 60 }),
  ];
  const base = Date.parse('2026-11-25T11:00:00.000Z');
  const tl = buildWorkoutTimeline({ plan, sets: [], activePlanItemId: 1, liftingState: null, nowMs: base });
  const { slots } = buildHorizontalSlots(tl, [[1], [2, 3]], base);
  assert.equal(slots.length, 2);
  assert.deepEqual(slots[1].cards.map((c) => c.planItemId), [2, 3]);
  assert.ok(slots[1].endMs - slots[1].startMs > slots[0].endMs - slots[0].startMs);
});
