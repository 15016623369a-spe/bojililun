const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const { createServer } = require('node:http');
const { once } = require('node:events');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test, after } = require('node:test');
const ts = require('typescript');

// 演示库：「我的」营养资料、30 天晨重、饮食和训练、左肩限制、动作偏好（scripts/seed-coach-data-demo.cjs）
const database = execFileSync(process.execPath, [path.join(__dirname, '../scripts/seed-coach-data-demo.cjs')], { encoding: 'utf8' }).trim();
process.env.FITCHECK_DB_PATH = database;
delete process.env.AI_API_KEY;
delete process.env.DEEPSEEK_API_KEY;
process.env.FITCHECK_COACH_MODEL = '';
require.extensions['.ts'] = (module, filename) => module._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText,
  filename,
);
const { getDb } = require('../lib/db.ts');
const { todayStr } = require('../lib/core/workout.ts');
const { buildReviewWall } = require('../lib/review-wall.ts');
const { trainingLog, trainingTotals } = require('../lib/training-log.ts');
const { calcTargets, suggestedMacros } = require('../lib/nutrition.ts');
const { addDays } = require('../lib/period.ts');
const { coachData, rangeIn, goalIn } = require('../lib/coach-data.ts');
const { askCoach, chooseTopic, getCoachState } = require('../lib/core/coach.ts');

const db = getDb();
const today = todayStr();
const wall = buildReviewWall(db, today).wall;
const now = wall.days.at(-1);
after(() => {
  db.close();
  fs.rmSync(path.dirname(database), { recursive: true, force: true });
});

test('代谢、热量缺口、三大营养和训练分布的数字和回顾、训练统计一致', () => {
  const data = coachData(db, today);
  const metab = data.metabolism('d30');
  assert.equal(metab.facts.available, true);
  assert.equal(metab.facts.today.bmr, now.bmr);
  assert.equal(metab.facts.today.tdee, now.tdee);
  assert.equal(metab.facts.today.weight, now.bmrWeight);
  assert.equal(metab.facts.today.tdee, Math.round(now.bmr * wall.profile.factor), '每日总代谢 = 基础代谢 × 活动系数，不加运动消耗');
  const last30 = wall.days.slice(-30);
  assert.equal(metab.facts.average.bmr, Math.round(last30.reduce((s, d) => s + d.bmr, 0) / 30));
  assert.equal(metab.chart.kind, 'line');
  assert.deepEqual(metab.chart.series.find(s => s.key === 'bmr').values, last30.map(d => d.bmr));
  assert.deepEqual(metab.chart.series.find(s => s.key === 'weight').values, last30.map(d => d.weight));
  assert.equal(data.metabolism('y1').chart.labels.length, 12, '1 年按自然月，和回顾抽屉一样 12 格');

  const energy = data.energy('d7');
  const logged = wall.days.slice(-7).filter(d => d.kcal !== null);
  assert.equal(energy.facts.loggedDays, logged.length);
  assert.equal(energy.facts.average.deficit, Math.round(logged.reduce((s, d) => s + d.tdee - d.kcal, 0) / logged.length));
  assert.deepEqual(energy.chart.series[0].values, wall.days.slice(-7).map(d => (d.kcal === null ? null : d.tdee - d.kcal)));
  assert.deepEqual([energy.chart.band.from, energy.chart.band.to], wall.band);

  // 减脂：和「我的」同一个 calcTargets + suggestedMacros，体重用回顾算基础代谢的那次称重
  const cut = data.macros('cut').facts;
  const p = wall.profile;
  const expected = calcTargets({ name: '我', sex: p.sex, age: p.age, height_cm: p.height, weight_kg: now.bmrWeight, activity: p.activity, goal: 'cut', protein_per_kg: 2 });
  const grams = suggestedMacros(expected.target_kcal, expected.target_protein);
  assert.deepEqual([cut.targetKcal, cut.protein.grams, cut.carbs.grams, cut.fat.grams], [expected.target_kcal, grams.protein, grams.carb, grams.fat]);
  assert.equal(cut.tdee, now.tdee);
  assert.equal(cut.protein.kcal + cut.fat.kcal + cut.carbs.kcal, cut.targetKcal, '三部分热量加起来正好是目标热量');

  const start = addDays(today, -29);
  const training = data.training('d30', 'muscle').facts;
  const totals = trainingTotals(trainingLog(db, start, today));
  assert.deepEqual([training.totals.days, training.totals.sets, training.totals.volume], [totals.days, totals.sets, totals.volume]);
  assert.equal(training.regions.reduce((s, r) => s + r.sets, 0), wall.muscles.d30.reduce((s, m) => s + m.sets, 0), '部位组数加起来等于回顾「训练分布」');
  assert.equal(training.prs.count, wall.prs.filter(e => e.date >= start).length, '个人纪录次数和回顾一致');
  assert.ok(training.weak.includes('肩') && training.weak.includes('腿'));
  const shoulder = training.suggestions.find(s => s.region === '肩');
  assert.ok(shoulder && !shoulder.exercises.some(name => /推举/.test(name)), '左肩限制：不推荐推举类');
  assert.ok(!training.suggestions.some(s => s.exercises.includes('杠铃深蹲')), '不喜欢的动作不进建议');
});

