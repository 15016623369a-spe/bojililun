/**
 * 冒烟测试：跑一遍「建档 → 文字记餐 → 确认 → 记忆 → 训练计划 → 图片识别」的完整链路。
 * 用法：先 npm run dev，然后 node scripts/smoke.mjs
 */
const BASE = process.env.BASE || 'http://127.0.0.1:3001';

async function call(path, init) {
  const res = await fetch(BASE + path, init);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

const post = (path, payload) =>
  call(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
const put = (path, payload) =>
  call(path, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

let failed = 0;
function check(name, cond, extra = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name} ${extra}`);
  }
}

// 1x1 png
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function main() {
  console.log('\n[1] 建档');
  await put('/api/profile', {
    name: '测试',
    sex: 'male',
    age: 27,
    height_cm: 178,
    weight_kg: 74,
    activity: 'moderate',
    goal: 'cut',
  });
  const { profile } = await call('/api/profile');
  check('目标热量已计算', profile.target_kcal > 1500 && profile.target_kcal < 3500, String(profile.target_kcal));
  check('蛋白目标已计算', profile.target_protein > 100, String(profile.target_protein));
  console.log(`     目标 ${profile.target_kcal} kcal / 蛋白 ${profile.target_protein} g`);
  // 清空今日记录，保证冒烟测试可重复运行
  const t0 = await call('/api/today');
  for (const m of t0.meals) await call(`/api/meals?id=${m.id}`, { method: 'DELETE' });
  const mealsBefore = 0;

  console.log('\n[2] 文字记一餐');
  const r1 = await post('/api/chat', { text: '午饭吃了米饭200g、鸡胸肉150g，还有一个鸡蛋' });
  const card = r1.replies.find((x) => x.kind === 'food_card');
  check('返回了识别卡片', !!card);
  if (!card) return;
  check('识别出 3 项', card.items.length === 3, JSON.stringify(card.items.map((i) => i.name)));
  check('米饭 200g', card.items.some((i) => i.name === '米饭' && i.grams === 200));
  console.log(`     卡片：${card.items.map((i) => `${i.name}${i.grams}g`).join(' / ')}`);

  console.log('\n[3] 确认入库');
  const confirmed = await post('/api/meals', { draftId: card.draftId, items: card.items });
  check('返回了汇总', confirmed.reply.kind === 'summary');
  check('已扣减热量', confirmed.remainingKcal > 0 && confirmed.remainingKcal < profile.target_kcal);
  console.log(`     ${confirmed.reply.text.replace(/\n/g, ' / ')}`);

  console.log('\n[4] 重复确认应失败');
  let dupErr = '';
  try {
    await post('/api/meals', { draftId: card.draftId, items: card.items });
  } catch (e) {
    dupErr = e.message;
  }
  check('同一草稿不能重复记录', dupErr.includes('400'), dupErr.slice(0, 80));

  console.log('\n[5] 记忆：自然说出约束');
  // 清空已有记忆，保证可重复运行
  const { memories: oldMems } = await call('/api/memory');
  for (const m of oldMems) await call(`/api/memory?id=${m.id}`, { method: 'DELETE' });
  const r2 = await post('/api/chat', { text: '我左肩有伤，不能做过顶推举，另外我家里只有哑铃' });
  const proposal = r2.replies.find((x) => x.kind === 'memory_proposal');
  check('主动提出了记忆候选', !!proposal);
  if (proposal) {
    console.log(`     候选：${proposal.candidates.map((c) => `[${c.kind}] ${c.content}`).join('；')}`);
    check('识别为约束类', proposal.candidates.some((c) => c.kind === 'constraint'));
    await post('/api/memory', { candidates: proposal.candidates });
  }
  const { memories } = await call('/api/memory');
  check('记忆已落库', memories.length > 0, String(memories.length));

  console.log('\n[6] 训练计划（读取记忆 + 动作数据集）');
  const r3 = await post('/api/chat', { text: '今天练胸' });
  const txt = r3.replies.find((x) => x.kind === 'text');
  check('给出了训练建议', !!txt && txt.text.includes('胸'));
  if (txt) {
    check('列出了动作', /1\./.test(txt.text));
    console.log('     ' + txt.text.split('\n').slice(0, 6).join('\n     '));
  }

  console.log('\n[7] 图片识别（演示模式）');
  const r4 = await post('/api/chat', { image: PNG });
  const card2 = r4.replies.find((x) => x.kind === 'food_card');
  check('图片走通了识别卡片', !!card2);
  if (card2) {
    check('照片已落盘', typeof card2.photoUrl === 'string' && card2.photoUrl.startsWith('/api/uploads/'));
    const imgRes = await fetch(BASE + card2.photoUrl);
    check('照片可访问', imgRes.ok);
    check('演示模式有明确提示', (card2.note || '').includes('演示'));
    console.log(`     ${card2.items.map((i) => `${i.name}${i.grams}g`).join(' / ')}`);
  }

  console.log('\n[8] 今日汇总');
  const today = await call('/api/today');
  check('今日记录 +1', today.meals.length === mealsBefore + 1, `${mealsBefore} -> ${today.meals.length}`);
  check('记忆随 today 返回', today.memories.length > 0);
  console.log(`     已摄入 ${today.consumed.kcal} kcal，剩余 ${today.remainingKcal} kcal`);

  console.log(failed === 0 ? '\n全部通过 ✅' : `\n有 ${failed} 项失败 ❌`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('冒烟测试异常：', e.message);
  process.exit(1);
});
