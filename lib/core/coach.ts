import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, isStepCount, jsonSchema, tool } from 'ai';
import dictionary from '../../data/exercises-seed.json';
import type { CoachEvidence, CoachPlan, CoachState, CoachTopic, CoachTurn } from '../coach-types';
import { getDb } from '../db';
import { getExercise } from '../exercise';
import { exportJournal } from '../export';
import { FOODS } from '../foods';
import { transaction } from '../ledger';
import { getAlwaysOnMemories, searchMemories } from '../memory';
import { ACTIVITY, GOAL, suggestedMacros, tdee, type ActivityKey, type GoalKey, type Sex } from '../nutrition';
import { getProfileRow } from './meals';
import { getTrainingProfile } from './training-profile';
import { addPlanItem, getPlan, todayStr } from './workout';

type TurnRow = {
  id: string; question: string; topic: CoachTopic; reply: string; evidence: string;
  plan: string | null; confirmed_at: string | null;
};
type WorkoutSet = CoachEvidence & {
  exerciseName: string; weight: number; reps: number;
};
const LIFT_WORDS = ['卧推', '深蹲', '硬拉'];
const MACHINE_WORDS = /器械|绳索|龙门架|史密斯|下拉|推胸机|腿举|夹胸|坐姿|固定/;

function readNutritionBudget() {
  const row = getProfileRow();
  if (!row || !row.age || !row.height_cm || !row.weight_kg) return null;
  const sex: Sex = row.sex === 'female' ? 'female' : 'male';
  const activity: ActivityKey = Object.hasOwn(ACTIVITY, row.activity) ? row.activity as ActivityKey : 'light';
  const goal: GoalKey = Object.hasOwn(GOAL, row.goal) ? row.goal as GoalKey : 'maintain';
  const dailyTdee = tdee({ sex, age: row.age, height_cm: row.height_cm, weight_kg: row.weight_kg, activity });
  const targetKcal = row.target_kcal || dailyTdee;
  const targetProtein = row.target_protein || Math.round(row.weight_kg * GOAL[goal].protein);
  const macros = suggestedMacros(targetKcal, targetProtein);
  const totalMacroKcal = Math.max(1, macros.carb * 4 + macros.protein * 4 + macros.fat * 9);
  return {
    dailyExpenditureKcal: dailyTdee,
    targetKcal,
    nutritionGoal: GOAL[goal].label,
    targetMacros: { carbs_g: macros.carb, protein_g: macros.protein, fat_g: macros.fat },
    macroRatioPct: {
      carbs: Math.round((macros.carb * 4 / totalMacroKcal) * 100),
      protein: Math.round((macros.protein * 4 / totalMacroKcal) * 100),
      fat: Math.round((macros.fat * 9 / totalMacroKcal) * 100),
    },
  };
}

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
      evidence: JSON.parse(row.evidence), plan, confirmed: Boolean(row.confirmed_at),
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

function chooseTopic(question: string, hint?: CoachTopic, previous?: CoachTopic): CoachTopic {
  if (hint) return hint;
  if (/晚[饭餐]|午[饭餐]|早[饭餐]|下一餐|夜宵|外卖|菜单|点餐|吃(?:什么|啥|点啥|点什么)|怎么吃|想吃|不吃|不能吃|能吃吗|饮食|碳水|蛋白|脂肪|碳蛋|热量|消耗|比例|没劲|精力/.test(question)) return 'meal';
  if (/安排|训练计划|下次.{0,6}练/.test(question)) return 'plan';
  if (/卧推|深蹲|硬拉|器械|力量|复盘|进步|练得|练了几(?:天|次)|加不加|加(?:点|多少)?重量|加重吗|加重不|训练.{0,4}(?:怎样|怎么样|咋样)/.test(question)) return 'strength';
  if (/还是|哪个好|可以吗|行吗|怎么样/.test(question)
    && FOODS.some(food => [food.name, ...food.aliases.split(',')].some(name => name && question.includes(name)))) return 'meal';
  return previous ?? 'strength';
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
  const workoutSessions = days.flatMap(day => day.entries).filter(card => card.entry_type === 'workout').length;
  const focusSessions = new Set(relevant.map(set => set.cardId)).size;
  const latestSet = recentSets.at(-1);
  const isMachine = first ? MACHINE_WORDS.test(first.after.exerciseName) : false;
  const lead = focus
    ? `最近一个月你记过 ${focusSessions} 次${first?.after.exerciseName ?? focus}`
    : `最近一个月你记了 ${workoutSessions} 次训练`;
  const reply = first
    ? notes.length
      ? `${lead}，已经按你说的器械变化分开算了。${focus ? '' : `其中${first.after.exerciseName}`}同样 ${first.after.weight} kg，之前一组做 ${first.before.reps} 次，这回能做到 ${first.after.reps} 次了${difference > 0 ? '，在这个重量上的力量和耐力都更扎实了' : ''}。`
      : difference > 0
        ? `${lead}，${focus ? '同样' : `其中${first.after.exerciseName}有明显进步：同样`} ${first.after.weight} kg，之前一组做 ${first.before.reps} 次，这回能做到 ${first.after.reps} 次了，说明你在这个重量上的力量和耐力都扎实了不少。${isMachine ? '只要这两次用的是同一台器械，这就是实打实的进步。' : ''}`
        : `${lead}，${focus ? '' : `其中${first.after.exerciseName}`}同样 ${first.after.weight} kg，之前一组做 ${first.before.reps} 次，最近一次是 ${first.after.reps} 次。`
    : relevant.length && notes.length
      ? '换器械的事我记下了，会把前后的记录分开看。新器械目前记录还不多，再练一两回就能看出变化了。'
      : latestSet
        ? `${lead}，上次${latestSet.exerciseName}做的是 ${latestSet.weight} kg × ${latestSet.reps} 次。因为这个重量目前只记过这一回，等下次再用 ${latestSet.weight} kg 练一次，就能看出次数有没有往上涨了。`
        : '最近一个月还没有带重量和次数的训练记录，先记一次训练，后面就能帮你对比力量变化了。';
  return { evidence, facts: { days: days.length, trainingDays, comparisons, equipmentNotes: notes, recentSets }, reply, plan: null };
}