test('问句里的区间和目标', () => {
  assert.equal(rangeIn('我最近这一段时间的基础代谢是多少', 'd7'), 'd30');
  assert.equal(rangeIn('这周热量缺口多少', 'd30'), 'd7');
  assert.equal(rangeIn('今年体重变化', 'd30'), 'y1');
  assert.equal(goalIn('如果我要减脂，每天吃多少', 'bulk'), 'cut');
  assert.equal(goalIn('每天碳水吃多少', 'bulk'), 'bulk');
});

test('认不出的问题不再沿用上一轮话题，追问仍接着聊', () => {
  assert.equal(chooseTopic('我最近这一段时间的基础代谢是多少', undefined, 'strength'), 'metabolism');
  assert.equal(chooseTopic('如果我要减脂，每天的碳水、脂肪、蛋白质应该是多少', undefined, 'strength'), 'macros');
  assert.equal(chooseTopic('我要增肌，训练大概要怎么做', undefined, 'meal'), 'training');
  assert.equal(chooseTopic('这周热量缺口多少', undefined, 'meal'), 'energy');
  assert.equal(chooseTopic('今天天气怎么样', undefined, 'strength'), 'general');
  assert.equal(chooseTopic('那就豆腐饭？', undefined, 'meal'), 'meal');
  assert.equal(chooseTopic('减脂期晚饭吃啥', undefined, 'strength'), 'meal');
  assert.equal(chooseTopic('安排下次训练', undefined, 'macros'), 'plan');
});

test('没有模型 key：三个例子都用真实数字回答，并带图表', async () => {
  const metab = (await askCoach(randomUUID(), '我最近这一段时间的基础代谢是多少')).turns.at(-1);
  assert.equal(metab.topic, 'metabolism');
  assert.match(metab.reply, new RegExp(`今天是 ${now.bmr.toLocaleString('en-US')} kcal`));
  assert.match(metab.reply, /Mifflin-St Jeor/);
  assert.match(metab.reply, new RegExp(`≈ ${now.tdee.toLocaleString('en-US')} kcal`));
  assert.deepEqual(metab.charts.map(c => c.id), ['metabolism-d30']);

  const macros = (await askCoach(randomUUID(), '如果我要减脂，每天的碳水、脂肪、蛋白质应该是多少')).turns.at(-1);
  const cut = coachData(db, today).macros('cut').facts;
  assert.equal(macros.topic, 'macros');
  assert.match(macros.reply, new RegExp(`蛋白质 ${cut.protein.grams} g、碳水 ${cut.carbs.grams} g、脂肪 ${cut.fat.grams} g`));
  assert.match(macros.reply, /怎么算的/);
  assert.equal(macros.charts[0].kind, 'progress');
  assert.deepEqual(macros.charts[0].rows.map(r => r.target), [cut.protein.grams, cut.carbs.grams, cut.fat.grams]);

  const training = (await askCoach(randomUUID(), '我要增肌，训练大概要怎么做')).turns.at(-1);
  assert.equal(training.topic, 'training');
  assert.match(training.reply, /每周 10–20 组/);
  assert.match(training.reply, /左肩有旧伤/);
  assert.match(training.reply, /杠铃卧推估算 1RM/);
  assert.equal(training.charts[0].kind, 'bars');
  assert.deepEqual(training.charts[0].band, { from: 10, to: 20, label: '建议 10–20 组' });

  const other = (await askCoach(randomUUID(), '今天天气怎么样')).turns.at(-1);
  assert.equal(other.topic, 'general');
  assert.deepEqual(other.charts, []);

  const restored = getCoachState().turns;
  assert.deepEqual(restored.find(t => t.id === metab.id).charts, metab.charts, '图表随对话存下，重新打开还在');
});

