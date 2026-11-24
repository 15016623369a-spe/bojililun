const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = ['app', 'components', 'lib'];

// 忽略系统提示词里的反例示范行（以 ❌ 开头）和纯注释
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const BANNED_RULES = [
  { label: '界面禁用 Emoji', re: /[🧠🛡️⚠️]/ },
  { label: '接口报错不能暴露开发参数或协议术语', re: /请求体不是合法 JSON|缺少 draftId|缺少 sessionId|缺少 exerciseId|缺少合法的 id|缺少训练组 id|缺少来源或请求标识|缺少撤销标识/ },
  { label: '不能对终端用户暴露开发命令或数学/代码黑话', re: /npm run dev:https|非负整数|会自动夹住|黄金增重重量|和统计页同一张图|按上次完成度微调/ },
  { label: '禁止高频 AI 寒暄与教材套话', re: /['"`]想一想['"`]|我在。说说你吃了什么|优质蛋白与适量碳水|好，这些我记下了/ },
];

test('全站用户可见文案不含 Emoji、开发黑话和已清理的 AI 套话', () => {
  const violations = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(path.join(ROOT, dir))) {
      const rel = path.relative(ROOT, file);
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((raw, idx) => {
        const line = raw.trim();
        if (!line || line.startsWith('//') || line.startsWith('*') || line.startsWith('/*') || line.startsWith('❌') || line.includes('不用教材套话')) return;
        for (const rule of BANNED_RULES) {
          if (rule.re.test(line)) {
            violations.push(`${rel}:${idx + 1} [${rule.label}] ${line.slice(0, 90)}`);
          }
        }
      });
    }
  }
  assert.deepEqual(violations, [], `发现违规文案：\n${violations.join('\n')}`);
});
