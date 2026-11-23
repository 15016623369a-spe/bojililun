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

  for (const malformed of [RAW_TOOL_TEXT, '可以先看晚餐搭配。\n<tool_call>{"name":"read_records"}</tool_call>']) {
    finalText = malformed;
    const id = randomUUID();
    const state = await askCoach(id, '晚饭怎么选？', 'meal');
    const meal = state.turns.at(-1);
    assert.match(meal.reply, /牛肉面/);
    assert.doesNotMatch(meal.reply, /DSML|read_records|tool_call/i);
    assert.equal(getDb().prepare('SELECT reply FROM coach_turn WHERE id = ?').get(id).reply, meal.reply);
  }
  assert.equal(requests.length, 4, '每次先执行真实 read_records 工具，再拿到异常模型正文');
  assert.ok(requests[1].messages.some(message => message.role === 'tool' && message.content.includes('牛肉面')));
  assert.ok(requests.every(body => body.messages.filter(message => message.role === 'assistant')
    .every(message => !/DSML|tool_call/i.test(message.content || ''))));

  finalText = '结合今天的午餐记录，可以考虑清淡豆腐盖饭。';
  const state = await askCoach(randomUUID(), '晚饭怎么选？', 'meal');
  assert.equal(state.turns.at(-1).reply, finalText);
});
