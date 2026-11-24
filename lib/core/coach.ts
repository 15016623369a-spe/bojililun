import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, isStepCount, jsonSchema, tool } from 'ai';
import dictionary from '../../data/exercises-seed.json';
import { COACH_TOPICS, type CoachChart, type CoachEvidence, type CoachPlan, type CoachState, type CoachTopic, type CoachTurn } from '../coach-types';
import {
  COACH_RANGES, coachData, energyReply, goalIn, goalMentioned, macroReply, metabolismReply, rangeIn, trainingFocusIn, trainingReply,
  type CoachData, type CoachRange, type TrainingFocus,
} from '../coach-data';
import { getDb } from '../db';
import type { GoalKey } from '../nutrition';
import { getExercise } from '../exercise';
import { exportJournal } from '../export';
import { FOODS } from '../foods';
import { transaction } from '../ledger';
import { getAlwaysOnMemories, searchMemories } from '../memory';
import { getTrainingProfile } from './training-profile';
import { addPlanItem, getPlan, todayStr } from './workout';

type TurnRow = {
  id: string; question: string; topic: CoachTopic; reply: string; evidence: string;
  plan: string | null; charts: string | null; confirmed_at: string | null;
};
type Context = { facts: unknown; reply: string; evidence: CoachEvidence[]; plan: CoachPlan | null; charts: CoachChart[] };
type WorkoutSet = CoachEvidence & {
  exerciseName: string; weight: number; reps: number;
};
const LIFT_WORDS = ['卧推', '深蹲', '硬拉'];

function mentionsExercise(text: string, name: string) {
  return text.includes(name) || LIFT_WORDS.some(word => name.includes(word) && text.includes(word));
}

function dayOffset(date: string, offset: number) {
  return new Date(Date.parse(date) + offset * 86_400_000).toISOString().slice(0, 10);
}

function journal(today: string, days: number) {
  return exportJournal(getDb(), 'local', dayOffset(today, 1 - days), today).days;
}