test('有模型 key：先读记录，再按需调用数据工具；数字来自工具，图表跟着工具走', async t => {
  const requests = [];
  let script = [];
  let finalText = '';
  let fail = false;
  const toolCall = (name, args) => ({
    role: 'assistant', content: null,
    tool_calls: [{ id: `call_${name}_${requests.length}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
  });
  const provider = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push(body);
    if (fail) {
      response.statusCode = 500;
      response.end('{"error":{"message":"boom"}}');
      return;
    }
    const done = body.messages.filter(message => message.role === 'tool').length;
    const next = done === 0 ? { name: 'read_records', args: {} } : script[done - 1];
    const offered = (body.tools ?? []).map(tool => tool.function.name);
    const message = next && offered.includes(next.name) ? toolCall(next.name, next.args) : { role: 'assistant', content: finalText };
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({
      id: 'completion-test', object: 'chat.completion', created: 1, model: 'test',
      choices: [{ index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    }));
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  t.after(() => {
    provider.close();
    delete process.env.AI_API_KEY;
  });
  process.env.AI_API_KEY = 'fixture-key';
  process.env.AI_BASE_URL = `http://127.0.0.1:${provider.address().port}/v1`;
  process.env.AI_MODEL = 'test';

  // 认不出的问题：read_records 之后模型自己选 get_metabolism，回复和图都用工具的数据
  script = [{ name: 'get_metabolism', args: { range: 'd30' } }];
  finalText = `你现在的基础代谢约 ${now.bmr} kcal，见下图。`;
  const general = (await askCoach(randomUUID(), '我身体一天大概烧掉多少能量啊，最近有没有变化')).turns.at(-1);
  assert.equal(general.reply, finalText);
  assert.deepEqual(general.charts.map(c => c.id), ['metabolism-d30']);
  assert.equal(requests.length, 3, 'read_records → get_metabolism → 回复');
  assert.ok(requests[1].tools.every(tool => tool.function.name !== 'read_records'), '第二步只给数据工具');
  assert.ok(['get_metabolism', 'get_energy_balance', 'plan_macros', 'get_training_summary', 'get_profile']
    .every(name => requests[1].tools.some(tool => tool.function.name === name)));
  const metabResult = JSON.parse(requests[2].messages.filter(message => message.role === 'tool').at(-1).content);
  assert.equal(metabResult.today.bmr, now.bmr);
  assert.equal(metabResult.today.tdee, now.tdee);

  // 有话题的问题：read_records 里就是这个话题的数据和图；模型再要减脂的三大营养，两张图都附上
  requests.length = 0;
  script = [{ name: 'plan_macros', args: { goal: 'cut' } }];
  finalText = '减脂每天约 2,240 kcal，蛋白质优先。';
  const training = (await askCoach(randomUUID(), '我要增肌，训练大概要怎么做')).turns.at(-1);
  assert.equal(training.topic, 'training');
  assert.equal(training.reply, finalText);
  assert.deepEqual(training.charts.map(c => c.kind), ['bars', 'progress']);
  const records = JSON.parse(requests[1].messages.find(message => message.role === 'tool').content);
  assert.ok(records.records.suggestions.length, 'read_records 带着训练分布和补弱建议');
  assert.ok(records.records.constraints.some(text => text.includes('左肩')));

  // 模型出错：退回同一份数据的本地回答和图表
  fail = true;
  const fallback = (await askCoach(randomUUID(), '如果我要减脂，每天的碳水、脂肪、蛋白质应该是多少')).turns.at(-1);
  assert.match(fallback.reply, /怎么算的/);
  assert.deepEqual(fallback.charts.map(c => c.id), ['macros-cut']);
});