function mealContext(today: string, question: string) {
  const days = journal(today, 7);
  const current = days[days.length - 1];
  const meals = current.entries.filter(card => card.entry_type === 'meal');
  const evidence = meals.map(card => ({ date: today, cardId: card.id, label: card.summary_title }));
  const options = getDb().prepare('SELECT food_name AS name FROM meal_items JOIN entries ON entry_id = entries.id WHERE user_id = ? AND is_deleted = 0 AND date BETWEEN ? AND ? GROUP BY food_name ORDER BY COUNT(*) DESC LIMIT 8')
    .all('local', dayOffset(today, -6), today);
  const workouts = current.entries.filter(card => card.entry_type === 'workout');
  const budget = readNutritionBudget();
  const intake = current.daily_summary.intake;
  const ate = meals.map(card => card.summary_title.replace(/^(?:早餐|午餐|晚餐|加餐|夜宵)\s*[·・]\s*/, '')).join('、');
  const loggedMacros = [
    intake.carbs_g !== null ? `${Math.round(intake.carbs_g)} 克碳水` : '',
    intake.protein_g !== null ? `${Math.round(intake.protein_g)} 克蛋白质` : '',
    intake.fat_g !== null ? `${Math.round(intake.fat_g)} 克脂肪` : '',
  ].filter(Boolean);
  const targetMacros = budget ? [
    intake.carbs_g !== null ? `${budget.targetMacros.carbs_g} 克碳水` : '',
    intake.protein_g !== null ? `${budget.targetMacros.protein_g} 克蛋白质` : '',
    intake.fat_g !== null ? `${budget.targetMacros.fat_g} 克脂肪` : '',
  ].filter(Boolean) : [];
  const macroLine = loggedMacros.length
    ? `目前大约吃了 ${loggedMacros.join('、')}${targetMacros.length ? `（按你现在的目标，全天大概是 ${targetMacros.join('、')}）` : ''}。`
    : '';
  const reply = meals.length
    ? `看你今天前面吃了${ate}${workouts.length ? '，训练也做完了' : ''}。${macroLine}下一餐的话，优先选瘦肉、鱼虾或者豆制品配点蔬菜，尽量避开高油高盐的油炸菜和浓汤。要是手头有几个备选方案，你直接发过来，我来帮你二选一。`
    : `今天还没有饮食记录${workouts.length ? '，不过训练已经做完了' : ''}。下一餐的话，可以安排主食配一份瘦肉、鱼虾或者豆制品，再加点蔬菜。要是有几个想吃的选项，直接发过来我帮你挑。`;
  return {
    evidence, reply, plan: null,
    facts: { meals: meals.map(card => card.items.map(item => item.food_name)),
      training: workouts.map(card => card.summary_title),
      ...(/热量|卡路里|千卡|蛋白(?:质)?(?:多少|够不够)|多少(?:克|蛋白)|摄入量|宏量|碳水|脂肪/.test(question)
        ? { knownIntake: intake } : {}),
      recentFoods: options },
    todayIntake: intake,
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
  let variedWeight = false;
  for (const movement of movements) {
    if (pendingChanges.some(note => mentionsExercise(note, movement.exercise_name)
      || !movements.some(other => mentionsExercise(note, other.exercise_name)))) continue;
    const mapped = dictionary.find(entry => entry.id === movement.exercise_id || entry.name_zh === movement.exercise_name);
    const matches = byName.all(movement.exercise_name, movement.exercise_name) as { id: string }[];
    const exercise = getExercise(mapped?.legacy_id ?? (matches.length === 1 ? matches[0].id : ''));
    const sets = movement.sets.flatMap(({ weight_kg, reps }) =>
      weight_kg !== null && weight_kg >= 0 && reps !== null && reps > 0 ? [{ weight: weight_kg, reps }] : []);
    if (!exercise || existing.has(exercise.id) || !sets.length) continue;
    if (new Set(sets.map(set => set.weight)).size > 1) variedWeight = true;
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
  const dayLabel = date === dayOffset(today, 1) ? '明天' : date;
  const reply = plan
    ? `${variedWeight
      ? `先照着你上次练的内容，把${dayLabel}的训练草案排出来了。上次加减过重量的动作，先按较轻的那组填上了，你看看要不要调。`
      : `先照着你上次练的内容，把${dayLabel}的训练草案排出来了，你看看下面的动作和重量要不要调。`}${pendingChanges.length ? '另外你提过换了器械的动作，还没摸准新重量，这次就先没往里放。' : ''}`
    : '暂时还没有能直接复用的训练动作，你可以先记一次训练，或者去训练页按部位挑几个。';
  return { evidence, reply, plan, facts: { plan } };
}

async function coachReply(
  context: { facts: unknown; reply: string; todayIntake?: unknown },
  topic: CoachTopic,
  history: CoachTurn[],
  question: string,
  equipmentNotes: string[],
) {
  const apiKey = process.env.AI_API_KEY || process.env.DEEPSEEK_API_KEY;
  if (!apiKey || process.env.FITCHECK_COACH_MODEL === 'off') return context.reply;
  const useCompatible = Boolean(process.env.AI_API_KEY);
  const baseURL = useCompatible ? (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '') : 'https://api.deepseek.com';
  const isVolcArk = /volces\.com/i.test(baseURL);
  const provider = createOpenAICompatible({
    name: 'fitcheck-coach',
    apiKey,
    baseURL,
    ...(isVolcArk ? { transformRequestBody: body => ({ ...body, thinking: { type: 'disabled' } }) } : {}),
  });
  const memories = [...new Map(
    [...getAlwaysOnMemories(), ...searchMemories(question, 5)].map(memory => [memory.id, memory]),
  ).values()].slice(0, 12).map(({ kind, content }) => ({ kind, content }));
  const dailyBudget = readNutritionBudget();
  try {
    const result = await generateText({
      model: provider(useCompatible ? (process.env.AI_MODEL || 'gpt-4o-mini') : (process.env.DEEPSEEK_MODEL || 'deepseek-chat')),
      system: `你是 FitCheck 的长期训练与饮食陪伴教练。你面对的是认真在练、希望看清数据也希望有人懂自己的训练者。用平时面对面聊天的自然中文回答，不用 Markdown，不用分号。本次任务：${topic}。

先调用 read_records 读取她最近的训练、饮食、每日消耗（dailyBudget）、今日已摄入碳蛋脂克数（todayIntake）和个人偏好，再结合数据自然回复；简短追问直接承接上文。

【核心理念：用真数据提供情绪价值】
- 训练反馈：帮她看见自己容易忽略的进步。结合真实记录（如同一重量推的次数涨了、组数更稳了、这阵子出勤稳定），给出懂行、具体的肯定（比如力量、耐力或做组能力更扎实了），让她知道这段时间的汗没白流。不空喊口号，不夸大。
- 饮食与碳蛋脂讲解：用最简单的数字把账讲清楚（今天吃了多少克碳水、蛋白质、脂肪，对照每日消耗和目标比例还差什么），再结合营养学逻辑给当下就能落地的微调建议（比如晚饭少吃点主食、补点瘦肉鱼虾或豆制品）。如果今天吃多了，不指责、不制造焦虑，温和帮她把下一餐调顺。
- 比例调整支持：当她觉得精力不够、训练状态差，或者想按自己节奏调整碳水/蛋白/脂肪比例时，结合每日消耗和训练目标解释背后的营养学原因，给出温和可执行的调整方向。

【说话与反冗余约束】
- 每一句话都要有明确目的，说完就停。不要寒暄前摇（「好的」「我来看看」），不要客服尾巴（「随时告诉我」「希望帮到你」），不要说教或科普对方早就懂的基础常识。
- 说人话，不念后台参数：把 30 天说成「最近一个月」，不要在说完「从 5 个推到 8 个」后再补一句「多了 3 个」；不复读界面卡片上已经写明的数字或按钮用法。
- 不用教材套话（如「优质蛋白与适量碳水」），说具体食物或直接从对方给的选项里挑。
- 知道什么就说什么，绝不编造工具没给的数字或模糊行话。

【句式与温度示范】
❌ 差：今天已记录 2 餐。下一餐建议优先补足优质蛋白与蔬菜、减少重油；如果有备选可以发给我帮你挑。
✅ 好：看你今天前面已经吃了大约 165 克碳水，离全天目标挺近了，但蛋白质才到 68 克。晚饭的话主食可以少吃半碗，重点配一份瘦肉、鱼虾或者豆腐加青菜，这样既不用饿肚子，全天的碳蛋脂比例也能拉得很舒服。

❌ 差：近 30 天共训练 6 天。杠铃卧推在同样 80 kg 下，从 5 次做到 8 次，多了 3 次。
✅ 好：最近一个月你记了 6 次训练，其中杠铃卧推有明显进步：同样 80 公斤，之前一组推 5 个，这回已经能推到 8 个了，说明你在这个重量上的力量和耐力都扎实了不少。

❌ 差：根据你的需求，建议合理调整宏量营养素比例以维持能量平衡。
✅ 好：下午没劲很可能是减脂期碳水压得太紧了。按你现在的每日消耗看，可以把碳水比例稍微往上提一点、脂肪稍微收一点，总热量不动，先试一周看看训练和白天的精力有没有好转。

【事实与安全底线】
- 没有份量记录或明显漏记时，如实说明目前只能看个大概，不把漏记当成没吃，也不随便判全天超标；不编造工具没提供的克数。
- 对比训练表现只看 comparisons 里的已知记录，如果对方提到换了不同器械，就把前后分开看；不替对方硬定具体要加几公斤。
- 保留用户偏好的原意：「不喜欢」不等于过敏或绝对不能吃。
- 训练草案由系统生成，不自编动作或声称已保存。涉及伤痛、疾病或过敏时，不做医疗诊断或安全保证。超出当前记录范围的问题，直说看不了外部资料。`,
      messages: [
        ...history.slice(-6).flatMap(turn => [
          { role: 'user' as const, content: turn.question },
          { role: 'assistant' as const, content: turn.reply },
        ]),
        { role: 'user', content: question },
      ],
      tools: {
        read_records: tool({
          description: '读取与本轮问题有关的 FitCheck 记录、每日消耗与碳蛋脂目标、用户说明和由服务端验证的草案',
          inputSchema: jsonSchema<Record<string, never>>({ type: 'object', properties: {}, additionalProperties: false }),
          execute: async () => ({
            records: context.facts,
            dailyBudget,
            ...(context.todayIntake !== undefined ? { todayIntake: context.todayIntake } : {}),
            equipmentNotes,
            goal: getTrainingProfile().goal,
            memories,
          }),
        }),
      },
      prepareStep: ({ stepNumber }) => ({
        toolChoice: stepNumber === 0 ? { type: 'tool', toolName: 'read_records' } : 'none',
      }),
      stopWhen: isStepCount(2),
      maxOutputTokens: topic === 'meal' ? 280 : 380,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(20_000),
    });
    return result.steps.some(step => step.toolResults.some(output => output.toolName === 'read_records'))
      ? publicReply(result.text, context.reply)
      : context.reply;
  } catch (error) {
    console.warn('[coach] 模型调用失败，返回本地记录分析', error instanceof Error ? error.name : '');
    return context.reply;
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
  const context = topic === 'meal' ? mealContext(today, question)
    : topic === 'plan' ? planContext(today, notes)
    : strengthContext(today, question, notes, history.filter(turn => turn.topic === 'strength').slice(-6).reverse().map(turn => turn.question));
  const reply = topic === 'plan' || (topic === 'strength' && notes.length)
    ? context.reply
    : await coachReply(context, topic, history, question, notes);
  const evidence = [...new Map(context.evidence.map(item => [`${item.cardId}:${item.label}`, item])).values()];
  db.prepare('INSERT OR IGNORE INTO coach_turn (id, question, topic, reply, evidence, equipment_note, plan) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, question, topic, reply, JSON.stringify(evidence), equipmentNote, context.plan ? JSON.stringify(context.plan) : null);
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