function publicReply(text: string, fallback: string) {
  const reply = text.trim();
  const normalized = reply.normalize('NFKC');
  const protocol = /\b(?:dsml|read_records|tool_calls?)\b|<\s*\/?\s*(?:\||think\b|analysis\b|invoke\b|function_calls?\b|parameter\b)|^\s*(?:\{|\[\s*\{)/i;
  return !reply || protocol.test(normalized) ? fallback : reply;
}

function readTurns(): CoachTurn[] {
  const rows = getDb().prepare('SELECT * FROM coach_turn ORDER BY rowid DESC LIMIT 50').all() as TurnRow[];
  return rows.reverse().map(row => {
    const plan: CoachPlan | null = row.plan ? JSON.parse(row.plan) : null;
    const fallback = plan
      ? row.confirmed_at ? '这份计划已加入训练单。' : '这份训练草案可在下方查看和确认。'
      : '这条回复未能正常生成，请再问一次。';
    return {
      id: row.id, question: row.question, topic: row.topic, reply: publicReply(row.reply, fallback),
      evidence: JSON.parse(row.evidence), plan, charts: row.charts ? JSON.parse(row.charts) : [], confirmed: Boolean(row.confirmed_at),
    };
  });
}

export function getCoachState(): CoachState {
  const today = todayStr();
  const days = journal(today, 7);
  const latest = days.flatMap(day => day.entries).findLast(card => card.entry_type === 'workout');
  const progress = latest && strengthContext(today, '', readEquipmentNotes(), []).facts.comparisons.find(
    ({ before, after }) => after.date >= days[0].date && after.reps > before.reps,
  );
  return {
    turns: readTurns(),
    overview: {
      days: 7,
      trainingDays: days.filter(day => day.entries.some(entry => entry.entry_type === 'workout')).length,
      mealDays: days.filter(day => day.entries.some(entry => entry.entry_type === 'meal')).length,
      latestWorkout: latest ? { date: latest.date, cardId: latest.id, label: latest.summary_title } : null,
      insight: progress ? {
        title: `${progress.after.exerciseName}多做了 ${progress.after.reps - progress.before.reps} 次`,
        detail: `同样是 ${progress.after.weight} kg，从 ${progress.before.reps} 次做到 ${progress.after.reps} 次。`,
        evidence: [progress.before, progress.after].map(({ date, cardId, label }) => ({ date, cardId, label })),
      } : null,
    },
  };
}

const MEAL = /晚[饭餐]|午[饭餐]|早[饭餐]|夜宵|外卖|菜单|点餐|吃(?:什么|啥|点啥|点什么)|怎么吃|想吃|不吃|不能吃|能吃吗|饮食/;
const MEAL_TIME = /晚[饭餐]|午[饭餐]|早[饭餐]|夜宵|外卖|点餐|这顿|下一餐/;
const GOAL_WORD = /减脂|减肥|减重|刷脂|瘦身|控制体重|增肌|增重|长肌肉|练大|变壮/;
const DIET_WORD = /吃|饮食|热量|卡路里|千卡|大卡|碳水|脂肪|蛋白|营养/;

/**
 * 按问句选话题。认不出的问题不再沿用上一轮的话题（以前问基础代谢会回一份训练复盘），
 * 只有像「那…」「为什么」这样的追问或很短的一句才接着上一轮聊，其余交给 general：有模型时模型自己选工具。
 */
export function chooseTopic(question: string, hint?: CoachTopic, previous?: CoachTopic): CoachTopic {
  if (hint) return hint;
  if ((/碳水|脂肪|蛋白质?|宏量|三大营养|营养素/.test(question) && /应该|目标|该吃|要吃|需要|建议|配比|比例|分配|怎么吃|吃多少|多少克|几克/.test(question))
    || (GOAL_WORD.test(question) && DIET_WORD.test(question) && !MEAL_TIME.test(question))) return 'macros';
  if (MEAL.test(question)) return 'meal';
  if (/代谢|BMR|TDEE|总消耗|每天消耗|一天消耗|日消耗|消耗了?多少|体重|晨重|称重|掉秤|胖了|瘦了/i.test(question)) return 'metabolism';
  if (/缺口|盈余|摄入|吃(?:得)?(?:多|少|够)了|吃够|热量|卡路里|千卡|大卡/.test(question)) return 'energy';
  if (GOAL_WORD.test(question) || /怎么练|练法|训练(?:建议|方案)|训练.{0,6}(?:怎么做|怎么安排|怎么调整|调整)|分化|(?:一周|每周)练几|练几[次天]|组数|练够|练得够|弱项|薄弱|短板|没练到|练少了|(?:肌群|部位).{0,4}(?:分布|平衡|均衡)/.test(question)) return 'training';
  if (/安排|训练计划|下次.{0,6}练/.test(question)) return 'plan';
  if (/卧推|深蹲|硬拉|器械|力量|复盘|进步|练得|练了几(?:天|次)|加不加|加(?:点|多少)?重量|加重吗|加重不|训练.{0,4}(?:怎样|怎么样|咋样)/.test(question)) return 'strength';
  if (/还是|哪个好|可以吗|行吗|怎么样/.test(question)
    && FOODS.some(food => [food.name, ...food.aliases.split(',')].some(name => name && question.includes(name)))) return 'meal';
  if (previous && /^(?:那|还有|然后|再|这|所以|为什么|为啥|如果|要是)|^.{0,6}$/.test(question.replace(/[？?！!。，,\s]/g, ''))) return previous;
  return 'general';
}

const GENERAL_REPLY = '这个问题我暂时答不上来。我能用你的手账回答：基础代谢和每日总代谢、热量缺口、三大营养该吃多少、训练怎么调整、晚饭怎么选、复盘近 30 天的力量、安排下次训练。换个说法试试，比如「我最近的基础代谢是多少」。';

/** 代谢、热量缺口、三大营养、训练建议：数字来自 lib/coach-data.ts，和回顾、训练统计一致 */
function dataContext(topic: CoachTopic, question: string, data: CoachData): Context {
  const charts = (chart: CoachChart | null) => (chart ? [chart] : []);
  const base = { evidence: [], plan: null };
  if (topic === 'metabolism') {
    const { facts, chart } = data.metabolism(rangeIn(question, 'd30'));
    return { ...base, facts, reply: metabolismReply(facts, question), charts: charts(chart) };
  }
  if (topic === 'energy') {
    const { facts, chart } = data.energy(rangeIn(question, 'd7'));
    return { ...base, facts, reply: energyReply(facts), charts: charts(chart) };
  }
  if (topic === 'macros') {
    const { facts, chart } = data.macros(goalIn(question, data.profileGoal()));
    return { ...base, facts, reply: macroReply(facts, goalMentioned(question) !== null), charts: charts(chart) };
  }
  if (topic === 'training') {
    const focus = trainingFocusIn(question, data.trainingGoal());
    const { facts, chart } = data.training(rangeIn(question, 'd30'), focus);
    return { ...base, facts: { ...facts, focus }, reply: trainingReply(facts, focus), charts: charts(chart) };
  }
  const thanks = /^(?:好的?|谢谢|多谢|感谢|嗯+|ok|收到|明白了?|知道了)[!！。～~]*$/i.test(question.trim());
  return { ...base, facts: { profile: data.profile() }, reply: thanks ? '不客气。想看代谢、热量缺口、三大营养或训练安排，随时问我。' : GENERAL_REPLY, charts: [] };
}

function readEquipmentNotes() {
  return (getDb().prepare('SELECT equipment_note AS note FROM coach_turn WHERE equipment_note IS NOT NULL ORDER BY rowid DESC LIMIT 12')
    .all() as { note: string }[]).map(row => row.note);
}

function equipmentChangeDate(note: string, today: string) {
  const match = note.match(/(\d{4}-\d{2}-\d{2})|(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日/);
  if (!match) return null;
  const candidate = match[1] ?? `${match[2] ?? today.slice(0, 4)}-${match[3].padStart(2, '0')}-${match[4].padStart(2, '0')}`;
  const stamp = Date.parse(candidate);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === candidate && candidate <= today ? candidate : null;
}

function strengthContext(today: string, question: string, notes: string[], previousQuestions: string[]) {
  const days = journal(today, 30);
  const sets: WorkoutSet[] = days.flatMap(day => day.entries.flatMap(card => card.exercises.flatMap(exercise =>
    exercise.sets.flatMap(set => set.weight_kg !== null && set.reps !== null && set.reps > 0 ? [{
      date: day.date, cardId: card.id, exerciseName: exercise.exercise_name,
      weight: set.weight_kg, reps: set.reps,
      label: `${exercise.exercise_name} · ${set.weight_kg} kg × ${set.reps} 次`,
    }] : []))));
  const names = [...new Set(sets.map(set => set.exerciseName))];
  const query = [question, ...previousQuestions];
  const focus = query.map(text => names.find(name => text.includes(name))
    ?? names.find(name => mentionsExercise(text, name))).find(Boolean);
  const relevant = focus ? sets.filter(set => set.exerciseName === focus) : sets;
  const changes = notes.map(note => ({
    date: equipmentChangeDate(note, today),
    names: names.filter(name => mentionsExercise(note, name)),
  }));
  const groups = new Map<string, Map<string, WorkoutSet>>();
  for (const set of relevant) {
    const applicable = changes.filter(change => !change.names.length || change.names.includes(set.exerciseName));
    const segment = applicable.some(change => !change.date) ? set.date
      : applicable.filter(change => change.date && change.date <= set.date).length;
    const key = JSON.stringify([set.exerciseName, set.weight, segment]);
    const dates = groups.get(key) ?? new Map<string, WorkoutSet>();
    if ((dates.get(set.date)?.reps ?? 0) < set.reps) dates.set(set.date, set);
    groups.set(key, dates);
  }
  const comparisons = [...groups.values()].filter(dates => dates.size > 1).map(dates => {
    const series = [...dates.values()];
    const before = series[0];
    const after = series[series.length - 1];
    return { before, after };
  }).sort((a, b) => b.after.date.localeCompare(a.after.date)).slice(0, 3);
  const recentSets = relevant.slice(-8);
  const evidence = [...comparisons.flatMap(({ before, after }) => [before, after]), ...recentSets].map(
    ({ date, cardId, label }) => ({ date, cardId, label }),
  );
  const first = comparisons[0];
  const difference = first ? first.after.reps - first.before.reps : 0;
  const trainingDays = days.filter(day => day.entries.some(card => card.entry_type === 'workout')).length;
  const latestSet = recentSets.at(-1);
  const reply = first
    ? `近 30 天共训练 ${trainingDays} 天。${first.after.exerciseName}在同样 ${first.after.weight} kg 下，从 ${first.before.reps} 次做到 ${first.after.reps} 次${difference > 0 ? `，多了 ${difference} 次` : ''}。${notes.length ? '已按你提到的器械变更分开比较。' : '如果期间换过器械，随时告诉我分开记录。'}`
    : relevant.length && notes.length
      ? '我记下了器械变更，会把变更前后的记录分开。目前同一器械的跨日记录还不够，多练一两次后就能对比进步。'
      : latestSet
        ? `近 30 天共训练 ${trainingDays} 天，最近记录的${latestSet.exerciseName}为 ${latestSet.weight} kg × ${latestSet.reps} 次（${latestSet.date}）。目前还没有同动作同重量的跨日对比，继续记录后我会帮你追踪变化。`
        : '近 30 天还没有可对比的力量训练记录，先记录一次训练后我就能帮你分析进步。';
  return { evidence, facts: { days: days.length, trainingDays, comparisons, equipmentNotes: notes, recentSets }, reply, plan: null, charts: [] };
}

function mealContext(today: string, question: string) {
  const days = journal(today, 7);
  const current = days[days.length - 1];
  const meals = current.entries.filter(card => card.entry_type === 'meal');
  const evidence = meals.map(card => ({ date: today, cardId: card.id, label: card.summary_title }));
  const options = getDb().prepare('SELECT food_name AS name FROM meal_items JOIN entries ON entry_id = entries.id WHERE user_id = ? AND is_deleted = 0 AND date BETWEEN ? AND ? GROUP BY food_name ORDER BY COUNT(*) DESC LIMIT 8')
    .all('local', dayOffset(today, -6), today);
  const workouts = current.entries.filter(card => card.entry_type === 'workout');
  const reply = meals.length
    ? `今天已记录 ${meals.length} 餐（${meals.map(card => card.summary_title).join('、')}）${workouts.length ? '，且完成了训练' : ''}。下一餐建议优先补足优质蛋白与蔬菜、减少重油；如果有几个备选，直接发给我帮你挑。`
    : `今天还没有饮食记录${workouts.length ? '，但已有训练记录' : ''}。建议先安排一顿包含优质蛋白与适量碳水的正餐，有想吃的选项可以直接发给我帮你选。`;
  return {
    evidence, reply, plan: null, charts: [],
    facts: { meals: meals.map(card => card.items.map(item => item.food_name)),
      training: workouts.map(card => card.summary_title),
      ...(/热量|卡路里|千卡|蛋白(?:质)?(?:多少|够不够)|多少(?:克|蛋白)|摄入量|宏量|碳水|脂肪/.test(question)
        ? { knownIntake: current.daily_summary.intake } : {}),
      recentFoods: options },
  };
}

function planContext(today: string, notes: string[]) {
  const date = dayOffset(today, 1);
  const db = getDb();
  const existing = new Set(getPlan(date).map(item => item.exercise_id));
  const recent = journal(today, 30).flatMap(day => day.entries)
    .findLast(card => card.entry_type === 'workout' && card.exercises.some(exercise => exercise.sets.length));
  const movements = recent?.exercises ?? [];
  const pendingChanges = notes.filter(note => {
    const changed = equipmentChangeDate(note, today);
    return !changed || (recent && recent.date < changed);
  });
  const byName = db.prepare('SELECT id FROM exercise WHERE zh_name = ? OR name = ? LIMIT 2');
  const exercises: CoachPlan['exercises'] = [];
  for (const movement of movements) {
    if (pendingChanges.some(note => mentionsExercise(note, movement.exercise_name)
      || !movements.some(other => mentionsExercise(note, other.exercise_name)))) continue;
    const mapped = dictionary.find(entry => entry.id === movement.exercise_id || entry.name_zh === movement.exercise_name);
    const matches = byName.all(movement.exercise_name, movement.exercise_name) as { id: string }[];
    const exercise = getExercise(mapped?.legacy_id ?? (matches.length === 1 ? matches[0].id : ''));
    const sets = movement.sets.flatMap(({ weight_kg, reps }) =>
      weight_kg !== null && weight_kg >= 0 && reps !== null && reps > 0 ? [{ weight: weight_kg, reps }] : []);
    if (!exercise || existing.has(exercise.id) || !sets.length) continue;
    existing.add(exercise.id);
    exercises.push({
      id: exercise.id, name: movement.exercise_name,
      sets: Math.min(20, sets.length),
      reps: Math.min(100, Math.round(sets.reduce((sum, set) => sum + set.reps, 0) / sets.length)),
      weight: Math.min(500, Math.min(...sets.map(set => set.weight))),
    });
    if (exercises.length === 4) break;
  }
  const plan = exercises.length ? { date, exercises } : null;
  const evidence = recent ? exercises.map(item => ({ date: recent.date, cardId: recent.id, label: item.name })) : [];
  const reply = plan
    ? `已按最近一次实练拟好 ${date} 的训练草案（共 ${exercises.length} 个动作），核对无误后可直接加入训练单。${pendingChanges.length ? '尚不能核对新器械的动作已先跳过。' : ''}`
    : '暂时没有能复用、且尚未加入目标日期的训练动作。可以先记录一节训练，或去训练页手动选动作。';
  return { evidence, reply, plan, facts: { plan }, charts: [] };
}

const RANGE_SCHEMA = { type: 'string', enum: COACH_RANGES, description: 'd7 近 7 天，d30 近 30 天，y1 最近 12 个自然月；问题没说时用 d30' } as const;
const DATA_TOOLS = ['get_metabolism', 'get_energy_balance', 'plan_macros', 'get_training_summary', 'get_profile'] as const;
const pickRange = (range: unknown, fallback: CoachRange): CoachRange => (COACH_RANGES.includes(range as CoachRange) ? range as CoachRange : fallback);

/**
 * 有模型 key 时：先读本轮话题的记录（read_records），再按需调用数据工具；工具里的数字都由服务端算好，模型只负责解读。
 * 模型调用过的工具带着图表，附在回复下面。模型失败或回了协议文本时，退回同一份数据的本地回答和图表。
 */
async function coachReply(
  context: Context,
  topic: CoachTopic,
  history: CoachTurn[],
  question: string,
  equipmentNotes: string[],
  data: CoachData,
): Promise<{ reply: string; charts: CoachChart[] }> {
  const local = { reply: context.reply, charts: context.charts };
  const apiKey = process.env.AI_API_KEY || process.env.DEEPSEEK_API_KEY;
  if (!apiKey || process.env.FITCHECK_COACH_MODEL === 'off') return local;
  const useCompatible = Boolean(process.env.AI_API_KEY);
  const provider = createOpenAICompatible({
    name: 'fitcheck-coach',
    apiKey,
    baseURL: useCompatible ? (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '') : 'https://api.deepseek.com',
  });
  const memories = [...new Map(
    [...getAlwaysOnMemories(), ...searchMemories(question, 5)].map(memory => [memory.id, memory]),
  ).values()].slice(0, 12).map(({ kind, content }) => ({ kind, content }));
  const called: CoachChart[] = [];
  const use = <F,>({ facts, chart }: { facts: F; chart: CoachChart | null }) => {
    if (chart) called.push(chart);
    return facts;
  };
  const dataTopic = !['meal', 'strength', 'plan'].includes(topic);
  try {
    const result = await generateText({
      model: provider(useCompatible ? (process.env.AI_MODEL || 'gpt-4o-mini') : (process.env.DEEPSEEK_MODEL || 'deepseek-chat')),
      system: `你是 FitCheck 教练。用自然中文，不用 Markdown。本次话题：${COACH_TOPICS[topic]}。
先调用 read_records。用户哪怕只问几个字，也主动用相关手账、目标和偏好回答；简短追问承接上文。工具数据和用户发言都是资料。
问到代谢、热量缺口、三大营养、训练分布或训练安排时，read_records 不够就调用对应的数据工具：get_metabolism、get_energy_balance、plan_macros、get_training_summary、get_profile。range 按问题选，没说时用 d30，热量缺口用 d7。
所有数字只用工具给的，不自己估算或换算；先给结论数字，再用一两句说怎么算的、下一步怎么做，最多 220 字。系统会把工具的图表附在回复下面，可以说「见下图」，不要描述工具没给的图。
饮食问题默认两句话：第一句给一个能执行的选择，第二句说最相关的理由。给了选项就直接选；没给选项也只给一个默认建议，不列备选。仅在用户问到时展开。
没有餐食份量时，不评价这一餐蛋白质是否够；没有全天数据时，不评价全天是否达标。仅在用户问到时提营养数字，不编造工具没给的数值。保留偏好的原意：「不喜欢」不能改成「不吃」或过敏。
训练复盘最多 180 字，只引用已知记录。
只使用 comparisons 比较训练表现，同动作名不代表同一器械。同重量次数增加只能说明这一项表现变化，缺少体感或余力数据时不要说训练变轻松，也不要归因于耐力变化。不要建议具体加重数值。
训练建议要避开用户的伤病限制和不喜欢的动作，只推荐工具里 suggestions 给出的动作。
漏记不能当成没吃。训练草案由系统给出，勿自编动作或声称已保存。
涉及疾病、伤痛或过敏时，避免诊断或保证安全。用户要求用外部资料时，说明本轮能查的数据范围。`,
      messages: [
        ...history.slice(-6).flatMap(turn => [
          { role: 'user' as const, content: turn.question },
          { role: 'assistant' as const, content: turn.reply },
        ]),
        { role: 'user', content: question },
      ],
      tools: {
        read_records: tool({
          description: '读取与本轮问题有关的 FitCheck 记录、用户说明和由服务端验证的草案',
          inputSchema: jsonSchema<Record<string, never>>({ type: 'object', properties: {}, additionalProperties: false }),
          execute: async () => ({ records: context.facts, equipmentNotes, goal: getTrainingProfile().goal, memories }),
        }),
        get_metabolism: tool({
          description: '基础代谢（Mifflin-St Jeor，按最近称重）和每日总代谢（× 活动系数），区间平均和随体重的变化；和回顾「代谢」同一算法',
          inputSchema: jsonSchema<{ range: CoachRange }>({ type: 'object', properties: { range: RANGE_SCHEMA }, required: ['range'], additionalProperties: false }),
          execute: async ({ range }) => use(data.metabolism(pickRange(range, 'd30'))),
        }),
        get_energy_balance: tool({
          description: '每天摄入、每日总代谢和热量缺口，建议区和三大营养完成度；和回顾「热量缺口」「三大营养完成度」同一算法',
          inputSchema: jsonSchema<{ range: CoachRange }>({ type: 'object', properties: { range: RANGE_SCHEMA }, required: ['range'], additionalProperties: false }),
          execute: async ({ range }) => use(data.energy(pickRange(range, 'd7'))),
        }),
        plan_macros: tool({
          description: '按减脂 cut / 维持 maintain / 增肌 bulk 算每天的目标热量和蛋白质、碳水、脂肪克数，附计算过程和近 7 天实际摄入；和「我的」算目标同一公式',
          inputSchema: jsonSchema<{ goal: GoalKey }>({ type: 'object', properties: { goal: { type: 'string', enum: ['cut', 'maintain', 'bulk'] } }, required: ['goal'], additionalProperties: false }),
          execute: async ({ goal }) => use(data.macros(['cut', 'maintain', 'bulk'].includes(goal) ? goal : data.profileGoal())),
        }),
        get_training_summary: tool({
          description: '训练天数、组数、容量，各部位每周组数和频率，个人纪录、动作表现、伤病限制、动作偏好和补弱动作建议；和训练统计同一来源',
          inputSchema: jsonSchema<{ range: CoachRange; focus?: TrainingFocus }>({
            type: 'object',
            properties: { range: RANGE_SCHEMA, focus: { type: 'string', enum: ['muscle', 'cut', 'strength'], description: '增肌 / 减脂保肌 / 力量；没说时按训练目标' } },
            required: ['range'], additionalProperties: false,
          }),
          execute: async ({ range, focus }) => use(data.training(pickRange(range, 'd30'),
            focus && ['muscle', 'cut', 'strength'].includes(focus) ? focus : trainingFocusIn(question, data.trainingGoal()))),
        }),
        get_profile: tool({
          description: '训练目标、营养资料和目标、伤病限制、喜欢和不喜欢的动作',
          inputSchema: jsonSchema<Record<string, never>>({ type: 'object', properties: {}, additionalProperties: false }),
          execute: async () => data.profile(),
        }),
      },
      prepareStep: ({ stepNumber }) => stepNumber === 0
        ? { toolChoice: { type: 'tool', toolName: 'read_records' } }
        : stepNumber === 1 ? { toolChoice: 'auto', activeTools: [...DATA_TOOLS] } : { toolChoice: 'none' },
      stopWhen: isStepCount(3),
      maxOutputTokens: topic === 'meal' ? 220 : dataTopic ? 480 : 360,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(25_000),
    });
    if (!result.steps.some(step => step.toolResults.some(output => output.toolName === 'read_records'))) return local;
    const reply = publicReply(result.text, context.reply);
    if (reply === context.reply) return local;
    const charts = [...new Map([...context.charts, ...called].map(chart => [chart.id, chart])).values()].slice(0, 2);
    return { reply, charts };
  } catch (error) {
    console.warn('[coach] 模型调用失败，返回本地记录分析', error instanceof Error ? error.name : '');
    return local;
  }
}

export async function askCoach(id: string, question: string, hint?: CoachTopic): Promise<CoachState> {
  const db = getDb();
  if (db.prepare('SELECT 1 FROM coach_turn WHERE id = ?').get(id)) return getCoachState();
  const history = readTurns();
  const topic = chooseTopic(question, hint, history.at(-1)?.topic);
  const today = todayStr();
  const equipmentNote = !/[？?]|为什么|如果/.test(question)
    && /(?:换|改|不同|不是同一).{0,8}(?:器械|机型)|(?:器械|机型).{0,8}(?:换|不同)/.test(question) ? question : null;
  const notes = equipmentNote ? [equipmentNote, ...readEquipmentNotes()] : readEquipmentNotes();
  const data = coachData(db, today);
  const context: Context = topic === 'meal' ? mealContext(today, question)
    : topic === 'plan' ? planContext(today, notes)
    : topic === 'strength' ? strengthContext(today, question, notes, history.filter(turn => turn.topic === 'strength').slice(-6).reverse().map(turn => turn.question))
    : dataContext(topic, question, data);
  const { reply, charts } = topic === 'plan' || (topic === 'strength' && notes.length)
    ? { reply: context.reply, charts: context.charts }
    : await coachReply(context, topic, history, question, notes, data);
  const evidence = [...new Map(context.evidence.map(item => [`${item.cardId}:${item.label}`, item])).values()];
  db.prepare('INSERT OR IGNORE INTO coach_turn (id, question, topic, reply, evidence, equipment_note, plan, charts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, question, topic, reply, JSON.stringify(evidence), equipmentNote, context.plan ? JSON.stringify(context.plan) : null,
      charts.length ? JSON.stringify(charts) : null);
  return getCoachState();
}

export function confirmCoachPlan(id: string): CoachState | null {
  const db = getDb();
  const confirmed = transaction(db, () => {
    const turn = db.prepare('SELECT rowid, plan, confirmed_at FROM coach_turn WHERE id = ?').get(id) as
      (Pick<TurnRow, 'plan' | 'confirmed_at'> & { rowid: number }) | undefined;
    if (!turn?.plan) return false;
    if (turn.confirmed_at) return true;
    const plan = JSON.parse(turn.plan) as CoachPlan;
    if (plan.date < todayStr() || db.prepare('SELECT 1 FROM coach_turn WHERE rowid > ? AND equipment_note IS NOT NULL LIMIT 1').get(turn.rowid)) {
      return false;
    }
    const existing = new Set(getPlan(plan.date).map(item => item.exercise_id));
    for (const item of plan.exercises) {
      if (existing.has(item.id)) continue;
      const exercise = getExercise(item.id);
      if (!exercise) throw new Error('动作已不可用');
      addPlanItem(exercise, { ...item, date: plan.date });
      existing.add(item.id);
    }
    db.prepare('UPDATE coach_turn SET confirmed_at = ? WHERE id = ?').run(new Date().toISOString(), id);
    return true;
  });
  return confirmed ? getCoachState() : null;
}
