const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const { createServer } = require('node:http');
const { once } = require('node:events');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const ts = require('typescript');

const database = execFileSync(process.execPath, [path.join(__dirname, '../scripts/seed-coach-demo.cjs')], { encoding: 'utf8' }).trim();
process.env.FITCHECK_DB_PATH = database;
process.env.FITCHECK_COACH_MODEL = '';
require.extensions['.ts'] = (module, filename) => module._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText,
  filename,
);
const { getDb } = require('../lib/db.ts');
const { askCoach, getCoachState } = require('../lib/core/coach.ts');

const RAW_TOOL_TEXT = '<｜｜DSML｜｜ calls>\n<｜｜DSML｜｜ invoke name="read_records">\n\n</｜｜DSML｜｜ invoke>\n</｜｜DSML｜｜ calls>';
const PLAN_ID = randomUUID();

test('教练只展示正文，工具标记不进入新回复或历史对话', async t => {
  let finalText = RAW_TOOL_TEXT;
  const requests = [];
  const provider = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push(body);
    const toolResult = body.messages.some(message => message.role === 'tool');
    const message = toolResult ? { role: 'assistant', content: finalText } : {
      role: 'assistant', content: null,
      tool_calls: [{ id: 'call_test', type: 'function', function: { name: 'read_records', arguments: '{}' } }],
    };
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({
      id: 'completion-test', object: 'chat.completion', created: 1, model: 'test',
      choices: [{ index: 0, message, finish_reason: toolResult ? 'stop' : 'tool_calls' }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    }));
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  t.after(() => {
    provider.close();
    getDb().close();
    fs.rmSync(path.dirname(database), { recursive: true, force: true });
  });
  process.env.AI_API_KEY = 'fixture-key';
  process.env.AI_BASE_URL = `http://127.0.0.1:${provider.address().port}/v1`;
  process.env.AI_MODEL = 'test';

  const { turns } = await askCoach(PLAN_ID, '安排下次训练', 'plan');
  const draft = turns.at(-1);
  assert.equal(requests.length, 0, '训练草案正文来自服务端');
  assert.match(draft.reply, /草案/);
  assert.ok(draft.plan?.exercises.length);

  getDb().prepare('UPDATE coach_turn SET reply = ?, confirmed_at = ? WHERE id = ?')
    .run(RAW_TOOL_TEXT, '2026-11-23T00:00:00Z', PLAN_ID);
  const restored = getCoachState().turns.at(-1);
  assert.equal(restored.reply, '这份计划已加入训练单。');
  assert.equal(restored.confirmed, true);
  assert.deepEqual(restored.plan, draft.plan);
  assert.deepEqual(restored.evidence, draft.evidence);

  finalText = '选豆腐饭吧，口味清淡，也避开了你不喜欢的鸡蛋。';
  const directChoice = '豆腐饭还是番茄炒蛋？';
  const directState = await askCoach(randomUUID(), directChoice);
  assert.equal(directState.turns.at(-1).topic, 'meal', '上一轮是训练时，直接发菜名也能问饮食');
  assert.equal(directState.turns.at(-1).reply, finalText);
  await askCoach(randomUUID(), '下次练什么？');
  requests.length = 0;

  for (const malformed of [RAW_TOOL_TEXT, '可以先看晚餐搭配。\n<tool_call>{"name":"read_records"}</tool_call>']) {
    finalText = malformed;
    const id = randomUUID();
    const state = await askCoach(id, '今晚吃啥？');
    const meal = state.turns.at(-1);
    assert.equal(meal.topic, 'meal', '从训练话题切换到随口问晚饭，无需提示词');
    assert.match(meal.reply, /牛肉面/);
    assert.doesNotMatch(meal.reply, /DSML|read_records|tool_call/i);
    assert.equal(getDb().prepare('SELECT reply FROM coach_turn WHERE id = ?').get(id).reply, meal.reply);
  }
  assert.equal(requests.length, 4, '每次先执行真实 read_records 工具，再拿到异常模型正文');
  assert.ok(requests[1].messages.some(message => message.role === 'tool' && message.content.includes('牛肉面')));
  assert.ok(requests.every(body => body.messages.filter(message => message.role === 'assistant')
    .every(message => !/DSML|tool_call/i.test(message.content || ''))));

  finalText = '选豆腐饭吧，口味清淡，也避开了你不喜欢的鸡蛋。';
  const followup = '那就豆腐饭？';
  const state = await askCoach(randomUUID(), followup);
  assert.equal(state.turns.at(-1).reply, finalText);
  assert.equal(state.turns.at(-1).topic, 'meal');
  const messages = requests.at(-1).messages;
  assert.ok(messages.some(message => message.role === 'user' && message.content === '今晚吃啥？'));
  assert.ok(messages.some(message => message.role === 'user' && message.content === followup));
  const context = JSON.parse(messages.find(message => message.role === 'tool').content);
  assert.deepEqual(context.records.meals, [['牛肉面']]);
  assert.equal(context.records.knownIntake, undefined);
  assert.equal(context.goal, 'muscle');
  assert.ok(context.memories.some(memory => memory.content.includes('不喜欢鸡蛋')));
  await askCoach(randomUUID(), '我午饭吃了多少蛋白？');
  const nutrition = JSON.parse(requests.at(-1).messages.find(message => message.role === 'tool').content);
  assert.equal(nutrition.records.knownIntake.protein_g, 29);

  finalText = '近 30 天有 3 天训练记录，卧推同样 50 kg，从 6 次做到 8 次。';
  const training = (await askCoach(randomUUID(), '最近练得咋样？')).turns.at(-1);
  assert.equal(training.topic, 'strength', '刚聊完饮食时，随口问训练也查力量记录');
  assert.ok(training.evidence.some(item => item.label.includes('50 kg × 6')));
  assert.ok(training.evidence.some(item => item.label.includes('50 kg × 8')));
  const trainingContext = JSON.parse(requests.at(-1).messages.find(message => message.role === 'tool').content);
  assert.equal(trainingContext.records.trainingDays, 3);

  const bench = (await askCoach(randomUUID(), '卧推呢？')).turns.at(-1);
  assert.equal(bench.topic, 'strength');
  assert.ok(bench.evidence.every(item => item.label.includes('卧推')));
  const draftFollowup = (await askCoach(randomUUID(), '那我下次练啥？')).turns.at(-1);
  assert.ok(draftFollowup.plan?.exercises.some(exercise => exercise.name === '杠铃卧推'));
  assert.equal(draftFollowup.confirmed, false);

  finalText = '练完可以点份清淡的豆腐盖饭。';
  const afterTraining = (await askCoach(randomUUID(), '练完吃点啥？')).turns.at(-1);
  assert.equal(afterTraining.topic, 'meal');
  assert.equal(afterTraining.reply, finalText);
  const afterTrainingContext = JSON.parse(requests.at(-1).messages.find(message => message.role === 'tool').content);
  assert.deepEqual(afterTrainingContext.records.training, ['杠铃卧推与高位下拉']);
  assert.deepEqual(afterTrainingContext.records.meals, [['牛肉面']]);

  await askCoach(randomUUID(), '卧推呢？');
  const restriction = (await askCoach(randomUUID(), '那番茄炒蛋不能吃吗？')).turns.at(-1);
  assert.equal(restriction.topic, 'meal');
});
